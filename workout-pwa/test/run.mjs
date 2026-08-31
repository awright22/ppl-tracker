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

/* ================= summary ================= */

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
