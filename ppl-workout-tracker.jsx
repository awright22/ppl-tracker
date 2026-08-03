import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer,
} from "recharts";
import {
  Dumbbell, History as HistoryIcon, TrendingUp, Settings as SettingsIcon,
  Plus, Minus, X, Check, ChevronLeft, ChevronDown, ChevronUp, MoreVertical,
  Trash2, Pencil, Ban, RotateCcw, AlertTriangle, Loader2, ArrowUp, ArrowDown,
  Heart, Flame, ChevronRight, Shield,
} from "lucide-react";

/* ============================================================
   PPL Workout Tracker — single-file Claude artifact
   Storage: window.storage (async KV) with in-memory fallback.
   Keys: "config", "sessions-index", "session:{id}", "draft"
   ============================================================ */

/* ---------- storage adapter ---------- */

const memStore = new Map();

function nativeStorage() {
  try {
    if (typeof window !== "undefined" && window.storage && typeof window.storage.get === "function") {
      return window.storage;
    }
  } catch (e) { /* window not available */ }
  return null;
}

const store = {
  isNative() { return !!nativeStorage(); },
  // get() on a missing key throws in the artifact env — treat as "no data yet" (null).
  async get(key) {
    const ns = nativeStorage();
    try {
      if (ns) {
        const res = await ns.get(key);
        if (!res || res.value == null) return null;
        return JSON.parse(res.value);
      }
      if (!memStore.has(key)) return null;
      return JSON.parse(memStore.get(key));
    } catch (e) {
      return null;
    }
  },
  async set(key, value) {
    let str;
    try { str = JSON.stringify(value); } catch (e) { return false; }
    const ns = nativeStorage();
    if (ns) {
      try { await ns.set(key, str); return true; } catch (e) { return false; }
    }
    memStore.set(key, str);
    return true;
  },
  async remove(key) {
    const ns = nativeStorage();
    if (ns) {
      try { await ns.delete(key); } catch (e) { /* already gone */ }
      return;
    }
    memStore.delete(key);
  },
};

/* ---------- seed config ---------- */

export const SEED_CONFIG = {
  // QL-recovery program: daily reset + per-day warm-ups + per-day core (after lifts).
  mobility: {
    v: 3,
    general: [
      { id: "dr-9090", name: "90/90 Breathing", dose: "1 min", note: "Feet on wall. Inhale 4s, exhale 8s." },
      { id: "dr-psoas", name: "Supine Psoas Stretch", dose: "R 90s · L 60s", note: "Edge of bed, opposite knee to chest, leg hangs." },
      { id: "dr-clam", name: "Right-Side Clam", dose: "45s", note: "Lie on L side. Open R knee, 3s hold, 10 reps." },
      { id: "dr-fig4", name: "Supine Figure-4", dose: "60s/side", note: "Ankle over knee, pull thigh in." },
      { id: "dr-hamstring", name: "Supine Hamstring Stretch", dose: "45s/side", note: "Towel around foot, leg to ceiling." },
      { id: "dr-rock", name: "Knees-to-Chest Rock", dose: "45s", note: "Hug knees, rock side to side." },
      { id: "dr-twist", name: "Supine Spinal Twist", dose: "60s/side", note: "Knee across body, opposite arm out." },
      { id: "dr-butterfly", name: "Supine Butterfly", dose: "60s", note: "Progress check: soles together, knees fall out. R vs L symmetry." },
    ],
    push: [
      { id: "wu-p-breath", name: "90/90 Breathing", dose: "5–8 breaths", note: "Feet on wall, hips/knees 90°. Press heels in. Exhale mouth 5–8s, sigh at end. Inhale nose into lateral ribs. Pause 3–5s after exhale." },
      { id: "wu-p-hipflexor", name: "Hip Flexor Stretch (R)", dose: "1×30s", note: "Long lunge, R foot back. Tuck tailbone + squeeze R glute first, then shift forward. R arm overhead & slightly across." },
      { id: "wu-p-pec", name: "LB Pec Release", dose: "45s/side", note: "Face wall, ball below collarbone near shoulder. Lean in, roll slowly. Hold tender spots 5–10s. Focus pec minor area." },
      { id: "wu-p-tspine", name: "Foam Roll T-Spine", dose: "45s", note: "Roller under mid-back, hands behind head. Extend over roller. Move 1 inch per segment. Low back stays still." },
      { id: "wu-p-needle", name: "Thread-the-Needle", dose: "6/side", note: "Hands & knees. Slide R hand under L arm, R shoulder drops. Reverse — rotate R hand to ceiling. Slow, feel mid-back." },
      { id: "wu-p-extrot", name: "Cable Ext. Rotations", dose: "15/arm", note: "Cable at elbow height, lightest. Sideways, far hand. Pin elbow at 90°. Rotate forearm out. Slow return.", gymOnly: true },
      { id: "wu-p-facepull", name: "Cable Face Pulls", dose: "15–20", note: "Cable face height, light. Rope, palms down. Pull to face, split rope. Elbows high & wide. Squeeze scaps 1s.", gymOnly: true },
      { id: "wu-p-scappush", name: "Scapular Push-Ups", dose: "10", note: "Push-up position, arms locked. Sink chest between scaps, push floor away, round upper back. Only scaps move." },
      { id: "wu-p-pushup", name: "Push-Ups", dose: "8–10", note: "Hands wider than shoulders. Chest to floor. Scaps squeeze down, spread at top. Bench rehearsal." },
    ],
    pull: [
      { id: "wu-l-breath", name: "90/90 Breathing", dose: "5–8 breaths", note: "Feet on wall, hips/knees 90°. Press heels in. Exhale mouth 5–8s, sigh at end. Inhale nose into lateral ribs. Pause 3–5s after exhale." },
      { id: "wu-l-hipflexor", name: "Hip Flexor Stretch (R)", dose: "1×30s", note: "Long lunge, R foot back. Tuck tailbone + squeeze R glute first, then shift forward. R arm overhead & slightly across." },
      { id: "wu-l-qlrelease", name: "LB QL Release (R)", dose: "~2 min", badge: "Phase out", note: "Side-lying R side, ball above iliac crest, lateral to erectors. 5/10 pressure. Hold spots 20–30s. Stay below 12th rib. Deep sick ache = kidney → reposition." },
      { id: "wu-l-lats", name: "Foam Roll Lats", dose: "45s/side", note: "Side-lying, roller under armpit. Arm overhead, thumb up. Roll armpit to mid-ribcage. Hold tender spots 5–10s." },
      { id: "wu-l-tspine", name: "Foam Roll T-Spine", dose: "45s", note: "Roller under mid-back, hands behind head. Extend over roller. Move 1 inch per segment. Low back stays still." },
      { id: "wu-l-deadbug", name: "Dead Bugs", dose: "2×8/side", note: "On back, arms up, knees 90°. Press low back flat. Lower opposite arm/leg. Teaches bracing for rows." },
      { id: "wu-l-bandwalk", name: "Lateral Band Walk", dose: "10 steps/way", note: "Mini band above ankles, quarter-squat. Lead with heel, toes forward. Control trail leg. Stay low." },
      { id: "wu-l-quadrot", name: "Quad. T-Spine Rotations", dose: "8/side", note: "Hands & knees, R hand behind head. R elbow to L wrist, then to ceiling. Eyes follow. Hips stay square." },
      { id: "wu-l-scapdown", name: "Cable Scap Pull-Downs", dose: "12–15", note: "Cable high, lightest, wide bar. Arms extended. Pull scaps down & together without bending elbows. Hold 1s.", gymOnly: true },
      { id: "wu-l-sapd", name: "Cable SA Pull-Downs", dose: "12–15", note: "Cable high, light. Arms at shoulder height. Pull to thighs in arc, arms straight. Squeeze lats 1s. Slow return.", gymOnly: true },
      { id: "wu-l-facepull", name: "Cable Face Pulls", dose: "15", note: "Cable face height, light. Rope, palms down. Pull to face, split rope. Elbows high & wide. Squeeze scaps 1s.", gymOnly: true },
    ],
    legs: [
      { id: "wu-g-breath", name: "90/90 Breathing", dose: "5–8 breaths", note: "Feet on wall, hips/knees 90°. Press heels in. Exhale mouth 5–8s, sigh at end. Inhale nose into lateral ribs. Pause 3–5s after exhale." },
      { id: "wu-g-hipflexor", name: "Hip Flexor Stretch (R)", dose: "1×30s", note: "Long lunge, R foot back. Tuck tailbone + squeeze R glute first, then shift forward. R arm overhead & slightly across." },
      { id: "wu-g-qlrelease", name: "LB QL Release (R)", dose: "~2 min", badge: "Phase out", note: "Side-lying R side, ball above iliac crest, lateral to erectors. 5/10 pressure. Hold spots 20–30s. Stay below 12th rib. Deep sick ache = kidney → reposition." },
      { id: "wu-g-tfl", name: "Foam Roll R TFL", dose: "90s", note: "Side-lying, roller just below front of hip bone (ASIS). Small rolls over the TFL bulb. Hold tender spots 10s. Releases lateral pelvic tilt contributor." },
      { id: "wu-g-glutefig4", name: "LB R Glute (figure-4)", dose: "~2 min", note: "Sit on floor, cross R ankle over L knee. Lacrosse ball under R glute. Find tender spot → hold pressure + bend/straighten knee 5–10× for active release." },
      { id: "wu-g-bandwalk", name: "Lateral Band Walk", dose: "10 steps/way", note: "Mini band above ankles, quarter-squat. Lead with heel, toes forward. Control trail leg. Stay low." },
    ],
    core: {
      push: [
        { id: "co-p-deadbug", name: "Dead Bugs", dose: "2×10/side", note: "On back, arms up, knees 90°. Press low back flat. Lower opposite arm/leg. Only go as far as back stays glued." },
        { id: "co-p-pallof", name: "Overhead Pallof Press", dose: "2×10/side · 3s hold", note: "Cable chest height, stand perpendicular. Press overhead, hold 3s. Resist rotation + lateral pull.", gymOnly: true },
        { id: "co-p-sideplank", name: "Side Plank (R down)", dose: "2×30–45s", note: "Forearm down, elbow under shoulder. Knees or straight leg. Stack hips, don't sag. L side: 1 set." },
      ],
      pull: [
        { id: "co-l-mcgill", name: "McGill Curl-Up", dose: "2×8 · 10s holds", note: "On back, 1 knee bent, 1 straight. Hands under low back. Lift head/shoulders just off floor, hold 10s. Don't flatten back." },
        { id: "co-l-suitcase", name: "Suitcase Carry", dose: "3×30–40yd/side", note: "Single DB/KB at side, start 25% BW. Walk slow — ribs over pelvis, no lean. L hand = trains R side anti-lateral-flexion.", gymOnly: true },
        { id: "co-l-slbridge", name: "SL Glute Bridge (R)", dose: "2×10 · 3s hold", note: "On back, 1 foot down, other knee to chest. Press heel, lift hips, hold 3s. No hip rotation. L side: 1 set." },
      ],
      legs: [
        { id: "co-g-birddog", name: "Bird Dog", dose: "2×8/side", note: "Hands & knees. Extend opposite arm + leg to torso level. Hold 2s. No hip rotation, no back sag." },
        { id: "co-g-clamshell", name: "Banded Clamshell (R)", dose: "2×15 · 2s hold", note: "Side-lying, band above knees, hips 60°. Open top knee, hold 2s. Feet together, don't roll back. L side: 1 set." },
        { id: "co-g-hipabd", name: "Side-Lying Hip Abd. (R)", dose: "2×15", badge: "Phase out wk 12", note: "Top leg slightly behind, foot turned in (“pour water”). Lift to ceiling, slow lower. No hip hike." },
        { id: "co-g-sideplank", name: "Side Plank (R down)", dose: "2×30s", note: "Forearm down, elbow under shoulder. Knees or straight leg. Stack hips, don't sag. L side: 1 set." },
      ],
    },
  },
  days: {
    push: [
      { id: "bench-db", name: "DB Bench Press", sets: 3, repMin: 8, repMax: 12, increment: 5, unit: "lb", loadType: "db-pair", current: 70 },
      { id: "ohp-db", name: "Seated DB Shoulder Press", sets: 3, repMin: 8, repMax: 12, increment: 5, unit: "lb", loadType: "db-pair", current: 45 },
      { id: "incline-db", name: "DB Incline Bench Press", sets: 3, repMin: 8, repMax: 12, increment: 5, unit: "lb", loadType: "db-pair", current: 45 },
      { id: "lat-raise", name: "Lateral Raises", sets: 3, repMin: 12, repMax: 15, increment: 2.5, unit: "lb", loadType: "db-pair", current: 17.5 },
      { id: "pushdown-rope", name: "Rope Pushdown", sets: 3, repMin: 10, repMax: 12, increment: 5, unit: "lb", loadType: "stack", current: 120 },
    ],
    pull: [
      { id: "row-csdb", name: "Chest-Supported Single-Arm DB Row", sets: 3, repMin: 10, repMax: 12, increment: 5, unit: "lb", loadType: "db-single", current: 70, unilateral: true },
      { id: "pulldown", name: "Lat Pulldown", sets: 3, repMin: 8, repMax: 12, increment: 5, unit: "lb", loadType: "stack", current: 120 },
      { id: "shrug-db", name: "Seated DB Shrugs", sets: 3, repMin: 10, repMax: 12, increment: 5, unit: "lb", loadType: "db-pair", current: 75 },
      { id: "facepull", name: "Face Pulls", sets: 3, repMin: 15, repMax: 20, increment: 5, unit: "lb", loadType: "stack", current: 115 },
      { id: "curl-db", name: "Seated DB Bicep Curl", sets: 3, repMin: 10, repMax: 12, increment: 5, unit: "lb", loadType: "db-pair", current: 35 },
    ],
    legs: [
      { id: "backext-45", name: "45° Back Extension", sets: 3, repMin: 12, repMax: 12, increment: 5, unit: "lb", loadType: "bodyweight-plus", current: 50 },
      { id: "slpress", name: "Single-Leg Leg Press", sets: 3, repMin: 10, repMax: 12, increment: 10, unit: "lb", loadType: "plate-loaded", current: 140, unilateral: true },
      { id: "legpress", name: "Leg Press (bilateral)", sets: 3, repMin: 10, repMax: 12, increment: 10, unit: "lb", loadType: "plate-loaded", current: 385 },
      { id: "slcurl", name: "Single-Leg Curl", sets: 3, repMin: 10, repMax: 12, increment: 5, unit: "lb", loadType: "machine", current: 60, unilateral: true },
      { id: "calf-seated", name: "Seated Calf Raise", sets: 3, repMin: 12, repMax: 15, increment: 10, unit: "lb", loadType: "machine", current: 120 },
    ],
  },
  calisthenics: {
    push: [
      { id: "cal-pushup", name: "Push-Ups", sets: 3, amrap: true, note: "Progress: feet-elevated → decline as reps climb" },
      { id: "cal-pike", name: "Pike Push-Ups", sets: 3, repMin: 8, repMax: 12, note: "Shoulder-press stand-in" },
      { id: "cal-diamond", name: "Diamond Push-Ups", sets: 3, repMin: 10, repMax: 12, note: "Triceps focus" },
      { id: "cal-yraise", name: "Prone Y-Raises", sets: 3, repMin: 15, repMax: 15, note: "Lateral/rear-delt stand-in — limited overload, keep it slow and strict" },
    ],
    pull: [
      { id: "cal-pullup", name: "Pull-Ups", sets: 3, amrap: true, needsBar: true, fallback: "No bar: table inverted rows" },
      { id: "cal-scap", name: "Scapular Pulls", sets: 3, repMin: 8, repMax: 8, needsBar: true, fallback: "No bar: towel rows (slow)" },
      { id: "cal-chinup", name: "Chin-Ups", sets: 3, amrap: true, needsBar: true, note: "Biceps emphasis", fallback: "No bar: towel curls / backpack curls" },
      { id: "cal-tw", name: "Prone T-W Raises", sets: 3, repMin: 15, repMax: 15, note: "Face-pull stand-in" },
    ],
    legs: [
      { id: "cal-split", name: "Supported Split Squats", sets: 3, repMin: 10, repMax: 12, unilateral: true, note: "Hold a doorframe/chair. Knee-friendly depth — stop if right QL flares." },
      { id: "cal-bridge", name: "Single-Leg Glute Bridge", sets: 3, repMin: 12, repMax: 12, unilateral: true, note: "3-second hold at the top" },
      { id: "cal-slide", name: "Sliding / Heel-Walk Leg Curls", sets: 3, repMin: 8, repMax: 10, note: "Socks on smooth floor, or slow heel-walks from bridge" },
      { id: "cal-calf", name: "Single-Leg Calf Raises", sets: 3, repMin: 15, repMax: 15, unilateral: true, note: "Full stretch at the bottom, pause at the top" },
      { id: "cal-wallsit", name: "Wall Sit", sets: 2, repMin: 45, repMax: 45, timed: true },
    ],
  },
};

