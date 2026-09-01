/* Plain-Node test runner for the tracker's pure helpers — no framework.
   The whole app is one .jsx file, so esbuild (already a devDependency)
   bundles it into a scratch ESM file whose exports we import. React,
   recharts and lucide-react are aliased to a Proxy stub: the pure helpers
   never touch them, and module evaluation must not need a DOM.
   Run from workout-pwa/:  npm test  */
import { build } from "esbuild";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { mkdirSync, writeFileSync } from "fs";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const scratch = join(here, ".scratch");
mkdirSync(scratch, { recursive: true });

const stubPath = join(scratch, "ui-stub.cjs");
writeFileSync(
  stubPath,
  "module.exports = new Proxy({}, { get: (t, p) => (p === \"__esModule\" ? true : function Stub() { return null; }) });\n"
);

const outfile = join(scratch, "tracker.bundle.mjs");
await build({
  entryPoints: [join(here, "..", "..", "ppl-workout-tracker.jsx")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile,
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"test"' },
  alias: {
    react: stubPath,
    "react-dom": stubPath,
    "react/jsx-runtime": stubPath,
    recharts: stubPath,
    "lucide-react": stubPath,
  },
  logLevel: "silent",
});
const T = await import(outfile);

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`  FAIL ${name}`);
    console.error(`       ${(e && e.message) || e}`);
  }
}
function section(name) {
  console.log(`\n${name}`);
}

// Local-time date helpers (the app's week/clock math is local, so tests build
// dates through the Date constructor, never ISO strings with a Z).
const iso = (y, m, d, h = 12) => new Date(y, m - 1, d, h).toISOString();
const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h);
const lift = (dayType, dateIso, extra = {}) => ({
  id: dateIso + (extra.mode || "gym") + dayType,
  date: dateIso,
  dayType,
  mode: "gym",
  headline: "",
  setCount: 15,
  ...extra,
});
const run = (dateIso, extra = {}) => ({ id: "r" + dateIso, date: dateIso, dayType: "run", mode: "run", headline: "", setCount: 0, ...extra });

/* ================= Task 1: calDaysBetween + pickNextDay ================= */

section("calDaysBetween");
test("calendar-day boundary, not 24h blocks", () => {
  assert.equal(T.calDaysBetween(at(2026, 8, 30, 23, 30).toISOString(), at(2026, 8, 31, 7)), 1);
});
test("same day is 0 regardless of hours", () => {
  assert.equal(T.calDaysBetween(at(2026, 8, 31, 1).toISOString(), at(2026, 8, 31, 23)), 0);
});
test("garbage dates read as Infinity", () => {
  assert.equal(T.calDaysBetween("not-a-date", at(2026, 8, 31)), Infinity);
});

