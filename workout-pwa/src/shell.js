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
const SYNCABLE = /^(config|sessions-index|records|weights|session:.+)$/;

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

async function api(body, timeoutMs = 20000) {
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

// Pushes go up in batches: a bulk backlog (e.g. a 100-session history import)
// would blow any single request's timeout while Apps Script upserts rows and
// rebuilds the readable tabs. Small batches keep each request quick and let
// the pending count visibly drain.
const PUSH_BATCH = 25;

export async function flush() {
  if (!cfg || !cfg.url || flushing || queue.length === 0) { renderStrip(); return; }
  if (typeof navigator !== "undefined" && navigator.onLine === false) { renderStrip(); return; }
  flushing = true;
  renderStrip();
  try {
    while (queue.length > 0) {
      const keys = queue.slice(0, PUSH_BATCH);
      const rows = keys.map((key) => ({
        key,
        json: localStorage.getItem(PREFIX + key), // null => deletion tombstone
        updatedAt: meta[key] || Date.now(),
      }));
      // Generous, size-scaled timeout: the sheet-side rebuild takes seconds.
      await api({ action: "push", token: cfg.token || "", rows }, 15000 + rows.length * 1500);
      const sentAt = {};
      keys.forEach((k, i) => { sentAt[k] = rows[i].updatedAt; });
      queue = queue.filter((k) => (meta[k] || 0) > (sentAt[k] || 0)); // keep keys edited mid-flight
      saveQueue();
      renderStrip(); // pending count drains batch by batch
    }
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
  if (parsed && parsed.history && typeof parsed.history === "object") return importHistoryMerge(parsed.history);
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

/* History-merge import: a `{ history: { sessions, index } }` payload (e.g. the
   old-app converter) is ADDED to this device's data instead of replacing it.
   Older builds reject these payloads (no `data` key), which is the safe failure.
   After the union, records and PR flags are replayed over the combined
   timeline so badges mean "all-time PR", not "PR since this app existed".
   These two mirror setEffectiveReps / epleyE1rm in the tracker component. */
const effReps = (set, unilateral) =>
  unilateral ? Math.min(Number(set.repsL) || 0, Number(set.repsR) || 0) : Number(set.reps) || 0;
const epley = (w, r) => (Number(w) > 0 && Number(r) > 0 ? Math.round(Number(w) * (1 + Number(r) / 30)) : 0);

function importHistoryMerge(hist) {
  const sessions = hist.sessions && typeof hist.sessions === "object" ? hist.sessions : {};
  const ids = Object.keys(sessions);
  const incoming = Array.isArray(hist.index) ? hist.index.filter((e) => e && e.id) : [];
  if (!ids.length || !incoming.length) throw new Error("History payload has no sessions");
  for (const id of ids) {
    localStorage.setItem(PREFIX + "session:" + id, JSON.stringify(sessions[id]));
    markDirty("session:" + id);
  }

  const local = readJson(PREFIX + "sessions-index", []);
  const kept = Array.isArray(local) ? local.filter((e) => e && e.id) : [];
  const have = new Set(kept.map((e) => e.id)); // existing entries win a collision (re-import stays idempotent)
  const merged = kept.concat(incoming.filter((e) => !have.has(e.id)));
  merged.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  // Replay oldest -> newest. Gym sessions only, same rules as finishWorkout:
  // first-ever entries seed silently, improvements of >0.01 flag a PR.
  const recs = {};
  for (let i = merged.length - 1; i >= 0; i--) {
    const entry = merged[i];
    const raw = localStorage.getItem(PREFIX + "session:" + entry.id);
    if (!raw) continue;
    let s;
    try { s = JSON.parse(raw); } catch (e) { continue; }
    if (!s || s.mode !== "gym") continue;
    let anyPr = false, changed = false;
    for (const ex of s.exercises || []) {
      let topW = 0, bestE1 = 0;
      for (const st of ex.sets || []) {
        const w = Number(st.weight) || 0;
        if (w > topW) topW = w;
        const e1 = epley(w, effReps(st, !!ex.unilateral));
        if (e1 > bestE1) bestE1 = e1;
      }
      if (topW <= 0) continue;
      const rec = recs[ex.exerciseId];
      const isPr = !!rec && (topW > rec.weight + 0.01 || bestE1 > rec.e1rm + 0.01);
      if (isPr !== !!ex.pr) { if (isPr) ex.pr = true; else delete ex.pr; changed = true; }
      if (isPr) anyPr = true;
      if (!rec || topW > rec.weight || bestE1 > rec.e1rm) {
        recs[ex.exerciseId] = { weight: Math.max(topW, rec ? rec.weight : 0), e1rm: Math.max(bestE1, rec ? rec.e1rm : 0), date: s.date };
      }
    }
    if (changed) { localStorage.setItem(PREFIX + "session:" + entry.id, JSON.stringify(s)); markDirty("session:" + entry.id); }
    if (anyPr) entry.pr = true; else delete entry.pr;
  }

  // Records never shrink: keep any existing best the replay can no longer see
  // (e.g. from a session that was later deleted).
  const prevRecs = readJson(PREFIX + "records", {});
  if (prevRecs && typeof prevRecs === "object") {
    for (const k of Object.keys(prevRecs)) {
      const p = prevRecs[k], r = recs[k];
      if (!p) continue;
      if (!r) { recs[k] = p; continue; }
      recs[k] = {
        weight: Math.max(Number(r.weight) || 0, Number(p.weight) || 0),
        e1rm: Math.max(Number(r.e1rm) || 0, Number(p.e1rm) || 0),
        date: (Number(p.weight) || 0) > (Number(r.weight) || 0) ? p.date : r.date,
      };
    }
  }

  localStorage.setItem(PREFIX + "sessions-index", JSON.stringify(merged));
  markDirty("sessions-index");
  localStorage.setItem(PREFIX + "records", JSON.stringify(recs));
  markDirty("records");
  return ids.length;
}

/* ---------- sync strip + panel UI ---------- */

let stripEl = null;
let panelEl = null;

/* ---------- build version + one-tap updates ---------- */

const BUILD = (typeof window !== "undefined" && window.__PPL_BUILD__) || null;
let updateReady = null; // version.json payload of a newer deploy

async function checkForUpdate() {
  if (!BUILD) return false;
  try {
    const res = await fetch("./version.json?ts=" + Date.now(), { cache: "no-store" });
    const v = await res.json();
    if (v && v.hash && v.hash !== BUILD.hash) {
      updateReady = v;
      renderStrip();
      return true;
    }
  } catch (e) { /* offline — check again later */ }
  return false;
}

async function applyUpdate() {
  if (stripEl) stripEl.textContent = "Updating…";
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) {
      let reloaded = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (!reloaded) { reloaded = true; location.reload(); }
      });
      await reg.update(); // new SW installs, skipWaiting + claim, then we reload once
      setTimeout(() => { if (!reloaded) { reloaded = true; location.reload(); } }, 4000);
      return;
    }
  } catch (e) { /* fall through */ }
  location.reload();
}