/* ---------- constants & small utils ---------- */

const DAY_KEYS = ["push", "pull", "legs"];
const DAY_LABEL = { push: "Push", pull: "Pull", legs: "Legs" };
const LOAD_LABEL = {
  "db-pair": "per DB", "db-single": "DB", stack: "stack",
  machine: "machine", "plate-loaded": "loaded", "bodyweight-plus": "BW +",
};
const LOAD_TYPES = ["db-pair", "db-single", "stack", "machine", "plate-loaded", "bodyweight-plus"];
const CHART = { line: "#65a30d", vol: "#71717a", grid: "#27272a", tick: "#71717a", surface: "#18181b", cursor: "#3f3f46" };

const round2 = (n) => Math.round(n * 100) / 100;
const fmtW = (n) => (n == null || Number.isNaN(Number(n)) ? "—" : String(round2(Number(n))));
const pad2 = (n) => String(n).padStart(2, "0");
const makeSessionId = (d) =>
  `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}`;
const uid = () => Math.random().toString(36).slice(2, 8);

function shortDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function fullDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
function daysAgo(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "1d ago";
  return `${days}d ago`;
}
const byDateDesc = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
const byDateAsc = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

/* ---------- progression logic (exported for tests) ---------- */

// Weaker-side reps for a logged set; unilateral progression gates on min(L, R).
export function setEffectiveReps(set, unilateral) {
  if (unilateral) return Math.min(Number(set.repsL) || 0, Number(set.repsR) || 0);
  return Number(set.reps) || 0;
}

export function computeSuggestion(ex, lastPerf) {
  if (!lastPerf || !Array.isArray(lastPerf.sets) || lastPerf.sets.length === 0) return null;
  const vals = lastPerf.sets.map((s) => setEffectiveReps(s, ex.unilateral));
  const cur = Number(ex.current) || 0;
  if (vals.every((v) => v >= ex.repMax)) {
    const target = round2(cur + (Number(ex.increment) || 0));
    return { kind: "bump", target, label: `Go to ${fmtW(target)}` };
  }
  if (vals.some((v) => v < ex.repMin)) {
    return { kind: "build", target: cur, label: `Stay at ${fmtW(cur)} — build reps` };
  }
  return { kind: "hold", target: cur, label: `Stay at ${fmtW(cur)}` };
}

// sessions: newest-first list of full session objects for one dayType+mode.
export function findLastPerf(sessions, exerciseId) {
  for (const s of sessions) {
    const ex = (s.exercises || []).find((e) => e.exerciseId === exerciseId && e.sets && e.sets.length > 0);
    if (ex) return { date: s.date, sessionId: s.id, sets: ex.sets, note: ex.note || "" };
  }
  return null;
}

function setVolume(set, unilateral) {
  const w = Number(set.weight) || 0;
  return round2(w * setEffectiveReps(set, unilateral));
}

function fmtSetShort(set, ex) {
  if (ex.unilateral) return `L${Number(set.repsL) || 0}·R${Number(set.repsR) || 0}`;
  if (ex.timed) return `${Number(set.reps) || 0}s`;
  return String(Number(set.reps) || 0);
}

function fmtPerfLine(perf, ex) {
  const sets = perf.sets;
  const weights = [...new Set(sets.map((s) => s.weight).filter((w) => w != null))];
  const reps = sets.map((s) => fmtSetShort(s, ex)).join(", ");
  if (weights.length === 0) return reps;
  if (weights.length === 1) return `${fmtW(weights[0])} × ${reps}`;
  return sets.map((s) => `${fmtW(s.weight)}×${fmtSetShort(s, ex)}`).join(", ");
}

function bestSetOf(ex) {
  if (!ex.sets || ex.sets.length === 0) return null;
  return ex.sets.reduce((a, b) => {
    const wa = Number(a.weight) || 0;
    const wb = Number(b.weight) || 0;
    if (wb !== wa) return wb > wa ? b : a;
    return setEffectiveReps(b, ex.unilateral) > setEffectiveReps(a, ex.unilateral) ? b : a;
  });
}

function headlineFor(exercises) {
  const ex = exercises.find((e) => e.sets && e.sets.length > 0);
  if (!ex) return "";
  const best = bestSetOf(ex);
  if (!best) return "";
  const rep = fmtSetShort(best, ex);
  if (best.weight != null) return `${ex.name} ${fmtW(best.weight)}×${rep}`;
  return `${ex.name} ×${rep}`;
}

function countSets(exercises) {
  return exercises.reduce((n, e) => n + ((e.sets && e.sets.length) || 0), 0);
}

/* ---------- Apple Health bridge (via the iOS Shortcuts app) ---------- */
// Artifacts can't call HealthKit, so we hand a JSON payload to a user-made
// "Log Lift" shortcut whose Log Workout action writes the session to Health.