section("pickNextDay");
{
  // The prompt's sanity trace: Push 22 Aug + Run 22 Aug + Pull 25 Aug (+ Legs 20 Aug).
  const base = [
    lift("pull", iso(2026, 8, 25)),
    run(iso(2026, 8, 22, 18)),
    lift("push", iso(2026, 8, 22)),
    lift("legs", iso(2026, 8, 20)),
  ];
  const rules = { staleDays: 8 };

  test("trace 31 Aug: legs, 11d stale (push 9, pull 6)", () => {
    const p = T.pickNextDay(base, at(2026, 8, 31, 9), rules);
    assert.equal(p.day, "legs");
    assert.equal(p.reason, "stale");
    assert.deepEqual(p.age, { push: 9, pull: 6, legs: 11 });
  });
  test("trace day after legs: push (10d, only push stale)", () => {
    const p = T.pickNextDay([lift("legs", iso(2026, 8, 31)), ...base], at(2026, 9, 1, 9), rules);
    assert.equal(p.day, "push");
    assert.equal(p.reason, "stale");
    assert.equal(p.age.push, 10);
  });
  test("trace day after push: pull (8d) — push at 1, so no upper", () => {
    const p = T.pickNextDay(
      [lift("push", iso(2026, 9, 1)), lift("legs", iso(2026, 8, 31)), ...base],
      at(2026, 9, 2, 9),
      rules
    );
    assert.equal(p.day, "pull");
    assert.equal(p.age.pull, 8);
  });
  test("layoff: oldest clock (legs) first", () => {
    const idx = [lift("push", iso(2026, 8, 15)), lift("pull", iso(2026, 8, 13)), lift("legs", iso(2026, 8, 11))];
    const p = T.pickNextDay(idx, at(2026, 8, 29), rules);
    assert.equal(p.day, "legs");
  });
  test("layoff day 2: upper beats the tied stalest single bucket", () => {
    const idx = [lift("legs", iso(2026, 8, 29)), lift("push", iso(2026, 8, 15)), lift("pull", iso(2026, 8, 13))];
    const p = T.pickNextDay(idx, at(2026, 8, 30), rules);
    assert.equal(p.day, "upper"); // push 15, pull 17 both stale; upper clears 17, outranks pull on the tie
    assert.equal(p.reason, "stale");
  });
  test("after upper both clocks reset; plain rotation resumes", () => {
    const idx = [
      lift("upper", iso(2026, 8, 30)),
      lift("legs", iso(2026, 8, 29)),
      lift("push", iso(2026, 8, 15)),
      lift("pull", iso(2026, 8, 13)),
    ];
    const p = T.pickNextDay(idx, at(2026, 8, 31), rules);
    assert.equal(p.day, "legs");
    assert.equal(p.reason, "rotation");
    assert.deepEqual(p.age, { push: 1, pull: 1, legs: 2 });
  });
  test("runs and events never touch the clocks", () => {
    const idx = [
      { id: "e", date: iso(2026, 8, 30), dayType: "event", mode: "event", ql: null },
      run(iso(2026, 8, 30)),
      lift("push", iso(2026, 8, 28)),
      lift("pull", iso(2026, 8, 27)),
      lift("legs", iso(2026, 8, 26)),
    ];
    const p = T.pickNextDay(idx, at(2026, 8, 31), rules);
    assert.equal(p.day, "legs");
    assert.equal(p.age.legs, 5);
  });
  test("calisthenics sessions reset clocks like gym ones", () => {
    const idx = [
      lift("legs", iso(2026, 8, 30), { mode: "calisthenics" }),
      lift("push", iso(2026, 8, 29)),
      lift("pull", iso(2026, 8, 28)),
    ];
    const p = T.pickNextDay(idx, at(2026, 8, 31), rules);
    assert.equal(p.day, "pull"); // pull 3 > push 2 > legs 1
  });
  test("never-trained bucket is infinitely stale and wins", () => {
    const p = T.pickNextDay([lift("push", iso(2026, 8, 30)), lift("pull", iso(2026, 8, 29))], at(2026, 8, 31), rules);
    assert.equal(p.day, "legs");
    assert.equal(p.reason, "stale");
    assert.equal(p.age.legs, Infinity);
  });
  test("two never-trained buckets: legs outranks push on the Infinity tie", () => {
    const p = T.pickNextDay([lift("pull", iso(2026, 8, 30))], at(2026, 8, 31), rules);
    assert.equal(p.day, "legs");
  });
  test("empty history defaults to push", () => {
    const p = T.pickNextDay([], at(2026, 8, 31), rules);
    assert.equal(p.day, "push");
    assert.equal(p.reason, "rotation");
  });
  test("staleDays honors config override", () => {
    const idx = [lift("push", iso(2026, 8, 26)), lift("pull", iso(2026, 8, 27)), lift("legs", iso(2026, 8, 28))];
    // ages: push 5, pull 4, legs 3 — stale at 5, not at 8.
    assert.equal(T.pickNextDay(idx, at(2026, 8, 31), { staleDays: 8 }).reason, "rotation");
    assert.equal(T.pickNextDay(idx, at(2026, 8, 31), { staleDays: 5 }).reason, "stale");
  });
}

section("nextDayReason");
test("stale single bucket names the count", () => {
  assert.equal(T.nextDayReason({ day: "legs", reason: "stale", age: { legs: 11 } }), "Stale — 11 days since legs");
});
test("upper reason names both buckets", () => {
  assert.equal(
    T.nextDayReason({ day: "upper", reason: "stale", age: { push: 9, pull: 10 } }),
    "Push + pull both stale — Upper covers both"
  );
});
test("rotation reason", () => {
  assert.equal(T.nextDayReason({ day: "pull", reason: "rotation", age: {} }), "Next in rotation");
});

/* ================= Task 2: weekStatus ================= */

