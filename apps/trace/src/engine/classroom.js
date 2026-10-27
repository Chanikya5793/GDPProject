import { analyze, applyProposal, SCENARIOS, SEED_RECORDS } from "./pipeline.js";
import { attention } from "./transformer.js";

export function classroomChecks() {
  const records = SEED_RECORDS.map((r) => ({ ...r }));
  const results = [];
  const check = (name, run) => {
    try {
      results.push({ name, passed: !!run() });
    } catch (error) {
      results.push({ name, passed: false, error: error.message });
    }
  };
  check(
    "Duplicate titles require a choice",
    () => analyze(SCENARIOS[0].prompt, records).decision.reason === "duplicate",
  );
  check("Only B changes; A stays revision 1", () => {
    const p = analyze(SCENARIOS[0].prompt, records, "B").decision.proposal;
    const next = applyProposal(records, p);
    return (
      JSON.stringify(next[0]) === JSON.stringify(records[0]) &&
      next[1].date === "2026-10-20" &&
      next[1].time === "11:00" &&
      next[1].revision === 2
    );
  });
  check(
    "25:00 cannot create a proposal",
    () => analyze(SCENARIOS[3].prompt, records).decision.status === "clarify",
  );
  check(
    "Unbounded recurrence asks how long",
    () => analyze(SCENARIOS[4].prompt, records).decision.status === "clarify",
  );
  check(
    "Four weeks produces four dates",
    () =>
      analyze(SCENARIOS[5].prompt, records).decision.proposal.dates.length ===
      4,
  );
  check("Unrelated terms have zero similarity", () =>
    analyze("Find my zebras", records).vectors.results.every(
      (r) => r.score === 0,
    ),
  );
  check("Stale revisions cannot apply twice", () => {
    const p = analyze(SCENARIOS[0].prompt, records, "B").decision.proposal;
    const next = applyProposal(records, p);
    try {
      applyProposal(next, p);
      return false;
    } catch {
      return true;
    }
  });
  check("Attention is normalized and causal", () =>
    attention("Remind me to call advisor").weights.every(
      (row, i) =>
        Math.abs(row.reduce((a, b) => a + b, 0) - 1) < 1e-10 &&
        row.slice(i + 1).every((w) => w === 0),
    ),
  );
  return results;
}
