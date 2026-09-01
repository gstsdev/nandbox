// Three-valued logic: 0, 1, and X (unknown / uninitialized / conflicting).
// Every wire in the simulator carries one of these. Z (high-impedance) is
// intentionally not modelled yet — it arrives with tri-state buses later.
//
// The rule for X: an output is only 0 or 1 when the inputs *force* it; if the
// result would depend on an unknown input, it stays X. So `0 AND x` is 0
// (the 0 alone decides it) but `1 AND x` is X. That is why these aren't just
// the built-in boolean operators.

export type Logic = 0 | 1 | "x";

export function and(a: Logic, b: Logic): Logic {
  if (a === 0 || b === 0) return 0;
  if (a === 1 && b === 1) return 1;
  return "x";
}

export function or(a: Logic, b: Logic): Logic {
  if (a === 1 || b === 1) return 1;
  if (a === 0 && b === 0) return 0;
  return "x";
}

export function not(a: Logic): Logic {
  if (a === 0) return 1;
  if (a === 1) return 0;
  return "x";
}

export function xor(a: Logic, b: Logic): Logic {
  if (a === "x" || b === "x") return "x";
  return a === b ? 0 : 1;
}

export function nand(a: Logic, b: Logic): Logic {
  return not(and(a, b));
}

export function nor(a: Logic, b: Logic): Logic {
  return not(or(a, b));
}

export function xnor(a: Logic, b: Logic): Logic {
  return not(xor(a, b));
}

export function logicLabel(v: Logic): string {
  return v === "x" ? "X" : String(v);
}