section("weekStatus");
{
  // Week of Mon 2026-08-31; prior Mondays: Aug 24, Aug 17, Aug 10.
  const idx = [
    lift("push", iso(2026, 8, 31, 8)), // current week (Mon)
    lift("legs", iso(2026, 8, 28)),
    lift("pull", iso(2026, 8, 26)),
    lift("push", iso(2026, 8, 24)), // w-1: 3 lifts
    lift("legs", iso(2026, 8, 20)),
    lift("push", iso(2026, 8, 17)), // w-2: 2 lifts
    lift("pull", iso(2026, 8, 12)),
    lift("push", iso(2026, 8, 11)),
    lift("legs", iso(2026, 8, 10)), // w-3: 3 lifts
    run(iso(2026, 8, 27)),
    { id: "ev", date: iso(2026, 8, 25), dayType: "event", mode: "event", ql: null },
  ];
  test("last4 buckets oldest→current, lifting sessions only", () => {
    const ws = T.weekStatus(idx, at(2026, 8, 31, 20));
    assert.deepEqual(ws.last4, [3, 2, 3, 1]);
    assert.equal(ws.thisWeek, 1);
  });
  test("Sunday belongs to its week, Monday to the next", () => {
    const ws = T.weekStatus([lift("push", at(2026, 8, 30, 23).toISOString())], at(2026, 8, 31, 1));
    assert.deepEqual(ws.last4, [0, 0, 1, 0]);
  });
  test("pace: Monday at 0 lifts is ok, not red", () => {
    assert.equal(T.weekStatus([], at(2026, 8, 31)).state, "ok");
  });
  test("pace: Thursday at 0 is floor", () => {
    assert.equal(T.weekStatus([], at(2026, 9, 3)).state, "floor");
  });
  test("pace: Saturday at 0 is below (3 unreachable)", () => {
    assert.equal(T.weekStatus([], at(2026, 9, 5)).state, "below");
  });
  test("pace: Sunday with 2 is floor (one more today)", () => {
    const two = [lift("push", iso(2026, 8, 31)), lift("pull", iso(2026, 9, 2))];
    assert.equal(T.weekStatus(two, at(2026, 9, 6)).state, "floor");
  });
  test("3 lifts is ok whenever", () => {
    const three = [lift("push", iso(2026, 8, 31)), lift("pull", iso(2026, 9, 1)), lift("legs", iso(2026, 9, 2))];
    assert.equal(T.weekStatus(three, at(2026, 9, 2, 20)).state, "ok");
  });
  test("weeksUnder3: completed weeks count outright; current only when unreachable", () => {
    assert.equal(T.weekStatus(idx, at(2026, 8, 31, 20)).weeksUnder3, 1); // only w-2; Monday can still reach 3
    assert.equal(T.weekStatus(idx, at(2026, 9, 6, 20)).weeksUnder3, 2); // Sunday, 1 lift + 1 day left = unreachable
  });
  test("weekStartOf lands on local Monday midnight", () => {
    const ws = T.weekStartOf(at(2026, 9, 6, 23)); // Sunday
    assert.equal(ws.getDay(), 1);
    assert.equal(ws.getDate(), 31);
    assert.equal(ws.getHours(), 0);
  });
}

/* ================= Task 3: roundToIncrement + break rules ================= */

section("roundToIncrement");
test("nearest multiple of the increment", () => {
  assert.equal(T.roundToIncrement(346.5, 10), 350);
  assert.equal(T.roundToIncrement(63, 5), 65);
  assert.equal(T.roundToIncrement(59.5, 5), 60);
});
test("steps down one increment when it would land on the current weight", () => {
  assert.equal(T.roundToIncrement(48, 5, 50), 45);
  assert.equal(T.roundToIncrement(9, 2.5, 10), 7.5);
});
test("never below one increment", () => {
  assert.equal(T.roundToIncrement(1, 5), 5);
});

section("computeSuggestion break rules");
{
  const perf = (dateIso, weight, reps) => ({ date: dateIso, sets: reps.map((r) => ({ weight, reps: r })) });
  const now = at(2026, 8, 31);
  const rules = { returnAfterDays: 17, holdAfterDays: 12 };
  const bench = { current: 70, increment: 5, repMin: 8, repMax: 12, warmupRamp: true };
  const stack = { current: 120, increment: 5, repMin: 10, repMax: 12 };

  test("17+ days: return at 85% for the ramped compound", () => {
    const s = T.computeSuggestion(bench, [perf(iso(2026, 8, 11), 70, [12, 12, 12])], { now, rules });
    assert.equal(s.kind, "return");
    assert.equal(s.target, 60); // 70 × 0.85 = 59.5 → 60
    assert.equal(s.label, "Back from break → 60");
  });
  test("17+ days: return at 90% for non-compounds", () => {
    const s = T.computeSuggestion(stack, [perf(iso(2026, 8, 11), 120, [12, 12, 12])], { now, rules });
    assert.equal(s.kind, "return");
    assert.equal(s.target, 110); // 120 × 0.90 = 108 → 110
  });
  test("return outranks a pending deload streak", () => {
    const perfs = [perf(iso(2026, 8, 11), 120, [8, 7, 6]), perf(iso(2026, 8, 8), 120, [8, 7, 7])];
    const s = T.computeSuggestion(stack, perfs, { now, rules });
    assert.equal(s.kind, "return");
  });
  test("12-16 days: earned bump becomes an informational hold", () => {
    const s = T.computeSuggestion(stack, [perf(iso(2026, 8, 18), 120, [12, 12, 12])], { now, rules });
    assert.equal(s.kind, "hold");
    assert.equal(s.stale, true);
    assert.equal(s.label, "Hold — 12+ days");
  });
  test("12-16 days: build and deload pass through untouched", () => {
    const b = T.computeSuggestion(stack, [perf(iso(2026, 8, 18), 120, [12, 9, 8])], { now, rules });
    assert.equal(b.kind, "build");
    const perfs = [perf(iso(2026, 8, 18), 120, [8, 7, 6]), perf(iso(2026, 8, 15), 120, [8, 7, 7])];
    assert.equal(T.computeSuggestion(stack, perfs, { now, rules }).kind, "deload");
  });
  test("under 12 days: bump as normal", () => {
    const s = T.computeSuggestion(stack, [perf(iso(2026, 8, 28), 120, [12, 12, 12])], { now, rules });
    assert.equal(s.kind, "bump");
    assert.equal(s.target, 125);
  });
  test("closed gate blocks a bump but not a build", () => {
    const held = T.computeSuggestion(stack, [perf(iso(2026, 8, 28), 120, [12, 12, 12])], { now, rules, gateOpen: false });
    assert.equal(held.kind, "hold");
    assert.equal(held.label, "Bump held — QL gate");
    const b = T.computeSuggestion(stack, [perf(iso(2026, 8, 28), 120, [12, 9, 8])], { now, rules, gateOpen: false });
    assert.equal(b.kind, "build");
    assert.equal(T.computeSuggestion(stack, [perf(iso(2026, 8, 28), 120, [12, 12, 12])], { now, rules, gateOpen: true }).kind, "bump");
  });
  test("without opts.now the old behavior stands (no break rules)", () => {
    const s = T.computeSuggestion(stack, [perf(iso(2026, 8, 1), 120, [12, 12, 12])]);
    assert.equal(s.kind, "bump");
  });
}

