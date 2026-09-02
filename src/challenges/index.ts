// The curriculum. Each challenge is a short lesson plus a fixed set of IO
// terminals, a whitelist of components the palette offers, and a reference
// truth function the verifier checks against.
//
// Teaching structure: `howItWorks` frames the problem conceptually without
// giving the construction; `hints` are revealed one at a time on demand and
// lead progressively toward the answer; `solution` is the explicit wiring,
// shown only when the learner asks for it.
//
// A challenge's canvas starts from `buildStarterDoc`: locked input terminals
// down the left, locked output terminals down the right.

import type { CircuitDoc, ComponentInstance } from "../domain/types";

/** An IO terminal: a name and a bus width (1 unless stated). */
export interface Terminal {
  name: string;
  width: number;
}

/** Terminal spec as authored — a bare string is a 1-bit terminal. */
export type TerminalSpec = string | { name: string; width?: number };

export function normTerminal(spec: TerminalSpec): Terminal {
  return typeof spec === "string"
    ? { name: spec, width: 1 }
    : { name: spec.name, width: spec.width ?? 1 };
}

export interface Challenge {
  id: string;
  /** 0 = free sandbox, 1..n = ordered lessons. */
  index: number;
  title: string;
  /** What you're building and why it matters. */
  goal: string;
  /** The concept and the shape of the problem — deliberately not the answer. */
  howItWorks: string;
  /** Revealed one at a time; hint 1 nudges, the last is nearly the answer. */
  hints?: string[];
  /** The explicit construction, shown only on request. */
  solution?: string;
  /** A short aside: history or a surprising fact. */
  funFact: string;
  /** Plain description of what the verifier checks. */
  checks: string;
  /**
   * Component types offered in the palette for this challenge.
   * `undefined` means everything (used by the sandbox).
   */
  allowedTypes?: string[];
  /** Ordered input terminals. Empty for the sandbox. */
  inputs: TerminalSpec[];
  /** Ordered output terminals. Empty for the sandbox. */
  outputs: TerminalSpec[];
  /**
   * Reference behaviour: given each input terminal's integer value (in
   * `inputs` order), return each output terminal's expected value (in
   * `outputs` order). Absent for the sandbox.
   */
  truth?: (inputs: number[]) => number[];
}

/** Input terminals of a challenge, normalised. */
export function challengeInputs(ch: Challenge): Terminal[] {
  return ch.inputs.map(normTerminal);
}

/** Output terminals of a challenge, normalised. */
export function challengeOutputs(ch: Challenge): Terminal[] {
  return ch.outputs.map(normTerminal);
}

/** Deterministic id of an input terminal, so the verifier can find it. */
export function inputTermId(label: string): string {
  return `term-in-${label}`;
}

/** Deterministic id of an output terminal. */
export function outputTermId(label: string): string {
  return `term-out-${label}`;
}

/**
 * Fresh canvas for a challenge: its locked IO terminals and nothing else.
 * Called by the store whenever the active challenge changes or is reset.
 */
export function buildStarterDoc(ch: Challenge): CircuitDoc {
  const components: Record<string, ComponentInstance> = {};
  challengeInputs(ch).forEach((t, i) => {
    const id = inputTermId(t.name);
    components[id] = {
      id,
      type: t.width > 1 ? `in${t.width}` : "input",
      x: 40,
      y: 56 + i * 72,
      label: t.name,
      state: { value: 0, width: t.width },
      locked: true,
    };
  });
  challengeOutputs(ch).forEach((t, i) => {
    const id = outputTermId(t.name);
    components[id] = {
      id,
      type: t.width > 1 ? `out${t.width}` : "output",
      x: 340,
      y: 56 + i * 72,
      label: t.name,
      locked: true,
    };
  });
  return { id: crypto.randomUUID(), name: ch.title, components, wires: {} };
}

const FROM_NAND = ["nand"];
const BASIC_GATES = ["nand", "not", "and", "or", "xor"];

