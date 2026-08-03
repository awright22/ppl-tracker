/* PWA shell for the PPL tracker.
   - Provides a window.storage implementation (same contract as the Claude
     artifact API: get() THROWS on missing keys) backed by localStorage,
     so the tracker component runs unmodified.
   - Mirrors config / sessions-index / session:* writes to a Google Sheet
     through a user-deployed Apps Script endpoint: local-first, offline
     queue, pull-and-merge on boot. Drafts stay device-local.
   - Renders a slim sync strip above the app with a settings panel
     (connect sheet, sync now, export / import backup). */

const PREFIX = "ppl.";
const META_KEY = "ppl.__meta";     // { [key]: updatedAtMs }
const QUEUE_KEY = "ppl.__queue";   // [key, ...] pending push
const CFG_KEY = "ppl.__sheetCfg";  // { url, token }
const SYNCABLE = /^(config|sessions-index|session:.+)$/;

const readJson = (k, fallback) => {
  try {
    const raw = localStorage.getItem(k);
    return raw == null ? fallback : JSON.parse(raw);
  } catch (e) { return fallback; }
};
const writeJson = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

let meta = readJson(META_KEY, {});
let queue = readJson(QUEUE_KEY, []);
let cfg = readJson(CFG_KEY, null);
let lastError = "";
let lastSyncAt = readJson("ppl.__lastSync", 0);
let flushTimer = null;
let flushing = false;

const saveMeta = () => writeJson(META_KEY, meta);
const saveQueue = () => writeJson(QUEUE_KEY, queue);

/* ---------- window.storage (artifact-compatible contract) ---------- */

function markDirty(key) {
  if (!SYNCABLE.test(key)) return;
  meta[key] = Date.now();
  saveMeta();
  if (!queue.includes(key)) { queue.push(key); saveQueue(); }
  renderStrip();
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => { flush(); }, 800);
}

export function installStorage() {
  window.storage = {
    async get(key) {
      const raw = localStorage.getItem(PREFIX + key);
      if (raw == null) throw new Error("storage: key not found: " + key);
      return { key, value: raw };
    },
    async set(key, value) {
      if (typeof value !== "string") throw new Error("storage: value must be a string");
      localStorage.setItem(PREFIX + key, value);
      markDirty(key);
      return { key, value };
    },
    async delete(key) {
      localStorage.removeItem(PREFIX + key);
      markDirty(key); // tombstone: key queued with no local value
      return true;
    },
    async list(prefix) {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(PREFIX)) {
          const bare = k.slice(PREFIX.length);
          if (!bare.startsWith("__") && (!prefix || bare.startsWith(prefix))) keys.push(bare);
        }
      }
      return { keys };
    },
  };
}

/* ---------- sheet sync ---------- */

async function api(body, timeoutMs = 8000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    let res;
    if (body.action === "pull") {
      const u = cfg.url + (cfg.url.includes("?") ? "&" : "?") +
        "action=pull&token=" + encodeURIComponent(cfg.token || "");
      res = await fetch(u, { signal: ctl.signal });
    } else {
      // text/plain keeps this a CORS "simple request" — required for Apps Script.
      res = await fetch(cfg.url, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(body),
        signal: ctl.signal,
      });
    }
    const data = await res.json();
    if (!data || data.ok !== true) throw new Error((data && data.error) || "sheet said no");
    return data;
  } finally {
    clearTimeout(t);
  }
}

export async function flush() {
  if (!cfg || !cfg.url || flushing || queue.length === 0) { renderStrip(); return; }
  if (typeof navigator !== "undefined" && navigator.onLine === false) { renderStrip(); return; }
  flushing = true;
  renderStrip();
  const keys = [...queue];
  const rows = keys.map((key) => ({
    key,
    json: localStorage.getItem(PREFIX + key), // null => deletion tombstone
    updatedAt: meta[key] || Date.now(),
  }));
  try {
    await api({ action: "push", token: cfg.token || "", rows });
    const sentAt = {};
    keys.forEach((k, i) => { sentAt[k] = rows[i].updatedAt; });
    queue = queue.filter((k) => (meta[k] || 0) > (sentAt[k] || 0)); // keep keys edited mid-flight
    saveQueue();
    lastSyncAt = Date.now();
    writeJson("ppl.__lastSync", lastSyncAt);
    lastError = "";
  } catch (e) {
    lastError = String((e && e.message) || e);
  } finally {
    flushing = false;
    renderStrip();
  }
}