export function buildHealthPayload(session) {
  const start = new Date(session.date);
  const end = session.endDate ? new Date(session.endDate) : new Date(start.getTime() + 45 * 60000);
  let minutes = Math.round((end.getTime() - start.getTime()) / 60000);
  if (!Number.isFinite(minutes) || minutes < 1) minutes = 45;
  if (minutes > 240) minutes = 240;
  const local = (d) =>
    d.toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "numeric" }) +
    " " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const sets = countSets(session.exercises || []);
  return JSON.stringify(
    {
      workoutType: session.mode === "calisthenics" ? "Functional Strength Training" : "Traditional Strength Training",
      day: session.dayType,
      mode: session.mode,
      start: session.date,
      end: end.toISOString(),
      startLocal: local(start),
      endLocal: local(end),
      minutes,
      calories: Math.round(minutes * 5), // rough strength-training estimate for the Health log
      sets,
      exercises: (session.exercises || []).length,
      summary: `${DAY_LABEL[session.dayType] || session.dayType} day — ${sets} sets · ${headlineFor(session.exercises || [])}`,
    },
    null,
    2
  );
}

async function copyToClipboard(text) {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) { /* fall through to execCommand */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch (e) {
    return false;
  }
}

function HealthLogButton({ session, pushToast }) {
  const [showRaw, setShowRaw] = useState(false);
  const doLog = async () => {
    const payload = buildHealthPayload(session);
    const ok = await copyToClipboard(payload);
    if (ok) {
      pushToast("Copied — run your “Log Lift” shortcut to add it to Health", { tone: "success", ttl: 6000 });
      try {
        // On iOS, try to launch the shortcut directly with the clipboard as input.
        if (/iPhone|iPad|iPod/.test((typeof navigator !== "undefined" && navigator.userAgent) || "")) {
          window.open("shortcuts://run-shortcut?name=Log%20Lift&input=clipboard", "_blank");
        }
      } catch (e) { /* blocked scheme — clipboard path still works */ }
    } else {
      setShowRaw(true);
      pushToast("Couldn't reach the clipboard — copy the text below instead", { tone: "error" });
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={doLog}
        className={`flex h-11 items-center justify-center gap-2 rounded-xl border border-zinc-700 px-4 text-sm font-semibold text-zinc-200 active:bg-zinc-800 ${TRANS}`}
      >
        <Heart size={16} className="text-lime-400" /> Copy for Apple Health
      </button>
      {showRaw && (
        <textarea
          readOnly
          rows={5}
          value={buildHealthPayload(session)}
          onFocus={(e) => e.target.select()}
          className="w-full rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-400 outline-none"
        />
      )}
    </div>
  );
}

/* ---------- tiny UI primitives ---------- */

const TRANS = "transition-colors motion-reduce:transition-none";

function Spinner({ label }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-zinc-500">
      <Loader2 size={28} className="animate-spin motion-reduce:animate-none" />
      <div className="text-sm">{label || "Loading…"}</div>
    </div>
  );
}

function EmptyState({ icon, title, hint }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-zinc-800 bg-zinc-900 px-6 py-10 text-center">
      <div className="text-zinc-600">{icon}</div>
      <div className="font-semibold text-zinc-200">{title}</div>
      {hint ? <div className="text-sm text-zinc-500">{hint}</div> : null}
    </div>
  );
}

// Two-step destructive confirm: first tap arms, second tap fires.
function useArmed(ms = 2600) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return undefined;
    const t = setTimeout(() => setArmed(false), ms);
    return () => clearTimeout(t);
  }, [armed, ms]);
  return [armed, setArmed];
}

function Seg({ options, value, onChange }) {
  return (
    <div className="flex rounded-xl bg-zinc-900 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`h-11 flex-1 rounded-lg text-sm font-semibold ${TRANS} ${
            value === o.value ? "bg-zinc-700 text-zinc-50" : "text-zinc-500 active:bg-zinc-800"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// Stepper with tap-to-type on the number. Touch targets are 48px.
function Stepper({ value, onChange, step = 1, min = 0, max = 9999, unit, small }) {
  const [editing, setEditing] = useState(false);
  const [txt, setTxt] = useState("");
  const commit = () => {
    setEditing(false);
    const n = parseFloat(txt.replace(",", "."));
    if (!Number.isNaN(n)) onChange(Math.min(max, Math.max(min, round2(n))));
  };
  const btn = `${small ? "h-11 w-11" : "h-12 w-12"} shrink-0 rounded-xl bg-zinc-800 text-zinc-200 flex items-center justify-center active:bg-zinc-700 ${TRANS}`;
  return (
    <div className="flex items-center gap-1">
      <button aria-label="decrease" className={btn} onClick={() => onChange(Math.max(min, round2((Number(value) || 0) - step)))}>
        <Minus size={20} />
      </button>
      {editing ? (
        <input
          autoFocus
          inputMode="decimal"
          value={txt}
          onChange={(e) => setTxt(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); }}
          className="h-12 w-20 rounded-xl border border-lime-400 bg-zinc-950 text-center text-lg font-bold text-zinc-50 outline-none"
        />
      ) : (
        <button onClick={() => { setTxt(String(value ?? "")); setEditing(true); }} className="h-12 w-20 text-center">
          <span className={`${small ? "text-xl" : "text-2xl"} font-bold tabular-nums text-zinc-50`}>{fmtW(value)}</span>
          {unit ? <span className="ml-1 text-xs text-zinc-500">{unit}</span> : null}
        </button>
      )}
      <button aria-label="increase" className={btn} onClick={() => onChange(Math.min(max, round2((Number(value) || 0) + step)))}>
        <Plus size={20} />
      </button>
    </div>
  );
}

function Toasts({ toasts }) {
  if (!toasts.length) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg ${
            t.tone === "error"
              ? "border-red-900 bg-zinc-900 text-red-200"
              : t.tone === "success"
                ? "border-zinc-700 bg-zinc-900 text-lime-300"
                : "border-zinc-700 bg-zinc-900 text-zinc-200"
          }`}
        >
          {t.tone === "error" ? <AlertTriangle size={16} className="shrink-0 text-red-400" /> : null}
          <div className="flex-1">{t.msg}</div>
          {t.action ? (
            <button onClick={t.action.fn} className="h-11 shrink-0 rounded-lg bg-zinc-800 px-3 font-semibold text-lime-300 active:bg-zinc-700">
              {t.action.label}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/* ---------- main app ---------- */

export default function App() {
  const [phase, setPhase] = useState("loading");
  const [config, setConfig] = useState(null);
  const [index, setIndex] = useState([]);
  const [draft, setDraftState] = useState(null);
  const [tab, setTab] = useState("workout");
  const [homeMode, setHomeMode] = useState("gym");
  const [toasts, setToasts] = useState([]);
  const [qlPrompt, setQlPrompt] = useState(null); // index entry awaiting QL answer
  const [viewer, setViewer] = useState(null); // { id } — full-screen session viewer
  const [starting, setStarting] = useState(false);
  const [justFinished, setJustFinished] = useState(null); // last saved session, for the Health card

  const draftRef = useRef(null);
  const sessionCache = useRef(new Map());
  const toastId = useRef(0);
  const draftTimer = useRef(null);

  /* --- toasts --- */
  const pushToast = useCallback((msg, opts = {}) => {
    toastId.current += 1;
    const id = toastId.current;
    setToasts((t) => [...t.slice(-2), { id, msg, tone: opts.tone, action: opts.action }]);
    const ttl = opts.ttl || (opts.action ? 8000 : 3200);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ttl);
  }, []);

  // Failed writes surface a retry toast — a save must never fail silently.
  const persist = useCallback(async (key, value, label) => {
    const ok = await store.set(key, value);
    if (!ok) {
      pushToast(`Couldn't save ${label}`, {
        tone: "error",
        action: { label: "Retry", fn: () => persist(key, value, label) },
      });
    }
    return ok;
  }, [pushToast]);

  const loadSession = useCallback(async (id) => {
    if (sessionCache.current.has(id)) return sessionCache.current.get(id);
    const s = await store.get(`session:${id}`);
    if (s) sessionCache.current.set(id, s);
    return s;
  }, []);

  /* --- draft mutation + checkpointing --- */
  const setDraft = useCallback((next, save) => {
    draftRef.current = next;
    setDraftState(next);
    if (draftTimer.current) clearTimeout(draftTimer.current);
    if (next == null || save === "none") return;
    if (save === "now") {
      persist("draft", next, "workout");
    } else {
      const snap = next;
      draftTimer.current = setTimeout(() => persist("draft", snap, "workout"), 1500);
    }
  }, [persist]);

  const mutateDraft = useCallback((mut, save) => {
    const cur = draftRef.current;
    if (!cur) return;
    setDraft(mut(cur), save);
  }, [setDraft]);

  /* --- boot --- */
  useEffect(() => {
    let alive = true;
    (async () => {
      const [cfg, idx, dr] = await Promise.all([
        store.get("config"),
        store.get("sessions-index"),
        store.get("draft"),
      ]);
      if (!alive) return;
      let c = cfg;
      if (!c || !c.days || !c.calisthenics) {
        c = SEED_CONFIG;
        persist("config", SEED_CONFIG, "starting config");
      } else if (!c.mobility || c.mobility.v !== SEED_CONFIG.mobility.v) {
        // Older stored configs predate this warm-up/core routine — replace with the seed.
        c = { ...c, mobility: SEED_CONFIG.mobility };
        persist("config", c, "warm-ups");
      }
      const list = Array.isArray(idx) ? [...idx].sort(byDateDesc) : [];
      setConfig(c);
      setIndex(list);
      if (dr && Array.isArray(dr.exercises)) {
        draftRef.current = dr;
        setDraftState(dr);
        pushToast("Resumed in-progress workout");
      }
      // 24h QL check: latest gym legs session, unanswered, 12h–120h old.
      const legs = list.find((e) => e.dayType === "legs" && e.mode === "gym");
      if (legs && legs.ql === null) {
        const hrs = (Date.now() - new Date(legs.date).getTime()) / 3600000;
        if (hrs >= 12 && hrs <= 120) setQlPrompt(legs);
      }
      setPhase("ready");
    })();
    return () => { alive = false; };
  }, [persist, pushToast]);

  /* --- QL check answer --- */
  const answerQl = useCallback(async (entryId, answer) => {
    setQlPrompt(null);
    setIndex((prev) => {
      const next = prev.map((e) => (e.id === entryId ? { ...e, ql: answer } : e));
      persist("sessions-index", next, "history");
      return next;
    });
    if (answer === "dismissed") return;
    const s = await loadSession(entryId);
    if (s) {
      const ns = { ...s, qlCheck: answer };
      sessionCache.current.set(entryId, ns);
      persist(`session:${entryId}`, ns, "QL answer");
    }
  }, [loadSession, persist]);

  /* --- start workout --- */
  const startWorkout = useCallback(async (dayType, mode) => {
    if (!config || starting) return;
    setStarting(true);
    try {
      const recent = index.filter((e) => e.dayType === dayType && e.mode === mode).slice(0, 6);
      const sessions = [];
      for (const e of recent) {
        const s = await loadSession(e.id); // sequential, newest first; cached after first load
        if (s) sessions.push(s);
      }
      const plan = (mode === "gym" ? config.days[dayType] : config.calisthenics[dayType]) || [];
      const now = new Date();
      const exercises = plan.map((ex) => {
        const lastPerf = findLastPerf(sessions, ex.id);
        const suggestion = mode === "gym" ? computeSuggestion(ex, lastPerf) : null;
        const firstSet = lastPerf && lastPerf.sets[0];
        const defR = (side) => {
          if (firstSet) {
            const v = ex.unilateral ? firstSet[side] : firstSet.reps;
            if (v != null) return Number(v) || 0;
          }
          if (ex.amrap) return 10;
          return ex.repMax || 10;
        };
        const pending = {};
        if (mode === "gym") pending.weight = ex.current;
        if (ex.unilateral) { pending.repsL = defR("repsL"); pending.repsR = defR("repsR"); }
        else pending.reps = defR();
        return {
          exerciseId: ex.id, name: ex.name,
          unilateral: !!ex.unilateral, timed: !!ex.timed, amrap: !!ex.amrap, needsBar: !!ex.needsBar,
          loadType: ex.loadType || null, repMin: ex.repMin ?? null, repMax: ex.repMax ?? null,
          increment: ex.increment || 0, targetSets: ex.sets || 3, current: ex.current ?? null,
          exNote: ex.note || "", fallback: ex.fallback || "",
          lastPerf, suggestion, acceptedTarget: null,
          sets: [], note: "", skipped: false, pending,
        };
      });
      // De-dupe the minute-resolution id so two same-minute sessions can't overwrite each other.
      let id = makeSessionId(now);
      for (let bump = 2; index.some((e) => e.id === id); bump += 1) id = `${makeSessionId(now)}-${bump}`;
      const d = { id, date: now.toISOString(), dayType, mode, exercises };
      setJustFinished(null);
      setDraft(d, "now");
      setTab("workout");
    } finally {
      setStarting(false);
    }
  }, [config, index, loadSession, setDraft, starting]);

  const discardDraft = useCallback(() => {
    setDraft(null);
    store.remove("draft");
    pushToast("Workout discarded");
  }, [pushToast, setDraft]);

  /* --- finish workout --- */
  const finishWorkout = useCallback(async () => {
    const d = draftRef.current;
    if (!d) return;
    const kept = d.exercises
      .filter((e) => e.sets.length > 0)
      .map((e) => ({
        exerciseId: e.exerciseId, name: e.name,
        unilateral: e.unilateral || undefined, timed: e.timed || undefined,
        sets: e.sets, note: e.note || "",
      }));
    if (kept.length === 0) {
      pushToast("No sets logged yet — log a set or discard", { tone: "error" });
      return;
    }
    const isLegsGym = d.mode === "gym" && d.dayType === "legs";
    const session = {
      id: d.id, date: d.date, endDate: new Date().toISOString(),
      dayType: d.dayType, mode: d.mode,
      exercises: kept, qlCheck: isLegsGym ? null : undefined,
    };
    const okSession = await store.set(`session:${d.id}`, session);
    if (!okSession) {
      pushToast("Save failed — workout kept open", {
        tone: "error",
        action: { label: "Retry", fn: finishWorkout },
      });
      return;
    }
    sessionCache.current.set(d.id, session);
    const entry = {
      id: d.id, date: d.date, dayType: d.dayType, mode: d.mode,
      headline: headlineFor(kept), setCount: countSets(kept),
      ql: isLegsGym ? null : undefined,
    };
    setIndex((prev) => {
      const next = [entry, ...prev.filter((e) => e.id !== d.id)].sort(byDateDesc);
      persist("sessions-index", next, "history");
      return next;
    });
    // Update working weights: an accepted suggestion (or any uniform weight change)
    // becomes the new `current` once it was actually lifted.
    if (d.mode === "gym") {
      setConfig((prevCfg) => {
        let changed = false;
        const dayList = (prevCfg.days[d.dayType] || []).map((cfgEx) => {
          const de = d.exercises.find((e) => e.exerciseId === cfgEx.id && e.sets.length > 0);
          if (!de) return cfgEx;
          const weights = [...new Set(de.sets.map((s) => s.weight))];
          let next = cfgEx.current;
          if (weights.length === 1 && weights[0] != null && weights[0] > 0) next = weights[0];
          else if (de.acceptedTarget != null && de.sets.some((s) => s.weight === de.acceptedTarget)) next = de.acceptedTarget;
          if (next !== cfgEx.current) { changed = true; return { ...cfgEx, current: next }; }
          return cfgEx;
        });
        if (!changed) return prevCfg;
        const nc = { ...prevCfg, days: { ...prevCfg.days, [d.dayType]: dayList } };
        persist("config", nc, "working weights");
        return nc;
      });
    }
    setDraft(null);
    store.remove("draft");
    setJustFinished(session);
    pushToast(`${DAY_LABEL[d.dayType]} day saved — ${entry.setCount} sets`, { tone: "success" });
  }, [persist, pushToast, setDraft]);

  /* --- save edited session (from viewer) --- */
  const saveEditedSession = useCallback(async (session) => {
    const ok = await store.set(`session:${session.id}`, session);
    if (!ok) {
      pushToast("Couldn't save changes", {
        tone: "error",
        action: { label: "Retry", fn: () => saveEditedSession(session) },
      });
      return false;
    }
    sessionCache.current.set(session.id, session);
    setIndex((prev) => {
      const next = prev.map((e) =>
        e.id === session.id
          ? { ...e, headline: headlineFor(session.exercises), setCount: countSets(session.exercises), ql: session.qlCheck !== undefined ? (session.qlCheck ?? null) : e.ql }
          : e
      );
      persist("sessions-index", next, "history");
      return next;
    });
    pushToast("Session updated", { tone: "success" });
    return true;
  }, [persist, pushToast]);

  const deleteSession = useCallback(async (id) => {
    store.remove(`session:${id}`);
    sessionCache.current.delete(id);
    setIndex((prev) => {
      const next = prev.filter((e) => e.id !== id);
      persist("sessions-index", next, "history");
      return next;
    });
    setViewer(null);
    pushToast("Session deleted");
  }, [persist, pushToast]);

  const saveConfig = useCallback((next) => {
    setConfig(next);
    persist("config", next, "settings");
  }, [persist]);

  /* --- render --- */
  if (phase === "loading" || !config) {
    return (
      <div className="min-h-screen bg-black text-zinc-100">
        <div className="mx-auto max-w-md px-4 pt-24"><Spinner label="Loading your training data…" /></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-zinc-100">
      <div className="mx-auto max-w-md px-4 pb-32 pt-4">
        {tab === "workout" && (
          draft ? (
            <LoggingScreen
              draft={draft}
              mutateDraft={mutateDraft}
              onFinish={finishWorkout}
              onDiscard={discardDraft}
              mobility={config.mobility}
            />
          ) : (
            <HomeScreen
              index={index}
              mode={homeMode}
              setMode={setHomeMode}
              onStart={startWorkout}
              starting={starting}
              qlPrompt={qlPrompt}
              answerQl={answerQl}
              justFinished={justFinished}
              dismissJustFinished={() => setJustFinished(null)}
              pushToast={pushToast}
            />
          )
        )}
        {tab === "history" && (
          <HistoryScreen index={index} onOpen={(id) => setViewer({ id })} />
        )}
        {tab === "progress" && (
          <ProgressScreen config={config} index={index} loadSession={loadSession} onOpen={(id) => setViewer({ id })} />
        )}
        {tab === "settings" && (
          <SettingsScreen config={config} saveConfig={saveConfig} />
        )}
      </div>

      {viewer && (
        <SessionViewer
          id={viewer.id}
          config={config}
          loadSession={loadSession}
          onClose={() => setViewer(null)}
          onSave={saveEditedSession}
          onDelete={deleteSession}
          pushToast={pushToast}
        />
      )}

      <TabBar tab={tab} setTab={setTab} hasDraft={!!draft} />
      <Toasts toasts={toasts} />
    </div>
  );
}

