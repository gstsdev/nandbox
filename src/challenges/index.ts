// The curriculum. Each challenge is a short lesson plus (later) an automatic
// verifier. Phase P0 ships the lesson content and the panel that shows it;
// gating and verification come in P1.

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
  /** Plain description of what the verifier will check. */
  checks: string;
}

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
  },
  {
    id: "not-from-nand",
    index: 1,
    title: "NOT from NAND",
    goal:
      "Build an inverter using only a NAND gate. Output should be the opposite of the input.",
    howItWorks:
      "A NAND gate outputs 0 only when both inputs are 1. Tie both of its inputs to the same signal and it becomes a NOT: 0 → 1, 1 → 0.",
    funFact:
      "This trick — feeding one signal into both inputs of a NAND — is the first step in the classic 'build a computer from NAND' progression.",
    checks:
      "For input 0 the output must be 1, and for input 1 the output must be 0. Both cases are tested.",
  },
  {
    id: "and-from-nand",
    index: 2,
    title: "AND from NAND",
    goal: "Build a 2-input AND gate from NAND gates only.",
    howItWorks:
      "NAND is AND followed by NOT. So AND is NAND followed by another NOT — and you already know how to make a NOT from a NAND.",
    funFact:
      "AND from NAND costs two gates. Early NMOS chips counted every transistor, so designers often restructured logic to avoid the extra inverter.",
    checks: "All four input combinations (00, 01, 10, 11) are checked against the AND truth table.",
  },
];

/** Look up a challenge by id, falling back to the sandbox. Used by the briefing panel. */
export function getChallenge(id: string): Challenge {
  return CHALLENGES.find((c) => c.id === id) ?? CHALLENGES[0];
}