/* ================= Task 4: QL streak, gates, prompts, slots ================= */

section("qlStreak + gates");
{
  const now = at(2026, 8, 31, 12);
  const qle = (dateIso, ql, extra = {}) => ({ id: "q" + dateIso + (extra.dayType || ""), date: dateIso, dayType: "legs", mode: "gym", ql, ...extra });
  const pass = (y, m, d) => qle(iso(y, m, d), "same-or-better");

  test("streak counts consecutive passes newest-back", () => {
    const idx = [pass(2026, 8, 28), pass(2026, 8, 25), pass(2026, 8, 22), qle(iso(2026, 8, 19), "worse"), pass(2026, 8, 16)];
    assert.equal(T.qlStreak(idx, now), 3);
  });
  test("dismissed and pending (null) break the streak — not a pass", () => {
    assert.equal(T.qlStreak([qle(iso(2026, 8, 28), "dismissed"), pass(2026, 8, 25)], now), 0);
    assert.equal(T.qlStreak([qle(iso(2026, 8, 28), null), pass(2026, 8, 25)], now), 0);
  });
  test("entries under 12h old are invisible to streak and gates", () => {
    const fresh = qle(at(2026, 8, 31, 6).toISOString(), null); // 6h old
    const idx = [fresh, pass(2026, 8, 28), pass(2026, 8, 25)];
    assert.equal(T.qlStreak(idx, now), 2);
    assert.equal(T.gateOpenFor({ gated: true }, idx, now), true);
  });
  test("runs and events carry ql like any other entry", () => {
    const idx = [qle(iso(2026, 8, 29), "same-or-better", { dayType: "run", mode: "run" }), pass(2026, 8, 26)];
    assert.equal(T.qlStreak(idx, now), 2);
  });
  test("lastPass gate: open only on a passing most-recent check", () => {
    const goblet = { gated: true };
    assert.equal(T.gateOpenFor(goblet, [pass(2026, 8, 28)], now), true);
    assert.equal(T.gateOpenFor(goblet, [qle(iso(2026, 8, 28), "worse"), pass(2026, 8, 25)], now), false);
    assert.equal(T.gateOpenFor(goblet, [qle(iso(2026, 8, 28), "dismissed"), pass(2026, 8, 25)], now), false);
    assert.equal(T.gateOpenFor(goblet, [], now), false); // no history = closed
  });
  test("streak gates: bb-row at 3, rdl at 6", () => {
    const three = [pass(2026, 8, 28), pass(2026, 8, 25), pass(2026, 8, 22)];
    assert.equal(T.gateOpenFor({ gated: true, gateStreak: 3 }, three, now), true);
    assert.equal(T.gateOpenFor({ gated: true, gateStreak: 6 }, three, now), false);
  });
  test("non-gated exercises are always open", () => {
    assert.equal(T.gateOpenFor({ id: "bench-db" }, [], now), true);
  });
  test("gateReason strings", () => {
    assert.equal(T.gateReason({ gated: true, gateStreak: 6 }, [pass(2026, 8, 28), pass(2026, 8, 25)], now), "streak 2/6");
    assert.equal(T.gateReason({ gated: true }, [qle(iso(2026, 8, 28), "worse")], now), "last QL check worse");
    assert.equal(T.gateReason({ gated: true }, [qle(iso(2026, 8, 28), "dismissed")], now), "last QL check skipped");
    assert.equal(T.gateReason({ gated: true }, [], now), "no QL check yet");
  });
}

