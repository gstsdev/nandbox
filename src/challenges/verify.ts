// Verifier for combinational challenges. Drives input combinations through a
// flattened simulator and compares each output terminal's value against the
// challenge's reference truth function.
//
// If the total input space is small it is checked exhaustively; otherwise a
// mix of edge cases and random vectors is sampled.

import type { CircuitDoc } from "../domain/types";
import { busToNum } from "../sim/values";
import { Simulator } from "../sim/simulator";
import { flatten } from "../sim/flatten";
import type { Challenge, Terminal } from ".";
import { challengeInputs, challengeOutputs, inputTermId, outputTermId } from ".";

export interface VerifyRow {
  /** Each input terminal's integer value, in declared order. */
  inputs: number[];
  expected: number[];
  /** Each output terminal's value, or null if it held an unknown bit. */
  actual: (number | null)[];
  ok: boolean;
}

export interface VerifyResult {
  ok: boolean;
  rows: VerifyRow[];
  /** Row index of the first failure, or -1 if all rows pass. */
  firstFail: number;
  /** True if any combination left the circuit oscillating. */
  oscillated: boolean;
  /** How the check was run. */
  mode: "exhaustive" | "sampled";
  /** Total cases actually tested. */
  tested: number;
}

/** Above this many input combinations, sample instead of enumerating. */
const EXHAUSTIVE_LIMIT = 4096;

/**
 * Run the truth-table check for `ch` against `doc`. Called by the store's
 * `verify` action.
 */
export function verifyChallenge(doc: CircuitDoc, ch: Challenge): VerifyResult {
  const empty: VerifyResult = {
    ok: false,
    rows: [],
    firstFail: -1,
    oscillated: false,
    mode: "exhaustive",
    tested: 0,
  };
  if (!ch.truth || ch.inputs.length === 0) return empty;

  const ins = challengeInputs(ch);
  const outs = challengeOutputs(ch);
  const space = ins.reduce((n, t) => n * 2 ** t.width, 1);
  const mode: VerifyResult["mode"] = space <= EXHAUSTIVE_LIMIT ? "exhaustive" : "sampled";
  const vectors =
    mode === "exhaustive" ? enumerate(ins) : sampleVectors(ins);

  const sim = new Simulator(flatten(doc).flat);
  sim.reset();

  const rows: VerifyRow[] = [];
  let oscillated = false;
  let firstFail = -1;

  for (const values of vectors) {
    ins.forEach((t, i) => sim.setState(inputTermId(t.name), { value: values[i], width: t.width }));
    const settle = sim.settle();
    const actual = outs.map((t) =>
      busToNum(sim.inputValue({ component: outputTermId(t.name), port: "in" })),
    );
    const expected = ch.truth(values);
    const ok =
      settle.settled &&
      actual.length === expected.length &&
      actual.every((v, i) => v === expected[i]);

    if (!settle.settled) oscillated = true;
    if (!ok && firstFail < 0) firstFail = rows.length;
    rows.push({ inputs: values, expected, actual, ok });
  }

  return {
    ok: firstFail < 0 && !oscillated,
    rows,
    firstFail,
    oscillated,
    mode,
    tested: rows.length,
  };
}

/** Every combination of terminal values, MSB terminal counting fastest-outermost. */
function enumerate(ins: Terminal[]): number[][] {
  let combos: number[][] = [[]];
  for (const t of ins) {
    const next: number[][] = [];
    for (const prefix of combos) {
      for (let v = 0; v < 2 ** t.width; v++) next.push([...prefix, v]);
    }
    combos = next;
  }
  return combos;
}

/** Edge cases plus random vectors for input spaces too large to enumerate. */
function sampleVectors(ins: Terminal[]): number[][] {
  const max = (t: Terminal) => 2 ** t.width - 1;
  const edges = [
    ins.map(() => 0),
    ins.map((t) => max(t)),
    ins.map((t, i) => (i === 0 ? max(t) : 0)),
    ins.map((t, i) => (i === 0 ? 0 : max(t))),
    ins.map((t) => (max(t) === 0 ? 0 : Math.floor((max(t) + 1) / 2))),
    ins.map((t) => (max(t) === 0 ? 1 : 1)),
  ];
  const random: number[][] = [];
  for (let k = 0; k < 400; k++) {
    random.push(ins.map((t) => Math.floor(Math.random() * (max(t) + 1))));
  }
  return [...edges, ...random];
}
