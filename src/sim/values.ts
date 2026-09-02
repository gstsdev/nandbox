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

// --- Buses -----------------------------------------------------------------
// A bus is an array of bits, least-significant first (bit i has weight 2^i).
// Single-bit signals are just a length-1 bus, so the whole simulator speaks
// one type.

export type Bus = Logic[];

/** The low bit of a bus (or the value itself if it's already a bare Logic). */
export function bit(b: Bus | Logic): Logic {
  return Array.isArray(b) ? b[0] ?? "x" : b;
}

/** A width-`n` bus of all-unknown bits. */
export function busX(n: number): Bus {
  return Array.from({ length: Math.max(1, n) }, () => "x" as Logic);
}

/** Encode a number as a width-`n` bus (LSB first). Negatives wrap two's-complement. */
export function numToBus(value: number, n: number): Bus {
  return Array.from({ length: n }, (_, i) => ((value >> i) & 1) as Logic);
}

/** Decode a bus to an unsigned number, or null if any bit is X. */
export function busToNum(b: Bus): number | null {
  let n = 0;
  for (let i = 0; i < b.length; i++) {
    if (b[i] === "x") return null;
    if (b[i] === 1) n += 2 ** i;
  }
  return n;
}

export function busEqual(a: Bus, b: Bus): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

/** Force a bus to width `n`, truncating extra bits or padding with X. */
export function coerceWidth(b: Bus, n: number): Bus {
  if (b.length === n) return b;
  const out = b.slice(0, n);
  while (out.length < n) out.push("x");
  return out;
}

/** The shared value if every bit is identical, else null. Used for wire colour. */
export function busUniform(b: Bus): Logic | null {
  const first = b[0] ?? "x";
  return b.every((v) => v === first) ? first : null;
}

/** Display form: "0"/"1"/"X" for one bit, the decimal value (or "X") for wider. */
export function busLabel(b: Bus): string {
  if (b.length <= 1) return logicLabel(bit(b));
  const n = busToNum(b);
  return n === null ? "X" : String(n);
}