section("qlPromptPick + qlPromptText");
{
  const now = at(2026, 8, 31, 12);
  const entry = (dateIso, ql, extra = {}) => ({ id: "p" + dateIso + (extra.dayType || ""), date: dateIso, dayType: "legs", mode: "gym", ql, ...extra });

  test("newest pending in 12-120h prompts; older pendings dismissed", () => {
    const idx = [entry(iso(2026, 8, 30), null), entry(iso(2026, 8, 27), null), entry(iso(2026, 8, 25), null)];
    const p = T.qlPromptPick(idx, now);
    assert.equal(p.prompt.id, idx[0].id);
    assert.deepEqual(p.dismissIds, [idx[1].id, idx[2].id]);
  });
  test("too fresh (<12h): no prompt yet, but older pendings still dismissed", () => {
    const idx = [entry(at(2026, 8, 31, 6).toISOString(), null), entry(iso(2026, 8, 27), null)];
    const p = T.qlPromptPick(idx, now);
    assert.equal(p.prompt, null);
    assert.deepEqual(p.dismissIds, [idx[1].id]);
  });
  test("expired (>120h): no prompt", () => {
    const p = T.qlPromptPick([entry(iso(2026, 8, 20), null)], now);
    assert.equal(p.prompt, null);
    assert.deepEqual(p.dismissIds, []);
  });
  test("nothing pending: nothing to do", () => {
    const p = T.qlPromptPick([entry(iso(2026, 8, 30), "same-or-better")], now);
    assert.equal(p.prompt, null);
  });
  test("prompt copy names the session type", () => {
    assert.match(T.qlPromptText({ dayType: "run", date: iso(2026, 8, 29) }), /^After your run .*how's the right QL today\?$/);
    assert.match(T.qlPromptText({ dayType: "event", headline: "Golf", date: iso(2026, 8, 29) }), /^After golf .*QL today\?$/);
    assert.match(T.qlPromptText({ dayType: "legs", date: iso(2026, 8, 29) }), /^Legs day .*QL today\?$/);
    assert.match(T.qlPromptText({ dayType: "pull", date: iso(2026, 8, 29) }), /^Pull day /);
  });
}

section("applyGateSlots");
{
  const now = at(2026, 8, 31, 12);
  const pass = (y, m, d) => ({ id: "s" + d, date: iso(y, m, d), dayType: "legs", mode: "gym", ql: "same-or-better" });
  const failIdx = [{ id: "w", date: iso(2026, 8, 28), dayType: "legs", mode: "gym", ql: "worse" }];
  const draftRow = (id, extra = {}) => ({ exerciseId: id, name: id, sets: [], skipped: false, gateHeld: false, ...extra });
  const goblet = (extra = {}) => draftRow("goblet", { gated: true, replaces: "legpress", gateAccepted: true, ...extra });

  test("open + accepted: proper lift active, fallback swapped out", () => {
    const exs = T.applyGateSlots([goblet(), draftRow("legpress")], [pass(2026, 8, 28)], now);
    assert.equal(exs[0].skipped, false);
    assert.equal(exs[1].skipped, true);
    assert.equal(exs[1].gateHeld, true);
    assert.match(exs[1].gateReason, /swapped out for goblet/);
  });
  test("closed gate: proper lift held with reason, fallback active", () => {
    const exs = T.applyGateSlots([goblet(), draftRow("legpress")], failIdx, now);
    assert.equal(exs[0].skipped, true);
    assert.equal(exs[0].gateHeld, true);
    assert.equal(exs[0].gateReason, "last QL check worse");
    assert.equal(exs[1].skipped, false);
  });
  test("open + not yet accepted: offer state, fallback stays active", () => {
    const exs = T.applyGateSlots([goblet({ gateAccepted: false }), draftRow("legpress")], [pass(2026, 8, 28)], now);
    assert.equal(exs[0].skipped, true);
    assert.equal(exs[0].gateOpen, true);
    assert.equal(exs[1].skipped, false);
  });
  test("rows with logged sets are never touched (reopen)", () => {
    const exs = T.applyGateSlots(
      [goblet({ sets: [{ weight: 50, reps: 10 }] }), draftRow("legpress", { sets: [{ weight: 385, reps: 10 }] })],
      failIdx,
      now
    );
    assert.equal(exs[0].skipped, false);
    assert.equal(exs[1].skipped, false);
  });
  test("streak-gated slot: rdl held at 2/6 while goblet-style gate would pass", () => {
    const idx = [pass(2026, 8, 28), pass(2026, 8, 25)];
    const rows = [
      draftRow("rdl", { gated: true, gateStreak: 6, replaces: "backext-45", gateAccepted: true }),
      draftRow("backext-45"),
    ];
    const exs = T.applyGateSlots(rows, idx, now);
    assert.equal(exs[0].skipped, true);
    assert.equal(exs[0].gateReason, "streak 2/6");
    assert.equal(exs[1].skipped, false);
  });
}

section("SEED_CONFIG gated slots");
test("rdl and goblet sit ahead of their fallbacks in legs", () => {
  const ids = T.SEED_CONFIG.days.legs.map((e) => e.id);
  assert.ok(ids.indexOf("rdl") >= 0 && ids.indexOf("rdl") < ids.indexOf("backext-45"));
  assert.ok(ids.indexOf("goblet") >= 0 && ids.indexOf("goblet") < ids.indexOf("legpress"));
});
test("pull slot swapped: bb-row + bilateral row in, single-arm row out", () => {
  const ids = T.SEED_CONFIG.days.pull.map((e) => e.id);
  assert.equal(ids[0], "bb-row");
  assert.equal(ids[1], "row-cs-bilat");
  assert.ok(!ids.includes("row-csdb"));
});
test("gate fields: goblet lastPass, bb-row streak 3, rdl streak 6", () => {
  const byId = (id) => T.SEED_CONFIG.days.legs.concat(T.SEED_CONFIG.days.pull).find((e) => e.id === id);
  assert.equal(byId("goblet").gated, true);
  assert.equal(byId("goblet").gateStreak, undefined);
  assert.equal(byId("goblet").replaces, "legpress");
  assert.equal(byId("bb-row").gateStreak, 3);
  assert.equal(byId("bb-row").replaces, "row-cs-bilat");
  assert.equal(byId("rdl").gateStreak, 6);
  assert.equal(byId("rdl").replaces, "backext-45");
  assert.equal(byId("rdl").current, 95);
  assert.equal(byId("bb-row").current, 65);
  assert.equal(byId("row-cs-bilat").current, 55);
});

/* ================= Task 5: Upper template + cross-day history ================= */

section("upperTemplate + recentEntriesFor");
{
  test("gym upper: first 3 push + first 3 pull slots (gated pair = one slot)", () => {
    const t = T.upperTemplate(T.SEED_CONFIG, "gym");
    assert.deepEqual(
      t.map((e) => e.id),
      ["bench-db", "ohp-db", "incline-db", "bb-row", "row-cs-bilat", "pulldown", "shrug-db"]
    );
  });
  test("upper after gating: active slots total 18 sets", () => {
    const rows = T.upperTemplate(T.SEED_CONFIG, "gym").map((e) => ({
      exerciseId: e.id, name: e.name, targetSets: e.sets, sets: [], skipped: false, gateHeld: false,
      gated: !!e.gated, gateStreak: e.gateStreak || 0, replaces: e.replaces || null, gateAccepted: true,
    }));
    T.applyGateSlots(rows, [], at(2026, 8, 31)); // no QL history: bb-row's gate is closed
    const active = rows.filter((r) => !r.skipped);
    assert.equal(active.reduce((n, r) => n + r.targetSets, 0), 18);
    assert.ok(active.some((r) => r.exerciseId === "row-cs-bilat"));
    assert.ok(!active.some((r) => r.exerciseId === "bb-row"));
  });
  test("calisthenics upper: first 3 + first 3", () => {
    const t = T.upperTemplate(T.SEED_CONFIG, "calisthenics");
    assert.deepEqual(
      t.map((e) => e.id),
      ["cal-pushup", "cal-pike", "cal-diamond", "cal-pullup", "cal-scap", "cal-chinup"]
    );
  });
  test("recentEntriesFor: exerciseIds match any dayType; legacy falls back to home day", () => {
    const idx = [
      { id: "u1", date: iso(2026, 8, 30), dayType: "upper", mode: "gym", exerciseIds: ["bench-db", "pulldown"] },
      { id: "p1", date: iso(2026, 8, 28), dayType: "push", mode: "gym", exerciseIds: ["bench-db", "ohp-db"] },
      { id: "legacy", date: iso(2026, 8, 26), dayType: "push", mode: "gym" },
      { id: "leg1", date: iso(2026, 8, 25), dayType: "legs", mode: "gym" },
      { id: "r1", date: iso(2026, 8, 24), dayType: "run", mode: "run" },
    ];
    assert.deepEqual(T.recentEntriesFor(idx, "bench-db", "push", "gym").map((e) => e.id), ["u1", "p1", "legacy"]);
    assert.deepEqual(T.recentEntriesFor(idx, "pulldown", "pull", "gym").map((e) => e.id), ["u1"]);
  });
  test("recentEntriesFor caps at 6 per exercise", () => {
    const idx = Array.from({ length: 10 }, (_, i) => ({
      id: "e" + i, date: iso(2026, 8, 30 - i), dayType: "push", mode: "gym", exerciseIds: ["bench-db"],
    }));
    assert.equal(T.recentEntriesFor(idx, "bench-db", "push", "gym").length, 6);
  });
  test("homeDayOf finds the source list", () => {
    assert.equal(T.homeDayOf(T.SEED_CONFIG, "gym", "bb-row"), "pull");
    assert.equal(T.homeDayOf(T.SEED_CONFIG, "gym", "goblet"), "legs");
    assert.equal(T.homeDayOf(T.SEED_CONFIG, "gym", "not-a-lift"), null);
  });
}

/* ================= Task 6: weight stall detector ================= */

section("weightStall");
{
  const now = at(2026, 8, 31, 9); // Monday
  const w = (y, m, d, weight) => ({ id: `w-${y}${m}${d}`, date: iso(y, m, d, 8), weight });
  const mondays = (vals) => [w(2026, 8, 10, vals[3]), w(2026, 8, 17, vals[2]), w(2026, 8, 24, vals[1]), w(2026, 8, 31, vals[0])];

  test("flat weight for four Mondays = stalled", () => {
    const st = T.weightStall(mondays([200, 200, 200, 200]), now);
    assert.equal(st.stalled, true);
    assert.deepEqual(st.deltas, [0, 0, 0]);
  });
  test("gaining also reads as stalled (deltas > -0.3)", () => {
    const st = T.weightStall(mondays([201.5, 201, 200.5, 200]), now);
    assert.equal(st.stalled, true);
    assert.equal(st.latestDelta, 0.5);
  });
  test("steady loss is not a stall", () => {
    const st = T.weightStall(mondays([198.5, 199, 199.5, 200]), now);
    assert.equal(st.stalled, false);
    assert.equal(st.latestDelta, -0.5);
  });
  test("-0.3 exactly breaks the stall chain; -0.29 does not", () => {
    assert.equal(T.weightStall(mondays([200.0, 200.3, 200.6, 200.9]), now).stalled, false);
    assert.equal(T.weightStall(mondays([200.0, 200.29, 200.58, 200.87]), now).stalled, true);
  });
  test("a week with no weigh-ins breaks the chain (no phantom stalls)", () => {
    const st = T.weightStall([w(2026, 8, 10, 200), w(2026, 8, 17, 200), w(2026, 8, 31, 200)], now);
    assert.equal(st.stalled, false);
    assert.equal(st.latestDelta, null); // Aug 24 window is empty
  });
  test("windows are Tue..Mon: Fri/Sat highs live inside, means average the window", () => {
    // Current window (Aug 25 - 31): 199 on Wed, 203 refeed Sat, 200 Mon -> mean 200.67
    // Prior window: flat 201.67 equivalent via three entries.
    const data = [
      w(2026, 8, 26, 199), w(2026, 8, 29, 203), w(2026, 8, 31, 200),
      w(2026, 8, 19, 200), w(2026, 8, 22, 204), w(2026, 8, 24, 201),
    ];
    const st = T.weightStall(data, now);
    assert.equal(Math.round(st.means[0] * 100) / 100, Math.round(((199 + 203 + 200) / 3) * 100) / 100);
    assert.equal(st.latestDelta, Math.round(((199 + 203 + 200) / 3 - (200 + 204 + 201) / 3) * 100) / 100);
  });
  test("weigh-ins outside the four windows are ignored", () => {
    const st = T.weightStall([w(2026, 7, 1, 190), ...mondays([200, 200, 200, 200])], now);
    assert.deepEqual(st.deltas, [0, 0, 0]);
  });
}

/* ================= Task 7: scheduled deload week ================= */

section("deloadDue + inDeloadWeek");
{
  const now = at(2026, 8, 31, 9); // Monday 31 Aug
  // Build n lifts inside the week starting on the given Monday.
  const week = (y, m, d, n) =>
    Array.from({ length: n }, (_, i) => lift(["push", "pull", "legs"][i % 3], iso(y, m, d + i * 2)));
  // Six full training weeks: Mondays Jul 20 .. Aug 24.
  const sixWeeks = [
    ...week(2026, 8, 24, 3), ...week(2026, 8, 17, 3), ...week(2026, 8, 10, 3),
    ...week(2026, 8, 3, 3), ...week(2026, 7, 27, 3), ...week(2026, 7, 20, 3),
  ];

  test("six consecutive >=2-lift weeks: due", () => {
    const dl = T.deloadDue(sixWeeks, { deloadEveryWeeks: 6 }, now);
    assert.equal(dl.weeks, 6);
    assert.equal(dl.due, true);
    assert.equal(dl.active, false);
  });
  test("an under-floor week resets the counter (stop-start never stacks)", () => {
    const idx = [...week(2026, 8, 24, 3), ...week(2026, 8, 17, 2), ...week(2026, 8, 10, 1), ...week(2026, 8, 3, 3)];
    const dl = T.deloadDue(idx, { deloadEveryWeeks: 6 }, now);
    assert.equal(dl.weeks, 2);
    assert.equal(dl.due, false);
  });
  test("a completed deload week resets the counter even if it had lifts", () => {
    const dl = T.deloadDue(sixWeeks, { deloadEveryWeeks: 6, deloadWeekOf: "2026-08-10" }, now);
    assert.equal(dl.weeks, 2); // Aug 24 + Aug 17 only
    assert.equal(dl.due, false);
  });
  test("the in-progress week joins once it has >=2 lifts", () => {
    const idx = [...week(2026, 8, 31, 2), ...week(2026, 8, 24, 3)];
    assert.equal(T.deloadDue(idx, { deloadEveryWeeks: 6 }, now).weeks, 2);
    const one = [...week(2026, 8, 31, 1), ...week(2026, 8, 24, 3)];
    assert.equal(T.deloadDue(one, { deloadEveryWeeks: 6 }, now).weeks, 1);
  });
  test("active deload week: never due, flagged active", () => {
    const dl = T.deloadDue(sixWeeks, { deloadEveryWeeks: 6, deloadWeekOf: "2026-08-31" }, now);
    assert.equal(dl.active, true);
    assert.equal(dl.due, false);
  });
  test("deloadEveryWeeks override honored", () => {
    const idx = [...week(2026, 8, 24, 3), ...week(2026, 8, 17, 3), ...week(2026, 8, 10, 3), ...week(2026, 8, 3, 3)];
    assert.equal(T.deloadDue(idx, { deloadEveryWeeks: 4 }, now).due, true);
    assert.equal(T.deloadDue(idx, { deloadEveryWeeks: 6 }, now).due, false);
  });
  test("runs and events never feed the counter", () => {
    const idx = [
      run(iso(2026, 8, 25)), run(iso(2026, 8, 27)),
      { id: "ev", date: iso(2026, 8, 26), dayType: "event", mode: "event", ql: null },
    ];
    assert.equal(T.deloadDue(idx, { deloadEveryWeeks: 6 }, now).weeks, 0);
  });
  test("inDeloadWeek matches only the stamped week", () => {
    const rules = { deloadWeekOf: "2026-08-31" };
    assert.equal(T.inDeloadWeek(rules, at(2026, 8, 31, 8)), true);
    assert.equal(T.inDeloadWeek(rules, at(2026, 9, 6, 23)), true); // Sunday of the same week
    assert.equal(T.inDeloadWeek(rules, at(2026, 9, 7, 1)), false); // next Monday: expired
    assert.equal(T.inDeloadWeek({}, at(2026, 8, 31)), false);
  });
  test("deload pending weight math: 90% snapped, never a no-op", () => {
    assert.equal(T.roundToIncrement(385 * 0.9, 10, 385), 350);
    assert.equal(T.roundToIncrement(50 * 0.9, 5, 50), 45);
    assert.equal(T.roundToIncrement(17.5 * 0.9, 2.5, 17.5), 15);
  });
}

/* ================= core ladder ================= */

section("core ladder");
{
  const perfAt = (dateIso, reps, weight = 0) => ({ date: dateIso, sets: reps.map((r) => ({ weight, reps: r })) });
  const bent = T.SEED_CONFIG.core[0];

  test("seed ladder chains bent -> straight -> weighted; checkbox core retired (v5)", () => {
    assert.deepEqual(T.SEED_CONFIG.core.map((e) => e.id), ["cchair-bent", "cchair-straight", "cchair-weighted"]);
    assert.equal(T.SEED_CONFIG.core[0].progressesTo, "cchair-straight");
    assert.equal(T.SEED_CONFIG.core[1].progressesTo, "cchair-weighted");
    assert.equal(T.SEED_CONFIG.core[2].progressesTo, undefined);
    assert.equal(T.SEED_CONFIG.mobility.v, 5);
    assert.deepEqual(T.SEED_CONFIG.mobility.core, { push: [], pull: [], legs: [] });
  });
  test("activeCoreRung: first non-graduated entry", () => {
    assert.equal(T.activeCoreRung(T.SEED_CONFIG.core).id, "cchair-bent");
    const later = T.SEED_CONFIG.core.map((e, i) => (i === 0 ? { ...e, graduated: true } : e));
    assert.equal(T.activeCoreRung(later).id, "cchair-straight");
    assert.equal(T.activeCoreRung([]), null);
  });
  test("coreRungStreak counts consecutive all-sets-at-ceiling sessions", () => {
    const perfs = [
      perfAt(iso(2026, 8, 30), [15, 15, 15]),
      perfAt(iso(2026, 8, 28), [15, 16, 15]),
      perfAt(iso(2026, 8, 26), [15, 14, 12]),
    ];
    assert.equal(T.coreRungStreak(bent, perfs), 2);
    assert.equal(T.coreRungStreak(bent, [perfAt(iso(2026, 8, 30), [15, 12, 10])]), 0);
  });
  test("cleared at 2 clean sessions -> actionable rung offer", () => {
    const perfs = [perfAt(iso(2026, 8, 30), [15, 15, 15]), perfAt(iso(2026, 8, 28), [15, 15, 15])];
    assert.equal(T.coreRungSuggestion(bent, perfs).kind, "rung");
  });
  test("one clean session -> 1-of-2 note, never a bump", () => {
    const one = [perfAt(iso(2026, 8, 30), [15, 15, 15]), perfAt(iso(2026, 8, 28), [15, 12, 10])];
    const s = T.coreRungSuggestion(bent, one);
    assert.equal(s.kind, "hold");
    assert.match(s.label, /1 of 2/);
  });
  test("an engine bump on a ladder rung becomes the bar reminder", () => {
    const s = T.coreRungSuggestion(bent, [perfAt(iso(2026, 8, 30), [15, 12, 10])]);
    assert.equal(s.kind, "hold");
    assert.match(s.label, /Rung clears at 3×15/);
  });
  test("build passes through on ladder exercises", () => {
    assert.equal(T.coreRungSuggestion(bent, [perfAt(iso(2026, 8, 30), [15, 7, 6])]).kind, "build");
  });
  test("final rung has no progressesTo and bumps normally (+5)", () => {
    const weighted = T.SEED_CONFIG.core[2];
    const s = T.coreRungSuggestion(weighted, [perfAt(iso(2026, 8, 30), [12, 12, 12], 5)]);
    assert.equal(s.kind, "bump");
    assert.equal(s.target, 10);
  });
}

/* ================= summary ================= */

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