function fmtTime(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function stripLabel() {
  if (!cfg || !cfg.url) return "☁︎  Back up to Google Sheets — tap to set up";
  if (flushing) return `☁︎  Sheet · syncing…${queue.length > PUSH_BATCH ? ` ${queue.length} left` : ""}`;
  if (queue.length > 0) {
    const off = typeof navigator !== "undefined" && navigator.onLine === false;
    return `☁︎  Sheet · ${queue.length} pending${off ? " (offline)" : ""}`;
  }
  if (lastError) return "☁︎  Sheet · sync error — tap for details";
  return `☁︎  Sheet · synced${lastSyncAt ? " " + fmtTime(lastSyncAt) : ""}`;
}

function renderStrip() {
  if (!stripEl) return;
  if (updateReady) {
    stripEl.textContent = `⬆︎ Update ready (build ${String(updateReady.hash).slice(0, 7)}) — tap to install`;
    stripEl.className = "w-full text-center text-xs py-1 border-b cursor-pointer select-none bg-zinc-950 text-lime-300 border-zinc-800";
    return;
  }
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
      ta.placeholder = "Paste a backup here, then tap the green Import button";
      importArmed = true;
      impBtn.textContent = "Import pasted";
      // Armed = the real CTA now: restyle like the primary Save button.
      impBtn.className = saveBtn.className;
      return;
    }
    try {
      const n = importBackup(ta.value);
      setStatus(`Imported ${n} — reloading…`);
      setTimeout(() => location.reload(), 600);
    } catch (e) { setStatus("Import failed: " + (e.message || e), true); }
  };

  const buildRow = el("div", "flex items-center justify-between gap-2");
  const buildInfo = el("div", "text-xs text-zinc-500",
    BUILD ? `Build ${String(BUILD.hash).slice(0, 7)} · ${new Date(BUILD.builtAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "Build unknown");
  const checkBtn = el("button", "h-11 shrink-0 rounded-xl border border-zinc-700 px-3 text-xs font-semibold text-zinc-300", "Check for updates");
  checkBtn.onclick = async () => {
    setStatus("Checking…");
    const newer = await checkForUpdate();
    if (newer) { setStatus(`Newer build ${String(updateReady.hash).slice(0, 7)} available — tap the strip to install.`); panelEl.classList.add("hidden"); }
    else setStatus(BUILD ? "You're on the latest build." : "No build info in this environment.");
  };
  buildRow.appendChild(buildInfo);
  buildRow.appendChild(checkBtn);
  card.appendChild(buildRow);

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
  // If iOS lets content bleed under the status bar, the strip absorbs that zone.
  stripEl.style.paddingTop = "env(safe-area-inset-top)";
  const root = document.getElementById("root");
  root.parentNode.insertBefore(stripEl, root);
  buildPanel();
  stripEl.onclick = () => { if (updateReady) applyUpdate(); else panelEl.__open(); };
  renderStrip();
  checkForUpdate();
  setInterval(checkForUpdate, 3600 * 1000);

  if (cfg && cfg.url && navigator.onLine !== false) {
    try { await pullAndMerge(); } catch (e) { lastError = String(e.message || e); }
  }
  renderStrip();
  mountApp();

  window.addEventListener("online", () => flush());
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { flush(); checkForUpdate(); } });
  if (queue.length) flush();

  if ("serviceWorker" in navigator) {
    try { navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }); } catch (e) { /* offline shell unavailable */ }
  }
}

// Exposed for tests and console debugging.
export const __shell = { get queue() { return queue; }, get cfg() { return cfg; }, exportBackup, importBackup, pullAndMerge };
