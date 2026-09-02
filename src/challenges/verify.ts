// Exhaustive verifier for combinational challenges. Drives every possible
// input combination into a fresh copy of the circuit, settles it, and compares
// the output terminals against the challenge's reference truth function.
// Feasible because early challenges have few inputs (<= ~10).

import type { CircuitDoc } from "../domain/types";
import type { Logic } from "../sim/values";
import { bit } from "../sim/values";
import { Simulator } from "../sim/simulator";
import { flatten } from "../sim/flatten";
import type { Challenge } from ".";
import { inputTermId, outputTermId } from ".";

export interface VerifyRow {
  /** Input bits, in the challenge's declared order. */
  inputs: number[];
  expected: number[];
  actual: Logic[];
  ok: boolean;
}

export interface VerifyResult {
  ok: boolean;
  rows: VerifyRow[];
  /** Row index of the first failure, or -1 if all rows pass. */
  firstFail: number;
  /** True if any combination left the circuit oscillating. */
  oscillated: boolean;
}

/**
 * Run the full truth-table check for `ch` against `doc`. Returns one row per
 * input combination plus a summary. Called by the store's `verify` action when
 * the user hits "Check".
 */
export function verifyChallenge(doc: CircuitDoc, ch: Challenge): VerifyResult {
  const rows: VerifyRow[] = [];
  if (!ch.truth || ch.inputs.length === 0) {
    return { ok: false, rows, firstFail: -1, oscillated: false };
  }

  const n = ch.inputs.length;
  const inIds = ch.inputs.map(inputTermId);
  const outIds = ch.outputs.map(outputTermId);
  let oscillated = false;
  let firstFail = -1;

  for (let combo = 0; combo < 1 << n; combo++) {
    // MSB-first so the table reads 000, 001, 010, ...
    const bits = ch.inputs.map((_, i) => (combo >> (n - 1 - i)) & 1);

    const testDoc: CircuitDoc = { ...doc, components: { ...doc.components } };
    inIds.forEach((id, i) => {
      const c = testDoc.components[id];
      if (c) testDoc.components[id] = { ...c, state: { ...c.state, value: bits[i] } };
    });

    const sim = new Simulator(flatten(testDoc).flat);
    const settle = sim.reset();
    const actual = outIds.map((id) => bit(sim.inputValue({ component: id, port: "in" })));
    const expected = ch.truth(bits);
    const ok =
      settle.settled &&
      actual.length === expected.length &&
      actual.every((v, i) => v === expected[i]);

    if (!settle.settled) oscillated = true;
    if (!ok && firstFail < 0) firstFail = rows.length;
    rows.push({ inputs: bits, expected, actual, ok });
  }

  return { ok: firstFail < 0 && !oscillated, rows, firstFail, oscillated };
}