/* ---------- tab bar ---------- */

function TabBar({ tab, setTab, hasDraft }) {
  const items = [
    { key: "workout", label: "Workout", icon: Dumbbell },
    { key: "history", label: "History", icon: HistoryIcon },
    { key: "progress", label: "Progress", icon: TrendingUp },
    { key: "settings", label: "Settings", icon: SettingsIcon },
  ];
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-800 bg-zinc-950/90 backdrop-blur" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      <div className="mx-auto flex max-w-md">
        {items.map((it) => {
          const Icon = it.icon;
          const active = tab === it.key;
          return (
            <button
              key={it.key}
              onClick={() => setTab(it.key)}
              className={`relative flex h-16 flex-1 flex-col items-center justify-center gap-1 pb-2 ${TRANS} ${
                active ? "text-lime-400" : "text-zinc-500 active:text-zinc-300"
              }`}
            >
              <Icon size={22} />
              <span className="text-xs font-medium">{it.label}</span>
              {it.key === "workout" && hasDraft ? (
                <span className="absolute right-6 top-2 h-2 w-2 rounded-full bg-lime-400" />
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- home ---------- */

function HomeScreen({ index, mode, setMode, onStart, starting, qlPrompt, answerQl, justFinished, dismissJustFinished, pushToast }) {
  const [armedDay, setArmedDay] = useState(null);
  useEffect(() => {
    if (!armedDay) return undefined;
    const t = setTimeout(() => setArmedDay(null), 2600);
    return () => clearTimeout(t);
  }, [armedDay]);

  const lastFor = (day) => index.find((e) => e.dayType === day && e.mode === mode);

  return (
    <div className="flex flex-col gap-4">
      <header className="pt-2">
        <div className="text-xs font-semibold uppercase tracking-widest text-lime-400">PPL Tracker</div>
        <h1 className="text-2xl font-bold">{new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</h1>
      </header>

      {qlPrompt && (
        <div className="rounded-2xl border border-amber-400/40 bg-zinc-900 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="mt-1 shrink-0 text-amber-400" />
            <div className="flex-1">
              <div className="text-sm font-semibold text-zinc-100">
                Legs day {shortDate(qlPrompt.date)} — how's the right QL today?
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => answerQl(qlPrompt.id, "same-or-better")}
                  className={`h-11 flex-1 rounded-xl bg-zinc-800 text-sm font-semibold text-lime-300 active:bg-zinc-700 ${TRANS}`}
                >
                  Same or better
                </button>
                <button
                  onClick={() => answerQl(qlPrompt.id, "worse")}
                  className={`h-11 flex-1 rounded-xl bg-zinc-800 text-sm font-semibold text-red-300 active:bg-zinc-700 ${TRANS}`}
                >
                  Worse
                </button>
              </div>
            </div>
            <button aria-label="dismiss" onClick={() => answerQl(qlPrompt.id, "dismissed")} className="flex h-11 w-11 shrink-0 items-center justify-center text-zinc-500">
              <X size={18} />
            </button>
          </div>
        </div>
      )}

      {justFinished && (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
          <div className="flex items-start gap-3">
            <Heart size={18} className="mt-1 shrink-0 text-lime-400" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-zinc-100">
                {DAY_LABEL[justFinished.dayType]} day saved
              </div>
              <div className="mt-1 text-xs text-zinc-500">
                Send it to Apple Health as a strength workout — needs the one-time shortcut described in Settings.
              </div>
              <div className="mt-3">
                <HealthLogButton session={justFinished} pushToast={pushToast} />
              </div>
            </div>
            <button aria-label="dismiss health card" onClick={dismissJustFinished} className="flex h-11 w-11 shrink-0 items-center justify-center text-zinc-500">
              <X size={18} />
            </button>
          </div>
        </div>
      )}

      <Seg
        value={mode}
        onChange={setMode}
        options={[{ value: "gym", label: "Gym" }, { value: "calisthenics", label: "Bodyweight" }]}
      />
      {mode === "calisthenics" && (
        <div className="-mt-2 text-xs text-zinc-500">
          Travel mode — bodyweight variants of each day. Logs reps only; gym weights stay untouched.
        </div>
      )}

      <div className="flex flex-col gap-3">
        {DAY_KEYS.map((day) => {
          const last = lastFor(day);
          const armed = armedDay === day;
          return (
            <button
              key={day}
              disabled={starting}
              onClick={() => onStart(day, mode)}
              className={`group rounded-2xl border p-5 text-left ${TRANS} ${
                armed ? "border-lime-400 bg-zinc-900" : "border-zinc-800 bg-zinc-900 active:border-zinc-600"
              } ${starting ? "opacity-60" : ""}`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-2xl font-bold">{DAY_LABEL[day]}</div>
                  <div className="mt-1 text-xs text-zinc-500">
                    {last ? `${daysAgo(last.date)} · ${last.headline || `${last.setCount} sets`}` : "Never logged — start here"}
                  </div>
                </div>
                <div className={`flex h-12 w-12 items-center justify-center rounded-full bg-lime-400 text-black ${TRANS}`}>
                  {starting ? <Loader2 size={22} className="animate-spin motion-reduce:animate-none" /> : <Dumbbell size={22} />}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {index.length === 0 && (
        <div className="text-center text-xs text-zinc-600">
          First run — tap a day to start logging. Your seed weights are already loaded.
        </div>
      )}
    </div>
  );
}

/* ---------- logging ---------- */

function LoggingScreen({ draft, mutateDraft, onFinish, onDiscard, mobility }) {
  const [armedDiscard, setArmedDiscard] = useArmed();
  const [finishing, setFinishing] = useState(false);
  const [showMobility, setShowMobility] = useState(false);
  const [showCore, setShowCore] = useState(false);
  const totalSets = countSets(draft.exercises);
  const dayName = DAY_LABEL[draft.dayType] || draft.dayType;
  const filterMode = (items) => (items || []).filter((it) => !(draft.mode === "calisthenics" && it.gymOnly));
  const warmSections = mobility
    ? [
        {
          title: "Daily reset",
          sub: "~12 min · floor · no equipment",
          foot: "Daily for 2 weeks before evaluating. Markers: butterfly knee symmetry + right figure-4 range vs left.",
          items: filterMode(mobility.general),
        },
        { title: `${dayName}-day warm-up`, items: filterMode(mobility[draft.dayType]) },
      ]
    : null;
  const coreItems = mobility && mobility.core ? filterMode(mobility.core[draft.dayType]) : [];

  const doFinish = async () => {
    if (finishing) return;
    setFinishing(true);
    try { await onFinish(); } finally { setFinishing(false); }
  };

  return (
    <div className="flex flex-col gap-4">
      <header className="sticky top-0 z-20 -mx-4 border-b border-zinc-800 bg-black/90 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-lg font-bold">
              {DAY_LABEL[draft.dayType]}
              {draft.mode === "calisthenics" && <span className="ml-2 rounded bg-zinc-800 px-2 py-1 text-xs font-semibold text-zinc-300">BODYWEIGHT</span>}
            </div>
            <div className="text-xs text-zinc-500">{fullDate(draft.date)} · {totalSets} sets logged</div>
          </div>
          <button
            onClick={doFinish}
            disabled={finishing}
            className={`h-11 rounded-xl bg-lime-400 px-4 text-sm font-bold text-black active:bg-lime-300 ${TRANS} ${finishing ? "opacity-60" : ""}`}
          >
            Finish
          </button>
        </div>
      </header>

      {mobility && (
        <button
          onClick={() => setShowMobility(true)}
          className={`flex items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-left active:border-zinc-600 ${TRANS}`}
        >
          <Flame size={18} className="shrink-0 text-lime-400" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-zinc-100">Warm-up & mobility</div>
            <div className="text-xs text-zinc-500">Daily reset + {dayName}-day warm-up</div>
          </div>
          <ChevronRight size={16} className="shrink-0 text-zinc-600" />
        </button>
      )}

      {draft.exercises.map((ex, i) => (
        <ExerciseCard key={ex.exerciseId} ex={ex} idx={i} count={draft.exercises.length} mode={draft.mode} mutateDraft={mutateDraft} />
      ))}

      {coreItems.length > 0 && (
        <button
          onClick={() => setShowCore(true)}
          className={`flex items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-left active:border-zinc-600 ${TRANS}`}
        >
          <Shield size={18} className="shrink-0 text-lime-400" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-zinc-100">Core — after lifts</div>
            <div className="text-xs text-zinc-500">{coreItems.map((it) => it.name.replace(/\s*\(.*\)$/, "")).join(" · ")}</div>
          </div>
          <ChevronRight size={16} className="shrink-0 text-zinc-600" />
        </button>
      )}

      {showMobility && warmSections && (
        <MobilityScreen
          title="Warm-up & mobility"
          subtitle={`${dayName} day · check them off as you go`}
          sections={warmSections}
          doneLabel="Done — start lifting"
          onClose={() => setShowMobility(false)}
        />
      )}
      {showCore && (
        <MobilityScreen
          title="Core — after lifts"
          subtitle={`${dayName} day · anti-rotation & QL work`}
          sections={[{ title: `${dayName}-day core`, items: coreItems }]}
          doneLabel="Done — finish up"
          onClose={() => setShowCore(false)}
        />
      )}

      <button
        onClick={doFinish}
        disabled={finishing}
        className={`h-14 rounded-2xl bg-lime-400 text-base font-bold text-black active:bg-lime-300 ${TRANS} ${finishing ? "opacity-60" : ""}`}
      >
        {finishing ? "Saving…" : `Finish workout · ${totalSets} sets`}
      </button>
      <button
        onClick={() => { if (armedDiscard) onDiscard(); else setArmedDiscard(true); }}
        className={`h-12 rounded-2xl border text-sm font-semibold ${TRANS} ${
          armedDiscard ? "border-red-500 text-red-400" : "border-zinc-800 text-zinc-500 active:text-zinc-300"
        }`}
      >
        {armedDiscard ? "Tap again to discard workout" : "Discard workout"}
      </button>
    </div>
  );
}

function MobilityScreen({ title, subtitle, sections, doneLabel, onClose }) {
  const [done, setDone] = useState(() => new Set());
  const toggle = (id) => {
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-black" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <div className="mx-auto max-w-md px-4 pb-16 pt-4">
        <header className="sticky top-0 z-10 -mx-4 border-b border-zinc-800 bg-black/90 px-4 py-3 backdrop-blur">
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-zinc-400 active:bg-zinc-800" aria-label="back">
              <ChevronLeft size={22} />
            </button>
            <div>
              <div className="text-base font-bold">{title}</div>
              <div className="text-xs text-zinc-500">{subtitle}</div>
            </div>
          </div>
        </header>

        <div className="flex flex-col gap-4 pt-4">
          {sections.map((sec) => (
            <section key={sec.title}>
              <div className="flex items-baseline gap-2 px-1 pb-2">
                <div className="text-xs font-semibold uppercase tracking-widest text-zinc-500">{sec.title}</div>
                {sec.sub ? <div className="text-xs text-zinc-600">{sec.sub}</div> : null}
              </div>
              <div className="flex flex-col divide-y divide-zinc-800 rounded-2xl border border-zinc-800 bg-zinc-900">
                {sec.items.length === 0 && (
                  <div className="px-4 py-4 text-sm text-zinc-600">Nothing here yet.</div>
                )}
                {sec.items.map((it) => {
                  const checked = done.has(it.id);
                  return (
                    <button key={it.id} onClick={() => toggle(it.id)} className="flex items-start gap-3 px-4 py-3 text-left">
                      <span
                        className={`mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${TRANS} ${
                          checked ? "border-lime-400 bg-lime-400 text-black" : "border-zinc-600"
                        }`}
                      >
                        {checked ? <Check size={14} /> : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={`block text-sm font-semibold ${checked ? "text-zinc-500 line-through" : "text-zinc-100"}`}>
                          {it.name}
                          {it.badge ? (
                            <span className="ml-2 inline-block rounded-full border border-amber-400/60 px-2 text-xs font-bold uppercase tracking-wide text-amber-300">
                              {it.badge}
                            </span>
                          ) : null}
                        </span>
                        {it.note ? <span className="mt-1 block text-xs leading-relaxed text-zinc-500">{it.note}</span> : null}
                      </span>
                      <span className="shrink-0 pl-1 text-right text-xs font-semibold tabular-nums text-zinc-400">{it.dose}</span>
                    </button>
                  );
                })}
              </div>
              {sec.foot ? <div className="px-1 pt-2 text-xs text-zinc-600">{sec.foot}</div> : null}
            </section>
          ))}
          <button onClick={onClose} className={`h-12 rounded-2xl bg-lime-400 text-sm font-bold text-black active:bg-lime-300 ${TRANS}`}>
            {doneLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function patchExercise(draft, idx, patch) {
  const exercises = draft.exercises.map((e, i) => (i === idx ? { ...e, ...patch } : e));
  return { ...draft, exercises };
}

function ExerciseCard({ ex, idx, count, mode, mutateDraft }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(!!ex.note);

  const repTarget = ex.amrap
    ? "AMRAP"
    : ex.repMin === ex.repMax ? `${ex.repMax}${ex.timed ? "s" : ""}` : `${ex.repMin}–${ex.repMax}`;

  const setPending = (patch) => mutateDraft((d) => patchExercise(d, idx, { pending: { ...d.exercises[idx].pending, ...patch } }));

  const logSet = () => {
    mutateDraft((d) => {
      const cur = d.exercises[idx];
      const p = cur.pending;
      const set = {};
      if (mode === "gym") set.weight = Number(p.weight) || 0;
      if (cur.unilateral) { set.repsL = Number(p.repsL) || 0; set.repsR = Number(p.repsR) || 0; }
      else set.reps = Number(p.reps) || 0;
      return patchExercise(d, idx, { sets: [...cur.sets, set] });
    }, "now"); // checkpoint the draft on every logged set
  };

  const removeSet = (si) => {
    mutateDraft((d) => {
      const cur = d.exercises[idx];
      return patchExercise(d, idx, { sets: cur.sets.filter((_, j) => j !== si) });
    }, "now");
  };

  const move = (dir) => {
    mutateDraft((d) => {
      const j = idx + dir;
      if (j < 0 || j >= d.exercises.length) return d;
      const exercises = [...d.exercises];
      const [item] = exercises.splice(idx, 1);
      exercises.splice(j, 0, item);
      return { ...d, exercises };
    }, "now");
    setMenuOpen(false);
  };

  const toggleSkip = () => {
    mutateDraft((d) => patchExercise(d, idx, { skipped: !d.exercises[idx].skipped }), "now");
    setMenuOpen(false);
  };

  const acceptSuggestion = () => {
    mutateDraft((d) => {
      const cur = d.exercises[idx];
      const s = cur.suggestion;
      if (!s || s.kind !== "bump") return d;
      const accepted = cur.acceptedTarget == null;
      return patchExercise(d, idx, {
        acceptedTarget: accepted ? s.target : null,
        pending: { ...cur.pending, weight: accepted ? s.target : cur.current },
      });
    });
  };

  if (ex.skipped) {
    return (
      <div className="flex items-center justify-between rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3">
        <div className="text-sm text-zinc-600 line-through">{ex.name}</div>
        <button onClick={toggleSkip} className="flex h-11 items-center gap-1 rounded-lg px-3 text-xs font-semibold text-zinc-400 active:text-zinc-200">
          <RotateCcw size={14} /> Undo skip
        </button>
      </div>
    );
  }

  const sug = ex.suggestion;
  const chipBase = "inline-flex h-8 items-center gap-1 rounded-full px-3 text-xs font-bold";

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold leading-tight text-zinc-100">{ex.name}</h2>
          <div className="mt-1 text-xs text-zinc-500">
            {ex.targetSets} × {repTarget}
            {ex.unilateral ? " per side" : ""}
            {mode === "gym" && ex.increment ? ` · +${fmtW(ex.increment)}` : ""}
            {mode === "gym" && ex.loadType ? ` · ${LOAD_LABEL[ex.loadType] || ex.loadType}` : ""}
            {ex.needsBar ? " · needs bar" : ""}
          </div>
        </div>
        <button aria-label="exercise menu" onClick={() => setMenuOpen(!menuOpen)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-zinc-500 active:bg-zinc-800">
          <MoreVertical size={20} />
        </button>
      </div>

      {menuOpen && (
        <div className="mt-2 flex gap-2">
          <button onClick={() => move(-1)} disabled={idx === 0} className={`flex h-11 flex-1 items-center justify-center gap-1 rounded-xl bg-zinc-800 text-xs font-semibold text-zinc-300 active:bg-zinc-700 ${idx === 0 ? "opacity-40" : ""}`}>
            <ArrowUp size={14} /> Up
          </button>
          <button onClick={() => move(1)} disabled={idx === count - 1} className={`flex h-11 flex-1 items-center justify-center gap-1 rounded-xl bg-zinc-800 text-xs font-semibold text-zinc-300 active:bg-zinc-700 ${idx === count - 1 ? "opacity-40" : ""}`}>
            <ArrowDown size={14} /> Down
          </button>
          <button onClick={toggleSkip} className="flex h-11 flex-1 items-center justify-center gap-1 rounded-xl bg-zinc-800 text-xs font-semibold text-zinc-300 active:bg-zinc-700">
            <Ban size={14} /> Skip
          </button>
          <button onClick={() => { setNoteOpen(!noteOpen); setMenuOpen(false); }} className="flex h-11 flex-1 items-center justify-center gap-1 rounded-xl bg-zinc-800 text-xs font-semibold text-zinc-300 active:bg-zinc-700">
            <Pencil size={14} /> Note
          </button>
        </div>
      )}

      {(ex.exNote || ex.fallback) && (
        <div className="mt-2 text-xs text-zinc-500">
          {ex.exNote}{ex.exNote && ex.fallback ? " · " : ""}{ex.fallback}
        </div>
      )}

      {/* last time + suggestion */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {ex.lastPerf ? (
          <div className="text-sm text-zinc-400">
            Last ({shortDate(ex.lastPerf.date)}): <span className="font-semibold tabular-nums text-zinc-200">{fmtPerfLine(ex.lastPerf, ex)}</span>
          </div>
        ) : (
          <div className="text-sm text-zinc-500">First time — no history yet</div>
        )}
        {mode === "gym" && sug && (
          sug.kind === "bump" ? (
            <button
              onClick={acceptSuggestion}
              className={`${chipBase} ${TRANS} ${ex.acceptedTarget != null ? "border border-lime-400 bg-zinc-900 text-lime-300" : "bg-lime-400 text-black active:bg-lime-300"}`}
            >
              {ex.acceptedTarget != null ? <><Check size={14} /> Going to {fmtW(sug.target)}</> : <><ChevronUp size={14} /> {sug.label}</>}
            </button>
          ) : (
            <span className={`${chipBase} border ${sug.kind === "build" ? "border-amber-400/60 text-amber-300" : "border-zinc-700 text-zinc-400"}`}>
              {sug.label}
            </span>
          )
        )}
      </div>
      {ex.lastPerf && ex.lastPerf.note ? (
        <div className="mt-1 text-xs text-zinc-500">Last note: “{ex.lastPerf.note}”</div>
      ) : null}

      {/* logged sets */}
      {ex.sets.length > 0 && (
        <div className="mt-3 flex flex-col divide-y divide-zinc-800 rounded-xl bg-zinc-950">
          {ex.sets.map((s, si) => (
            <div key={si} className="flex items-center gap-3 px-3 py-1">
              <div className="w-5 text-xs font-bold text-zinc-600">{si + 1}</div>
              <div className="flex-1 text-base font-semibold tabular-nums text-zinc-100">
                {mode === "gym" ? <>{fmtW(s.weight)} <span className="text-xs font-normal text-zinc-500">×</span> </> : null}
                {fmtSetShort(s, ex)}
                {ex.timed ? null : <span className="ml-1 text-xs font-normal text-zinc-500">reps</span>}
              </div>
              <button aria-label={`delete set ${si + 1}`} onClick={() => removeSet(si)} className="flex h-11 w-11 items-center justify-center text-zinc-600 active:text-red-400">
                <X size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* pending set inputs */}
      <div className="mt-3 flex flex-col gap-2">
        {mode === "gym" && (
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Weight{ex.loadType ? ` · ${LOAD_LABEL[ex.loadType] || ex.loadType}` : ""}
            </div>
            <Stepper value={ex.pending.weight} onChange={(v) => setPending({ weight: v })} step={ex.increment || 5} min={0} />
          </div>
        )}
        {ex.unilateral ? (
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col items-center gap-1 rounded-xl bg-zinc-950 p-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Left</div>
              <Stepper small value={ex.pending.repsL} onChange={(v) => setPending({ repsL: v })} step={1} min={0} />
            </div>
            <div className="flex flex-col items-center gap-1 rounded-xl bg-zinc-950 p-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Right</div>
              <Stepper small value={ex.pending.repsR} onChange={(v) => setPending({ repsR: v })} step={1} min={0} />
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              {ex.timed ? "Seconds" : ex.amrap ? "Reps · AMRAP" : "Reps"}
            </div>
            <Stepper value={ex.pending.reps} onChange={(v) => setPending({ reps: v })} step={ex.timed ? 5 : 1} min={0} />
          </div>
        )}
        <button
          onClick={logSet}
          className={`h-12 rounded-xl border border-lime-400/50 bg-zinc-950 text-sm font-bold text-lime-300 active:bg-zinc-800 ${TRANS}`}
        >
          Log set {ex.sets.length + 1} of {ex.targetSets}
        </button>
      </div>

      {noteOpen && (
        <textarea
          rows={2}
          placeholder="Notes for this exercise…"
          value={ex.note}
          onChange={(e) => mutateDraft((d) => patchExercise(d, idx, { note: e.target.value }))}
          className="mt-3 w-full rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-base text-zinc-200 outline-none"
        />
      )}
    </section>
  );
}

/* ---------- history ---------- */

function HistoryScreen({ index, onOpen }) {
  return (
    <div className="flex flex-col gap-4">
      <header className="pt-2">
        <h1 className="text-2xl font-bold">History</h1>
        <div className="text-xs text-zinc-500">{index.length} workout{index.length === 1 ? "" : "s"} logged</div>
      </header>
      {index.length === 0 ? (
        <EmptyState
          icon={<HistoryIcon size={32} />}
          title="No workouts yet"
          hint="Finish your first workout from the Workout tab and it'll show up here."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {index.map((e) => (
            <button
              key={e.id}
              onClick={() => onOpen(e.id)}
              className={`flex items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-4 text-left active:border-zinc-600 ${TRANS}`}
            >
              <div className="w-14 shrink-0">
                <div className="text-sm font-bold text-zinc-100">{shortDate(e.date)}</div>
                <div className="text-xs text-zinc-600">{new Date(e.date).toLocaleDateString("en-US", { weekday: "short" })}</div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold uppercase tracking-wide text-zinc-200">{DAY_LABEL[e.dayType] || e.dayType}</span>
                  {e.mode === "calisthenics" && <span className="rounded bg-zinc-800 px-1 py-1 text-xs font-semibold text-zinc-400">BW</span>}
                  {e.ql === "same-or-better" && <span title="QL same or better" className="h-2 w-2 rounded-full bg-green-500" />}
                  {e.ql === "worse" && <span title="QL worse" className="h-2 w-2 rounded-full bg-red-500" />}
                </div>
                <div className="truncate text-xs text-zinc-500">{e.headline || "—"} · {e.setCount} sets</div>
              </div>
              <ChevronDown size={16} className="-rotate-90 shrink-0 text-zinc-600" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- session viewer / editor (full-screen overlay) ---------- */

function findConfigEx(config, exerciseId) {
  for (const day of DAY_KEYS) {
    const g = (config.days[day] || []).find((e) => e.id === exerciseId);
    if (g) return g;
    const c = (config.calisthenics[day] || []).find((e) => e.id === exerciseId);
    if (c) return c;
  }
  return null;
}

function SessionViewer({ id, config, loadSession, onClose, onSave, onDelete, pushToast }) {
  const [session, setSession] = useState(null);
  const [missing, setMissing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [edit, setEdit] = useState(null);
  const [saving, setSaving] = useState(false);
  const [armedDelete, setArmedDelete] = useArmed();

  useEffect(() => {
    let alive = true;
    (async () => {
      const s = await loadSession(id);
      if (!alive) return;
      if (s) setSession(s); else setMissing(true);
    })();
    return () => { alive = false; };
  }, [id, loadSession]);

  const startEdit = () => {
    setEdit(JSON.parse(JSON.stringify(session)));
    setEditing(true);
  };
  const doSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const cleaned = { ...edit, exercises: edit.exercises.filter((e) => e.sets.length > 0) };
      const ok = await onSave(cleaned);
      if (ok) { setSession(cleaned); setEditing(false); }
    } finally {
      setSaving(false);
    }
  };

  const patchEditSet = (ei, si, patch) => {
    setEdit((prev) => {
      const exercises = prev.exercises.map((e, i) =>
        i === ei ? { ...e, sets: e.sets.map((s, j) => (j === si ? { ...s, ...patch } : s)) } : e
      );
      return { ...prev, exercises };
    });
  };
  const removeEditSet = (ei, si) => {
    setEdit((prev) => {
      const exercises = prev.exercises.map((e, i) => (i === ei ? { ...e, sets: e.sets.filter((_, j) => j !== si) } : e));
      return { ...prev, exercises };
    });
  };
  const addEditSet = (ei) => {
    setEdit((prev) => {
      const exercises = prev.exercises.map((e, i) => {
        if (i !== ei) return e;
        const lastSet = e.sets[e.sets.length - 1] || (e.unilateral ? { weight: 0, repsL: 0, repsR: 0 } : { weight: 0, reps: 0 });
        return { ...e, sets: [...e.sets, { ...lastSet }] };
      });
      return { ...prev, exercises };
    });
  };

  const s = editing ? edit : session;

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-black" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <div className="mx-auto max-w-md px-4 pb-32 pt-4">
        <header className="sticky top-0 z-10 -mx-4 border-b border-zinc-800 bg-black/90 px-4 py-3 backdrop-blur">
          <div className="flex items-center justify-between gap-2">
            <button onClick={onClose} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-zinc-400 active:bg-zinc-800" aria-label="back">
              <ChevronLeft size={22} />
            </button>
            <div className="min-w-0 flex-1">
              {s && (
                <>
                  <div className="truncate text-base font-bold">
                    {DAY_LABEL[s.dayType] || s.dayType}
                    {s.mode === "calisthenics" && <span className="ml-2 rounded bg-zinc-800 px-2 py-1 text-xs font-semibold text-zinc-300">BW</span>}
                  </div>
                  <div className="text-xs text-zinc-500">{fullDate(s.date)}</div>
                </>
              )}
            </div>
            {s && !editing && (
              <button onClick={startEdit} className="flex h-11 items-center gap-1 rounded-xl bg-zinc-800 px-3 text-sm font-semibold text-zinc-200 active:bg-zinc-700">
                <Pencil size={14} /> Edit
              </button>
            )}
            {editing && (
              <div className="flex gap-2">
                <button onClick={() => setEditing(false)} className="h-11 rounded-xl px-3 text-sm font-semibold text-zinc-400 active:text-zinc-200">Cancel</button>
                <button onClick={doSave} disabled={saving} className={`h-11 rounded-xl bg-lime-400 px-4 text-sm font-bold text-black active:bg-lime-300 ${saving ? "opacity-60" : ""}`}>
                  Save
                </button>
              </div>
            )}
          </div>
        </header>

        {missing && (
          <div className="pt-6">
            <EmptyState icon={<AlertTriangle size={32} />} title="Session not found" hint="This workout's data couldn't be loaded from storage." />
          </div>
        )}
        {!s && !missing && <Spinner label="Loading session…" />}

        {s && (
          <div className="flex flex-col gap-3 pt-4">
            {s.qlCheck !== undefined && s.qlCheck !== null && (
              <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${s.qlCheck === "worse" ? "border-red-900 text-red-300" : "border-zinc-800 text-green-400"}`}>
                <span className={`h-2 w-2 rounded-full ${s.qlCheck === "worse" ? "bg-red-500" : "bg-green-500"}`} />
                Next-day QL check: {s.qlCheck === "worse" ? "worse" : "same or better"}
              </div>
            )}
            {s.exercises.map((ex, ei) => {
              const cfg = findConfigEx(config, ex.exerciseId);
              const inc = (cfg && cfg.increment) || 5;
              return (
                <section key={ex.exerciseId + ei} className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
                  <h2 className="font-semibold text-zinc-100">{ex.name}</h2>
                  {!editing ? (
                    <>
                      <div className="mt-2 flex flex-col divide-y divide-zinc-800 rounded-xl bg-zinc-950">
                        {ex.sets.map((set, si) => (
                          <div key={si} className="flex items-center gap-3 px-3 py-2">
                            <div className="w-5 text-xs font-bold text-zinc-600">{si + 1}</div>
                            <div className="flex-1 text-base font-semibold tabular-nums text-zinc-100">
                              {set.weight != null ? <>{fmtW(set.weight)} <span className="text-xs font-normal text-zinc-500">×</span> </> : null}
                              {fmtSetShort(set, ex)}
                            </div>
                          </div>
                        ))}
                      </div>
                      {ex.note ? <div className="mt-2 text-sm text-zinc-400">“{ex.note}”</div> : null}
                    </>
                  ) : (
                    <div className="mt-2 flex flex-col gap-3">
                      {ex.sets.map((set, si) => (
                        <div key={si} className="rounded-xl bg-zinc-950 p-3">
                          <div className="flex items-center justify-between">
                            <div className="text-xs font-bold text-zinc-600">SET {si + 1}</div>
                            <button aria-label="delete set" onClick={() => removeEditSet(ei, si)} className="flex h-11 w-11 items-center justify-center text-zinc-600 active:text-red-400">
                              <Trash2 size={16} />
                            </button>
                          </div>
                          {set.weight != null && (
                            <div className="mt-1 flex items-center justify-between">
                              <span className="text-xs uppercase text-zinc-500">Weight</span>
                              <Stepper small value={set.weight} onChange={(v) => patchEditSet(ei, si, { weight: v })} step={inc} min={0} />
                            </div>
                          )}
                          {ex.unilateral ? (
                            <>
                              <div className="mt-1 flex items-center justify-between">
                                <span className="text-xs uppercase text-zinc-500">Left</span>
                                <Stepper small value={set.repsL} onChange={(v) => patchEditSet(ei, si, { repsL: v })} step={1} min={0} />
                              </div>
                              <div className="mt-1 flex items-center justify-between">
                                <span className="text-xs uppercase text-zinc-500">Right</span>
                                <Stepper small value={set.repsR} onChange={(v) => patchEditSet(ei, si, { repsR: v })} step={1} min={0} />
                              </div>
                            </>
                          ) : (
                            <div className="mt-1 flex items-center justify-between">
                              <span className="text-xs uppercase text-zinc-500">{ex.timed ? "Seconds" : "Reps"}</span>
                              <Stepper small value={set.reps} onChange={(v) => patchEditSet(ei, si, { reps: v })} step={ex.timed ? 5 : 1} min={0} />
                            </div>
                          )}
                        </div>
                      ))}
                      <button onClick={() => addEditSet(ei)} className="flex h-11 items-center justify-center gap-1 rounded-xl border border-zinc-700 text-sm font-semibold text-zinc-300 active:bg-zinc-800">
                        <Plus size={16} /> Add set
                      </button>
                      <textarea
                        rows={2}
                        placeholder="Notes…"
                        value={ex.note || ""}
                        onChange={(e) =>
                          setEdit((prev) => ({
                            ...prev,
                            exercises: prev.exercises.map((x, i) => (i === ei ? { ...x, note: e.target.value } : x)),
                          }))
                        }
                        className="w-full rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-base text-zinc-200 outline-none"
                      />
                    </div>
                  )}
                </section>
              );
            })}

            {!editing && <HealthLogButton session={s} pushToast={pushToast} />}

            {!editing && (
              <button
                onClick={() => { if (armedDelete) onDelete(s.id); else setArmedDelete(true); }}
                className={`mt-2 flex h-12 items-center justify-center gap-2 rounded-2xl border text-sm font-semibold ${TRANS} ${
                  armedDelete ? "border-red-500 text-red-400" : "border-zinc-800 text-zinc-500"
                }`}
              >
                <Trash2 size={16} /> {armedDelete ? "Tap again to delete this session" : "Delete session"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- progress ---------- */

function ProgressScreen({ config, index, loadSession, onOpen }) {
  const gymEntries = index.filter((e) => e.mode === "gym");
  const firstWithData = () => {
    for (const day of DAY_KEYS) {
      for (const ex of config.days[day] || []) {
        if (gymEntries.some((e) => e.dayType === day)) return ex.id;
      }
    }
    return (config.days.push && config.days.push[0] && config.days.push[0].id) || "";
  };
  const [exId, setExId] = useState(firstWithData);
  const [points, setPoints] = useState(null); // null = loading
  const exCfg = findConfigEx(config, exId);

  useEffect(() => {
    let alive = true;
    (async () => {
      setPoints(null);
      const entries = [...gymEntries].sort(byDateAsc).slice(-60);
      const pts = [];
      for (const e of entries) {
        const s = await loadSession(e.id);
        if (!s) continue;
        const ex = (s.exercises || []).find((x) => x.exerciseId === exId && x.sets && x.sets.length > 0);
        if (!ex) continue;
        const weight = Math.max(...ex.sets.map((st) => Number(st.weight) || 0));
        const volume = Math.max(...ex.sets.map((st) => setVolume(st, ex.unilateral)));
        pts.push({ id: s.id, label: shortDate(s.date), weight, volume });
      }
      if (alive) setPoints(pts);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exId, index.length]);

  const openFromChart = (state) => {
    if (state && state.activePayload && state.activePayload[0]) {
      const p = state.activePayload[0].payload;
      if (p && p.id) onOpen(p.id);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <header className="pt-2">
        <h1 className="text-2xl font-bold">Progress</h1>
        <div className="text-xs text-zinc-500">Gym sessions only — bodyweight work doesn't move these lines</div>
      </header>

      <select
        value={exId}
        onChange={(e) => setExId(e.target.value)}
        className="h-12 w-full appearance-none rounded-xl border border-zinc-800 bg-zinc-900 px-4 text-base font-semibold text-zinc-100 outline-none"
      >
        {DAY_KEYS.map((day) => (
          <optgroup key={day} label={DAY_LABEL[day]}>
            {(config.days[day] || []).map((ex) => (
              <option key={ex.id} value={ex.id}>{ex.name}</option>
            ))}
          </optgroup>
        ))}
      </select>

      {gymEntries.length === 0 ? (
        <EmptyState
          icon={<TrendingUp size={32} />}
          title="No gym sessions yet"
          hint="Finish a gym workout and your working weight will start charting here."
        />
      ) : points === null ? (
        <Spinner label="Crunching sessions…" />
      ) : points.length < 2 ? (
        <EmptyState
          icon={<TrendingUp size={32} />}
          title={points.length === 0 ? "No data for this exercise" : "One session logged"}
          hint={points.length === 0 ? "Log this exercise in a workout to start its chart." : "Log it once more and the trend line appears."}
        />
      ) : (
        <div className="flex flex-col gap-3">
          <ChartCard
            title={`Working weight (${(exCfg && exCfg.unit) || "lb"})`}
            sub={exCfg && exCfg.loadType ? LOAD_LABEL[exCfg.loadType] : null}
            data={points}
            dataKey="weight"
            color={CHART.line}
            height={224}
            onClick={openFromChart}
          />
          <ChartCard
            title="Best-set volume (weight × reps)"
            sub={exCfg && exCfg.unilateral ? "weaker side" : null}
            data={points}
            dataKey="volume"
            color={CHART.vol}
            height={128}
            onClick={openFromChart}
          />
          <div className="text-center text-xs text-zinc-600">Tap a point to open that session</div>
        </div>
      )}
    </div>
  );
}

function ChartTip({ active, payload, label, unit }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs shadow-lg">
      <div className="font-semibold text-zinc-200">{label}</div>
      <div className="tabular-nums text-zinc-400">{fmtW(payload[0].value)}{unit ? ` ${unit}` : ""}</div>
    </div>
  );
}

function ChartCard({ title, sub, data, dataKey, color, height, onClick }) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-3">
      <div className="flex items-baseline gap-2 px-1 pb-2">
        <div className="text-sm font-semibold text-zinc-200">{title}</div>
        {sub ? <div className="text-xs text-zinc-500">{sub}</div> : null}
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }} onClick={onClick}>
          <CartesianGrid vertical={false} stroke={CHART.grid} />
          <XAxis
            dataKey="label"
            tick={{ fill: CHART.tick, fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: CHART.grid }}
            minTickGap={28}
            padding={{ left: 8, right: 8 }}
          />
          <YAxis
            width={40}
            domain={["auto", "auto"]}
            tick={{ fill: CHART.tick, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickCount={5}
          />
          <Tooltip content={<ChartTip />} cursor={{ stroke: CHART.cursor, strokeWidth: 1 }} />
          <Line
            type="monotone"
            dataKey={dataKey}
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            dot={{ r: 4, fill: color, stroke: CHART.surface, strokeWidth: 2 }}
            activeDot={{ r: 9, fill: color, stroke: CHART.surface, strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ---------- settings ---------- */

function SettingsScreen({ config, saveConfig }) {
  const [mode, setMode] = useState("gym");
  const [day, setDay] = useState("push");
  const [editingId, setEditingId] = useState(null);
  const [armedReset, setArmedReset] = useArmed();

  const list = mode === "gym" ? config.days[day] || [] : config.calisthenics[day] || [];

  const writeList = (nextList) => {
    const next =
      mode === "gym"
        ? { ...config, days: { ...config.days, [day]: nextList } }
        : { ...config, calisthenics: { ...config.calisthenics, [day]: nextList } };
    saveConfig(next);
  };

  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    const [item] = next.splice(i, 1);
    next.splice(j, 0, item);
    writeList(next);
  };

  const addExercise = () => {
    const id = `custom-${uid()}`;
    const ex =
      mode === "gym"
        ? { id, name: "New Exercise", sets: 3, repMin: 8, repMax: 12, increment: 5, unit: "lb", loadType: "machine", current: 50 }
        : { id, name: "New Movement", sets: 3, repMin: 8, repMax: 12 };
    writeList([...list, ex]);
    setEditingId(id);
  };

  return (
    <div className="flex flex-col gap-4">
      <header className="pt-2">
        <h1 className="text-2xl font-bold">Settings</h1>
        <div className="text-xs text-zinc-500">Edit your exercises — add Phase 2 movements here anytime</div>
      </header>

      <Seg value={mode} onChange={(v) => { setMode(v); setEditingId(null); }} options={[{ value: "gym", label: "Gym" }, { value: "calisthenics", label: "Bodyweight" }]} />
      <Seg value={day} onChange={(v) => { setDay(v); setEditingId(null); }} options={DAY_KEYS.map((d) => ({ value: d, label: DAY_LABEL[d] }))} />

      <div className="flex flex-col gap-2">
        {list.map((ex, i) =>
          editingId === ex.id ? (
            <ExerciseEditor
              key={ex.id}
              ex={ex}
              mode={mode}
              onSave={(patched) => { writeList(list.map((x) => (x.id === ex.id ? patched : x))); setEditingId(null); }}
              onDelete={() => { writeList(list.filter((x) => x.id !== ex.id)); setEditingId(null); }}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <div key={ex.id} className="flex items-center gap-1 rounded-2xl border border-zinc-800 bg-zinc-900 p-3">
              <div className="min-w-0 flex-1 pl-1">
                <div className="truncate text-sm font-semibold text-zinc-100">{ex.name}</div>
                <div className="text-xs tabular-nums text-zinc-500">
                  {ex.sets}×{ex.amrap ? "AMRAP" : ex.repMin === ex.repMax ? ex.repMax : `${ex.repMin}–${ex.repMax}`}
                  {ex.timed ? "s" : ""}
                  {ex.unilateral ? " /side" : ""}
                  {mode === "gym" ? ` · ${fmtW(ex.current)} ${LOAD_LABEL[ex.loadType] || ""} · +${fmtW(ex.increment)}` : ""}
                  {ex.needsBar ? " · bar" : ""}
                </div>
              </div>
              <button aria-label="move up" onClick={() => move(i, -1)} disabled={i === 0} className={`flex h-11 w-9 items-center justify-center rounded-lg text-zinc-500 active:bg-zinc-800 ${i === 0 ? "opacity-30" : ""}`}>
                <ArrowUp size={16} />
              </button>
              <button aria-label="move down" onClick={() => move(i, 1)} disabled={i === list.length - 1} className={`flex h-11 w-9 items-center justify-center rounded-lg text-zinc-500 active:bg-zinc-800 ${i === list.length - 1 ? "opacity-30" : ""}`}>
                <ArrowDown size={16} />
              </button>
              <button aria-label="edit" onClick={() => setEditingId(ex.id)} className="flex h-11 w-11 items-center justify-center rounded-lg text-zinc-300 active:bg-zinc-800">
                <Pencil size={16} />
              </button>
            </div>
          )
        )}
      </div>

      <button onClick={addExercise} className={`flex h-12 items-center justify-center gap-2 rounded-2xl border border-lime-400/50 text-sm font-bold text-lime-300 active:bg-zinc-900 ${TRANS}`}>
        <Plus size={18} /> Add exercise to {DAY_LABEL[day]}{mode === "calisthenics" ? " (bodyweight)" : ""}
      </button>

      <div className="mt-2 flex flex-col gap-2 rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
          <Heart size={16} className="text-lime-400" /> Apple Health (one-time setup)
        </div>
        <ol className="flex list-decimal flex-col gap-1 pl-4 text-xs text-zinc-500">
          <li>In the Shortcuts app, create a shortcut named <span className="font-semibold text-zinc-300">Log Lift</span>.</li>
          <li>Add <span className="font-semibold text-zinc-300">Get Clipboard</span>, then <span className="font-semibold text-zinc-300">Get Dictionary from Input</span>.</li>
          <li>Add <span className="font-semibold text-zinc-300">Log Workout</span> — type <span className="font-semibold text-zinc-300">Traditional Strength Training</span>, Start = dictionary value <span className="font-semibold text-zinc-300">startLocal</span>, End = <span className="font-semibold text-zinc-300">endLocal</span>.</li>
          <li>After a workout, tap <span className="font-semibold text-zinc-300">Copy for Apple Health</span>, then run Log Lift.</li>
        </ol>
        <div className="text-xs text-zinc-600">
          Artifacts can't talk to HealthKit directly, so the shortcut is the bridge. Logged workouts count toward your Exercise ring. Sets and reps stay here — Health only stores the session.
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2 border-t border-zinc-800 pt-4">
        <button
          onClick={() => { if (armedReset) { saveConfig(SEED_CONFIG); setArmedReset(false); } else setArmedReset(true); }}
          className={`flex h-12 items-center justify-center gap-2 rounded-2xl border text-sm font-semibold ${TRANS} ${
            armedReset ? "border-red-500 text-red-400" : "border-zinc-800 text-zinc-500"
          }`}
        >
          <RotateCcw size={16} /> {armedReset ? "Tap again — replaces ALL exercises with seed" : "Restore seed exercises"}
        </button>
        <div className="text-center text-xs text-zinc-600">
          {store.isNative() ? "Data persists on this device via app storage" : "Preview mode — storage is in-memory only"}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</div>
      {children}
    </div>
  );
}

function ToggleBtn({ value, onChange }) {
  return (
    <button
      role="switch"
      aria-checked={!!value}
      onClick={() => onChange(!value)}
      className={`h-8 w-14 rounded-full p-1 ${TRANS} ${value ? "bg-lime-400" : "bg-zinc-700"}`}
    >
      <span className={`block h-6 w-6 rounded-full bg-black ${TRANS} ${value ? "ml-6" : "ml-0"}`} />
    </button>
  );
}

function ExerciseEditor({ ex, mode, onSave, onDelete, onCancel }) {
  const [form, setForm] = useState({ ...ex });
  const [armedDelete, setArmedDelete] = useArmed();
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const gym = mode === "gym";

  const commit = () => {
    const cleaned = { ...form, name: (form.name || "").trim() || ex.name };
    if (cleaned.repMin > cleaned.repMax) cleaned.repMax = cleaned.repMin;
    onSave(cleaned);
  };

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-lime-400/40 bg-zinc-900 p-4">
      <input
        value={form.name}
        onChange={(e) => set({ name: e.target.value })}
        placeholder="Exercise name"
        className="h-12 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 text-base font-semibold text-zinc-100 outline-none"
      />
      <Field label="Sets"><Stepper small value={form.sets} onChange={(v) => set({ sets: Math.max(1, Math.round(v)) })} step={1} min={1} max={10} /></Field>
      {!form.amrap && (
        <>
          <Field label={form.timed ? "Min seconds" : "Rep min"}><Stepper small value={form.repMin} onChange={(v) => set({ repMin: Math.max(1, Math.round(v)) })} step={form.timed ? 5 : 1} min={1} /></Field>
          <Field label={form.timed ? "Max seconds" : "Rep max"}><Stepper small value={form.repMax} onChange={(v) => set({ repMax: Math.max(1, Math.round(v)) })} step={form.timed ? 5 : 1} min={1} /></Field>
        </>
      )}
      {gym && (
        <>
          <Field label="Current weight"><Stepper small value={form.current} onChange={(v) => set({ current: v })} step={form.increment || 5} min={0} /></Field>
          <Field label="Increment"><Stepper small value={form.increment} onChange={(v) => set({ increment: v })} step={2.5} min={0.5} /></Field>
          <Field label="Load type">
            <select
              value={form.loadType || "machine"}
              onChange={(e) => set({ loadType: e.target.value })}
              className="h-11 appearance-none rounded-xl border border-zinc-700 bg-zinc-950 px-3 text-base text-zinc-100 outline-none"
            >
              {LOAD_TYPES.map((lt) => <option key={lt} value={lt}>{lt}</option>)}
            </select>
          </Field>
        </>
      )}
      <Field label="Unilateral (L/R)"><ToggleBtn value={!!form.unilateral} onChange={(v) => set({ unilateral: v })} /></Field>
      {!gym && (
        <>
          <Field label="AMRAP"><ToggleBtn value={!!form.amrap} onChange={(v) => set({ amrap: v })} /></Field>
          <Field label="Timed (seconds)"><ToggleBtn value={!!form.timed} onChange={(v) => set({ timed: v })} /></Field>
          <Field label="Needs pull-up bar"><ToggleBtn value={!!form.needsBar} onChange={(v) => set({ needsBar: v })} /></Field>
        </>
      )}
      <input
        value={form.note || ""}
        onChange={(e) => set({ note: e.target.value })}
        placeholder="Note shown during logging (optional)"
        className="h-12 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 text-base text-zinc-300 outline-none"
      />
      <div className="flex gap-2">
        <button onClick={onCancel} className="h-12 flex-1 rounded-xl border border-zinc-700 text-sm font-semibold text-zinc-400 active:text-zinc-200">Cancel</button>
        <button onClick={commit} className="h-12 flex-1 rounded-xl bg-lime-400 text-sm font-bold text-black active:bg-lime-300">Save</button>
      </div>
      <button
        onClick={() => { if (armedDelete) onDelete(); else setArmedDelete(true); }}
        className={`flex h-11 items-center justify-center gap-2 rounded-xl text-xs font-semibold ${TRANS} ${armedDelete ? "text-red-400" : "text-zinc-600"}`}
      >
        <Trash2 size={14} /> {armedDelete ? "Tap again to remove this exercise" : "Remove exercise"}
      </button>
    </div>
  );
}