export async function pullAndMerge() {
  if (!cfg || !cfg.url) return { merged: 0 };
  const data = await api({ action: "pull" });
  let merged = 0;
  for (const row of data.rows || []) {
    if (!row || !SYNCABLE.test(row.key)) continue;
    const localTs = meta[row.key] || 0;
    const remoteTs = Number(row.updatedAt) || 0;
    const unsyncedLocal = queue.includes(row.key);
    if (unsyncedLocal && localTs >= remoteTs) continue; // local edit wins until pushed
    if (remoteTs > localTs || (localStorage.getItem(PREFIX + row.key) == null && row.json)) {
      if (row.json == null || row.json === "") localStorage.removeItem(PREFIX + row.key);
      else localStorage.setItem(PREFIX + row.key, row.json);
      meta[row.key] = remoteTs;
      merged++;
    }
  }
  saveMeta();
  lastSyncAt = Date.now();
  writeJson("ppl.__lastSync", lastSyncAt);
  lastError = "";
  return { merged };
}

function connect(url, token) {
  cfg = { url: url.trim(), token: token.trim() };
  writeJson(CFG_KEY, cfg);
  // First connect: everything local is worth pushing.
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(PREFIX)) {
      const bare = k.slice(PREFIX.length);
      if (SYNCABLE.test(bare)) {
        if (!meta[bare]) meta[bare] = Date.now();
        if (!queue.includes(bare)) queue.push(bare);
      }
    }
  }
  saveMeta(); saveQueue();
  let merged = 0;
  return pullAndMerge()
    .then((r) => { merged = (r && r.merged) || 0; })
    .catch((e) => { lastError = String(e.message || e); })
    .then(() => flush())
    .then(() => {
      renderStrip();
      // Remote records arrived (e.g. fresh phone restoring): reload so React rehydrates.
      if (merged > 0 && !lastError) setTimeout(() => location.reload(), 700);
      return merged;
    });
}

/* ---------- export / import ---------- */

function exportBackup() {
  const data = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(PREFIX)) {
      const bare = k.slice(PREFIX.length);
      if (SYNCABLE.test(bare) || bare === "draft") data[bare] = localStorage.getItem(k);
    }
  }
  return JSON.stringify({ app: "ppl-tracker", exportedAt: new Date().toISOString(), data }, null, 2);
}

function importBackup(text) {
  const parsed = JSON.parse(text);
  const data = parsed && parsed.data;
  if (!data || typeof data !== "object") throw new Error("Not a PPL tracker backup");
  let n = 0;
  for (const key of Object.keys(data)) {
    if (!SYNCABLE.test(key) && key !== "draft") continue;
    localStorage.setItem(PREFIX + key, data[key]);
    if (SYNCABLE.test(key)) markDirty(key);
    n++;
  }
  return n;
}

/* ---------- sync strip + panel UI ---------- */

let stripEl = null;
let panelEl = null;