export const CHALLENGES: Challenge[] = [
  {
    id: "sandbox",
    index: 0,
    title: "Sandbox",
    goal:
      "A free workspace. Drop in inputs, gates, and outputs, wire them together, and toggle the inputs to watch signals propagate.",
    howItWorks:
      "Every wire carries one of three values: 0, 1, or X (unknown). A gate recomputes its output whenever an input changes, after a small delay. Outputs light up when they read a 1.",
    funFact:
      "The NAND gate is 'functionally complete': every other logic gate — AND, OR, NOT, XOR — can be built from NAND alone. That's why chip fabs can optimise for essentially one gate.",
    checks: "Nothing to verify here — build whatever you like.",
    inputs: [],
    outputs: [],
  },

  {
    id: "not-from-nand",
    index: 1,
    title: "NOT from NAND",
    goal: "Build an inverter using only a NAND gate: the output is the opposite of the input.",
    howItWorks:
      "A NAND gate outputs 0 only when both of its inputs are 1; in every other case it outputs 1. You have one incoming signal and one NAND. Think about how the NAND behaves if both of its inputs always see that same signal.",
    hints: [
      "A NAND with both inputs at 0 outputs 1; with both inputs at 1 it outputs 0. That is already the behaviour of an inverter.",
      "Only one wire arrives at the challenge, but a NAND has two input pins. Nothing stops both pins connecting to the same wire.",
    ],
    solution:
      "Wire input a to BOTH input pins of the NAND. Wire the NAND's output to y. Then a=0 gives NAND(0,0)=1 and a=1 gives NAND(1,1)=0.",
    funFact:
      "Feeding one signal into both inputs of a NAND is the first move in the classic 'build a computer from NAND' progression — every gate below depends on it.",
    checks: "Input 0 must give 1, and input 1 must give 0. Both cases are tested.",
    allowedTypes: FROM_NAND,
    inputs: ["a"],
    outputs: ["y"],
    truth: ([a]) => [a ? 0 : 1],
  },

  {
    id: "and-from-nand",
    index: 2,
    title: "AND from NAND",
    goal: "Build a 2-input AND gate from NAND gates only.",
    howItWorks:
      "A NAND computes not(a and b) — an AND with the result flipped. You want a plain AND. You already know how to flip a signal from the previous challenge.",
    hints: [
      "If a NAND hands you not(a and b), what single operation turns that back into (a and b)?",
      "Apply a NOT to the NAND's output — and a NOT is itself a NAND with its inputs tied together.",
    ],
    solution:
      "First NAND takes a and b, giving not(a and b). Feed that into a second NAND wired as an inverter (both pins tied to the first NAND's output). Its output is (a and b) → y.",
    funFact:
      "AND from NAND costs two gates. Early NMOS chips counted every transistor, so designers often restructured logic to avoid that extra inverter.",
    checks: "All four input combinations are checked against the AND truth table.",
    allowedTypes: FROM_NAND,
    inputs: ["a", "b"],
    outputs: ["y"],
    truth: ([a, b]) => [a && b ? 1 : 0],
  },

  {
    id: "or-from-nand",
    index: 3,
    title: "OR from NAND",
    goal: "Build a 2-input OR gate from NAND gates only.",
    howItWorks:
      "De Morgan's law says a or b is the same as not((not a) and (not b)). Look closely at that outer 'not(… and …)' — it is exactly the shape of a NAND.",
    hints: [
      "not((not a) and (not b)) is the same as NAND(not a, not b).",
      "Invert a, invert b, then feed both inverted signals into one NAND. That NAND's output is a or b.",
    ],
    solution:
      "Build two inverters (NOT-from-NAND), one for a and one for b. Feed both inverter outputs into a third NAND. Its output is a or b → y.",
    funFact:
      "De Morgan's laws, from the 1850s, are why NAND and NOR are each enough on their own: they let you turn any AND into an OR and back by flipping inputs and outputs.",
    checks: "All four input combinations are checked against the OR truth table.",
    allowedTypes: FROM_NAND,
    inputs: ["a", "b"],
    outputs: ["y"],
    truth: ([a, b]) => [a || b ? 1 : 0],
  },

  {
    id: "xor-from-nand",
    index: 4,
    title: "XOR from NAND",
    goal: "Build an exclusive-OR: output 1 when exactly one input is 1.",
    howItWorks:
      "XOR is 1 when the inputs differ. One NAND is not enough — the standard construction uses four. The idea: compute one intermediate signal from a and b, then combine each original input with that intermediate before a final NAND.",
    hints: [
      "Start with m = NAND(a, b). It is 0 only when both inputs are 1.",
      "Now compute NAND(a, m) and NAND(b, m) as two separate signals.",
      "NAND those two results together for y. Trace a=1, b=1: m=0, so NAND(a,m)=1 and NAND(b,m)=1, so y = NAND(1,1) = 0 — correct, since 1 XOR 1 = 0.",
    ],
    solution:
      "m = NAND(a, b). p = NAND(a, m). q = NAND(b, m). y = NAND(p, q). Four NAND gates total.",
    funFact:
      "XOR is the heart of binary addition — a + b with no carry is exactly a XOR b. You'll reuse this gate in the half adder.",
    checks: "All four input combinations are checked against the XOR truth table.",
    allowedTypes: FROM_NAND,
    inputs: ["a", "b"],
    outputs: ["y"],
    truth: ([a, b]) => [a === b ? 0 : 1],
  },

  {
    id: "mux2",
    index: 5,
    title: "2-to-1 Multiplexer",
    goal:
      "Build a selector: when sel is 0 the output follows d0, when sel is 1 it follows d1.",
    howItWorks:
      "A multiplexer lets exactly one of its data inputs through to the output, chosen by sel. Think of sel and its inverse as two 'valves', each enabling one data path and blocking the other.",
    hints: [
      "When sel=0 you want d0 to reach the output and d1 forced to 0; when sel=1, the reverse.",
      "d0 AND (NOT sel) equals d0 when sel=0 and 0 when sel=1. Build the mirror term for d1 using sel directly.",
      "OR the two terms together: (d0 AND NOT sel) OR (d1 AND sel).",
    ],
    solution:
      "g = NOT(sel). t0 = AND(d0, g). t1 = AND(d1, sel). y = OR(t0, t1).",
    funFact:
      "The multiplexer is how a CPU chooses between operands — 'the number from the instruction' versus 'the number from a register'. You'll wire many into the datapath later.",
    checks: "All eight combinations of d0, d1, sel are checked.",
    allowedTypes: [...BASIC_GATES],
    inputs: ["d0", "d1", "sel"],
    outputs: ["y"],
    truth: ([d0, d1, sel]) => [sel ? d1 : d0],
  },

  {
    id: "half-adder",
    index: 6,
    title: "Half adder",
    goal:
      "Add two bits. Produce their sum bit and the carry bit for the next column.",
    howItWorks:
      "Adding two single bits: 0+0=0, 0+1=1, 1+0=1, 1+1=10 (binary two). The result needs two outputs — a sum bit for this column and a carry into the next. Write out when each output is 1.",
    hints: [
      "sum is 1 for 0+1 and 1+0, but 0 for 1+1 (it rolls over). One basic gate has exactly that truth table.",
      "carry is 1 only for 1+1 — that is an AND.",
    ],
    solution: "sum = XOR(a, b). carry = AND(a, b).",
    funFact:
      "It's called 'half' because it can't accept a carry coming in from a lower column. Chain a second one and you get a full adder.",
    checks: "All four input combinations are checked for both sum and carry.",
    allowedTypes: [...BASIC_GATES],
    inputs: ["a", "b"],
    outputs: ["sum", "carry"],
    truth: ([a, b]) => [a === b ? 0 : 1, a && b ? 1 : 0],
  },

  {
    id: "full-adder",
    index: 7,
    title: "Full adder",
    goal:
      "Add three bits — a, b, and a carry-in — producing a sum bit and a carry-out.",
    howItWorks:
      "Like the half adder, but a third input arrives: the carry from the previous column. You're adding three bits and still producing a sum bit and a carry-out. The running total can be 0, 1, 2, or 3.",
    hints: [
      "sum is 1 when an odd number of the three inputs are 1. Chaining XOR across all three does exactly that.",
      "carry-out is 1 when at least two inputs are 1. (a AND b) handles the case where a and b are both set.",
      "The other case is 'cin plus exactly one of a, b'. (a XOR b) is 1 when exactly one of them is set, so AND it with cin: cout = (a AND b) OR (cin AND (a XOR b)).",
    ],
    solution:
      "s1 = XOR(a, b). sum = XOR(s1, cin). cout = OR(AND(a, b), AND(cin, s1)).",
    funFact:
      "Stack eight full adders, carry-out to carry-in, and you can add two 8-bit numbers. That chain is the 'ripple-carry adder' — and the reason addition gets slower for wider numbers.",
    checks: "All eight input combinations are checked for both outputs.",
    allowedTypes: [...BASIC_GATES],
    inputs: ["a", "b", "cin"],
    outputs: ["sum", "cout"],
    truth: ([a, b, cin]) => {
      const total = a + b + cin;
      return [total & 1, total >= 2 ? 1 : 0];
    },
  },

  {
    id: "adder8",
    index: 8,
    title: "8-bit adder",
    goal:
      "Add two 8-bit numbers and produce their 8-bit sum plus a carry-out.",
    howItWorks:
      "Each column of the addition is a full adder: it takes one bit of a, one bit of b, and the carry from the column to its right, and produces a sum bit and a carry into the next column. Eight of them in a row, carry rippling left, adds two bytes.",
    hints: [
      "Use a splitter (÷8) to break each input bus into 8 separate bits, and a merger (×8) to bundle the 8 sum bits back onto the output bus.",
      "The bit-0 (rightmost) full adder's carry-in is 0. Every other carry-in is the carry-out of the adder one place to its right.",
      "Build one full adder, select it, and 'Make block' — then place eight copies instead of wiring 40 gates.",
    ],
    solution:
      "Split a and b. carry[0] = 0. For i in 0..7: FullAdder(a[i], b[i], carry[i]) → sum[i], carry[i+1]. Merge sum[0..7] to the output bus. cout = carry[8].",
    funFact:
      "This is a 'ripple-carry' adder: the carry must propagate through all eight stages, so the worst case is 8 gate delays deep. Carry-lookahead adders compute the carries in parallel to go faster.",
    checks:
      "Edge cases (0, 255, overflow) plus a few hundred random pairs are checked against a + b and the carry-out.",
    allowedTypes: [...BASIC_GATES, "split8", "merge8", "composite"],
    inputs: [{ name: "a", width: 8 }, { name: "b", width: 8 }, "cin"],
    outputs: [{ name: "sum", width: 8 }, "cout"],
    truth: ([a, b, cin]) => {
      const total = a + b + cin;
      return [total & 0xff, total > 0xff ? 1 : 0];
    },
  },
];

/** Look up a challenge by id, falling back to the sandbox. */
export function getChallenge(id: string): Challenge {
  return CHALLENGES.find((c) => c.id === id) ?? CHALLENGES[0];
}
