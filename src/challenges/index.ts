// The curriculum. Each challenge is a short lesson plus a fixed set of IO
// terminals, a whitelist of components the palette offers, and a reference
// truth function the verifier checks against.
//
// A challenge's canvas starts from `buildStarterDoc`: locked input terminals
// down the left, locked output terminals down the right, and the user wires
// the logic between them.

import type { CircuitDoc, ComponentInstance } from "../domain/types";

export interface Challenge {
  id: string;
  /** 0 = free sandbox, 1..n = ordered lessons. */
  index: number;
  title: string;
  /** What you're building and why it matters. */
  goal: string;
  /** How the concept works — a paragraph the briefing panel renders. */
  howItWorks: string;
  /** A short aside: history or a surprising fact. */
  funFact: string;
  /** Plain description of what the verifier checks. */
  checks: string;
  /**
   * Component types offered in the palette for this challenge.
   * `undefined` means everything (used by the sandbox).
   */
  allowedTypes?: string[];
  /** Ordered input-terminal labels. Empty for the sandbox. */
  inputs: string[];
  /** Ordered output-terminal labels. Empty for the sandbox. */
  outputs: string[];
  /**
   * Reference behaviour: given input bits in `inputs` order, return the
   * expected output bits in `outputs` order. Absent for the sandbox.
   */
  truth?: (inputs: number[]) => number[];
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
  ch.inputs.forEach((label, i) => {
    const id = inputTermId(label);
    components[id] = {
      id,
      type: "input",
      x: 40,
      y: 56 + i * 56,
      label,
      state: { value: 0 },
      locked: true,
    };
  });
  ch.outputs.forEach((label, i) => {
    const id = outputTermId(label);
    components[id] = {
      id,
      type: "output",
      x: 320,
      y: 56 + i * 56,
      label,
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
      "A NAND gate outputs 0 only when both its inputs are 1. Feed the same signal into both inputs and it becomes a NOT: 0 → 1, 1 → 0.",
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
      "NAND is an AND followed by a NOT. So AND is a NAND followed by another NOT — and you already know how to make a NOT from a NAND.",
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
      "By De Morgan's law, a OR b is the same as NOT((NOT a) AND (NOT b)) — which is NAND(NOT a, NOT b). Invert each input, then NAND them.",
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
      "The classic four-NAND XOR: let m = NAND(a, b), then y = NAND(NAND(a, m), NAND(b, m)). Work through it with a = b = 1 to see why the middle term matters.",
    funFact:
      "XOR is the heart of binary addition — a + b with no carry is exactly a XOR b. You'll reuse this gate in the half adder next.",
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
      "y = (d0 AND NOT sel) OR (d1 AND sel). One path is enabled and the other forced to 0, then the two are OR'd together.",
    funFact:
      "The multiplexer is how a CPU chooses between operands — 'the number from the instruction' versus 'the number from a register'. You'll wire dozens of them into the datapath later.",
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
      "sum is a XOR b (1 when the bits differ). carry is a AND b (1 only when both are 1, i.e. the result is 2).",
    funFact:
      "It's called 'half' because it can't accept a carry coming in from a lower column. Chain a second one and you get a full adder — the next challenge.",
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
      "sum is a XOR b XOR cin. carry-out is 1 when at least two of the three inputs are 1: (a AND b) OR (cin AND (a XOR b)).",
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
];

/** Look up a challenge by id, falling back to the sandbox. */
export function getChallenge(id: string): Challenge {
  return CHALLENGES.find((c) => c.id === id) ?? CHALLENGES[0];
}