function fmtTime(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function stripLabel() {
  if (!cfg || !cfg.url) return "☁︎  Back up to Google Sheets — tap to set up";
  if (flushing) return "☁︎  Sheet · syncing…";
  if (queue.length > 0) {
    const off = typeof navigator !== "undefined" && navigator.onLine === false;
    return `☁︎  Sheet · ${queue.length} pending${off ? " (offline)" : ""}`;
  }
  if (lastError) return "☁︎  Sheet · sync error — tap for details";
  return `☁︎  Sheet · synced${lastSyncAt ? " " + fmtTime(lastSyncAt) : ""}`;
}

function renderStrip() {
  if (!stripEl) return;
  stripEl.textContent = stripLabel();
  stripEl.className =
    "w-full text-center text-xs py-1 border-b cursor-pointer select-none " +
    (lastError && (!cfg || queue.length === 0)
      ? "bg-zinc-950 text-red-400 border-red-900"
      : queue.length > 0
        ? "bg-zinc-950 text-amber-300 border-zinc-800"
        : "bg-zinc-950 text-zinc-500 border-zinc-800");
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

function buildPanel() {
  panelEl = el("div", "fixed inset-0 z-50 overflow-y-auto bg-black/95 p-4 hidden");
  panelEl.style.paddingTop = "calc(env(safe-area-inset-top) + 1rem)";
  const card = el("div", "mx-auto max-w-md flex flex-col gap-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-4 text-zinc-200");

  card.appendChild(el("div", "text-lg font-bold", "Google Sheet backup"));
  const status = el("div", "text-xs text-zinc-500", "");
  card.appendChild(status);

  const urlIn = el("input", "h-12 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 text-base text-zinc-100");
  urlIn.placeholder = "Apps Script Web App URL (…/exec)";
  urlIn.value = (cfg && cfg.url) || "";
  const tokIn = el("input", "h-12 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 text-base text-zinc-100");
  tokIn.placeholder = "Token (same as TOKEN in the script)";
  tokIn.value = (cfg && cfg.token) || "";
  card.appendChild(urlIn);
  card.appendChild(tokIn);

  const setStatus = (msg, bad) => {
    status.textContent = msg;
    status.className = "text-xs " + (bad ? "text-red-400" : "text-zinc-500");
  };

  const row1 = el("div", "flex gap-2");
  const saveBtn = el("button", "h-12 flex-1 rounded-xl bg-lime-400 text-sm font-bold text-black", "Save & sync");
  saveBtn.onclick = async () => {
    if (!urlIn.value.trim()) { setStatus("Enter the Web App URL from your Apps Script deploy.", true); return; }
    setStatus("Connecting…");
    const merged = await connect(urlIn.value, tokIn.value);
    if (lastError) setStatus("Sync failed: " + lastError, true);
    else setStatus(merged > 0 ? `Connected — restoring ${merged} records…` : "Connected. Sheet is now backing this device up.");
  };
  const syncBtn = el("button", "h-12 flex-1 rounded-xl border border-zinc-700 text-sm font-semibold text-zinc-200", "Sync now");
  syncBtn.onclick = async () => {
    setStatus("Syncing…");
    try {
      const r = await pullAndMerge();
      await flush();
      if (lastError) { setStatus("Sync failed: " + lastError, true); return; }
      if (r.merged > 0) { setStatus(`Pulled ${r.merged} records — reloading…`); setTimeout(() => location.reload(), 700); }
      else setStatus("Synced.");
    }
    catch (e) { setStatus("Sync failed: " + (e.message || e), true); }
  };
  row1.appendChild(saveBtn); row1.appendChild(syncBtn);
  card.appendChild(row1);

  const row2 = el("div", "flex gap-2");
  const expBtn = el("button", "h-12 flex-1 rounded-xl border border-zinc-700 text-sm font-semibold text-zinc-200", "Export backup");
  const impBtn = el("button", "h-12 flex-1 rounded-xl border border-zinc-700 text-sm font-semibold text-zinc-200", "Import");
  row2.appendChild(expBtn); row2.appendChild(impBtn);
  card.appendChild(row2);

  const ta = el("textarea", "hidden w-full rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-400");
  ta.rows = 6;
  card.appendChild(ta);
  expBtn.onclick = () => {
    ta.classList.remove("hidden");
    ta.value = exportBackup();
    ta.focus(); ta.select();
    try { navigator.clipboard && navigator.clipboard.writeText(ta.value); } catch (e) {}
    setStatus("Backup shown below (and copied). Paste it somewhere safe.");
  };
  let importArmed = false;
  impBtn.onclick = () => {
    if (!importArmed) {
      ta.classList.remove("hidden");
      ta.value = "";
      ta.placeholder = "Paste a backup here, then tap Import again";
      importArmed = true;
      impBtn.textContent = "Import pasted";
      return;
    }
    try {
      const n = importBackup(ta.value);
      setStatus(`Imported ${n} records — reloading…`);
      setTimeout(() => location.reload(), 600);
    } catch (e) { setStatus("Import failed: " + (e.message || e), true); }
  };

  const steps = el("div", "text-xs text-zinc-500 leading-relaxed");
  steps.innerHTML =
    "<b class='text-zinc-300'>One-time setup:</b> create a Google Sheet → Extensions → Apps Script → " +
    "paste the code from <b class='text-zinc-300'>workout-pwa/apps-script.gs</b> in the repo → set your own TOKEN in it → " +
    "Deploy → New deployment → Web app → execute as <b class='text-zinc-300'>Me</b>, access " +
    "<b class='text-zinc-300'>Anyone</b> → copy the /exec URL here. Workouts then appear in the sheet " +
    "(readable Sessions & Sets tabs), and a fresh phone restores from it.";
  card.appendChild(steps);

  const closeBtn = el("button", "h-12 w-full rounded-xl border border-zinc-700 text-sm font-semibold text-zinc-400", "Close");
  closeBtn.onclick = () => panelEl.classList.add("hidden");
  card.appendChild(closeBtn);

  panelEl.appendChild(card);
  document.body.appendChild(panelEl);
  panelEl.addEventListener("click", (e) => { if (e.target === panelEl) panelEl.classList.add("hidden"); });

  panelEl.__open = () => {
    setStatus(lastError ? "Last sync error: " + lastError : (cfg && cfg.url ? "Connected." : "Not connected yet."), !!lastError);
    panelEl.classList.remove("hidden");
  };
}

/* ---------- boot ---------- */

export async function startShell(mountApp) {
  installStorage();
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}

  stripEl = el("div", "", "");
  const root = document.getElementById("root");
  root.parentNode.insertBefore(stripEl, root);
  buildPanel();
  stripEl.onclick = () => panelEl.__open();
  renderStrip();

  if (cfg && cfg.url && navigator.onLine !== false) {
    try { await pullAndMerge(); } catch (e) { lastError = String(e.message || e); }
  }
  renderStrip();
  mountApp();

  window.addEventListener("online", () => flush());
  document.addEventListener("visibilitychange", () => { if (!document.hidden) flush(); });
  if (queue.length) flush();

  if ("serviceWorker" in navigator) {
    try { navigator.serviceWorker.register("./sw.js"); } catch (e) { /* offline shell unavailable */ }
  }
}

// Exposed for tests and console debugging.
export const __shell = { get queue() { return queue; }, get cfg() { return cfg; }, exportBackup, importBackup, pullAndMerge };
