// Primitive component definitions: ports, geometry, propagation delay, and a
// pure evaluation function. Composite/subcircuit components live in
// composite.ts.
//
// Every signal is a Bus (an array of bits, LSB first). A plain gate has
// width-1 ports and works on `bit()` of its inputs; bus components
// (splitters, mergers, wide IO) move bits between narrow and wide ports.

import type { Bus, Logic } from "../sim/values";
import { and, bit, busX, nand, nor, not, numToBus, or, xnor, xor } from "../sim/values";

export type PortKind = "in" | "out";

export interface PortDef {
  name: string;
  kind: PortKind;
  /** Offset from the component's top-left corner, in world units. */
  dx: number;
  dy: number;
  /** Bus width. Defaults to 1. */
  width?: number;
}

export interface PrimitiveDef {
  type: string;
  title: string;
  category: "io" | "gate" | "bus";
  width: number;
  height: number;
  ports: PortDef[];
  /** Propagation delay in simulation time units (clamped to >= 1 when scheduling). */
  delay: number;
  /**
   * Pure evaluation. `inputs` maps each input port name to its current bus
   * value (already coerced to the port's width); `state` is the instance's
   * mutable data. Returns output port bus values.
   */
  evaluate(
    inputs: Record<string, Bus>,
    state: Record<string, unknown> | undefined,
  ): Record<string, Bus>;
  /** Fresh state for a newly placed instance. */
  initialState?(): Record<string, unknown>;
  /** True when the output depends only on instance state (an input switch). */
  isSource?: boolean;
}

const GATE_W = 54;
const GATE_H = 38;
const IO_W = 34;
const IO_H = 28;

/** Build a standard 2-input, 1-output gate primitive (inputs `a`/`b` left, output `y` right). */
function gate2(
  type: string,
  title: string,
  fn: (a: Logic, b: Logic) => Logic,
): PrimitiveDef {
  return {
    type,
    title,
    category: "gate",
    width: GATE_W,
    height: GATE_H,
    delay: 1,
    ports: [
      { name: "a", kind: "in", dx: 0, dy: GATE_H * 0.28 },
      { name: "b", kind: "in", dx: 0, dy: GATE_H * 0.72 },
      { name: "y", kind: "out", dx: GATE_W, dy: GATE_H * 0.5 },
    ],
    evaluate: (i) => ({ y: [fn(bit(i.a), bit(i.b))] }),
  };
}

/** Splitter: one wide input bus fanned out to `n` single-bit outputs b0..b(n-1). */
function splitter(n: number): PrimitiveDef {
  const h = n * 12 + 8;
  return {
    type: `split${n}`,
    title: `÷${n}`,
    category: "bus",
    width: 30,
    height: h,
    delay: 1,
    ports: [
      { name: "bus", kind: "in", dx: 0, dy: h / 2, width: n },
      ...Array.from({ length: n }, (_, i) => ({
        name: `b${i}`,
        kind: "out" as const,
        dx: 30,
        dy: ((i + 1) * h) / (n + 1),
      })),
    ],
    evaluate: (i) => {
      const src = i.bus ?? busX(n);
      const out: Record<string, Bus> = {};
      for (let k = 0; k < n; k++) out[`b${k}`] = [src[k] ?? "x"];
      return out;
    },
  };
}

/** Merger: `n` single-bit inputs b0..b(n-1) combined into one wide output bus. */
function merger(n: number): PrimitiveDef {
  const h = n * 12 + 8;
  return {
    type: `merge${n}`,
    title: `×${n}`,
    category: "bus",
    width: 30,
    height: h,
    delay: 1,
    ports: [
      ...Array.from({ length: n }, (_, i) => ({
        name: `b${i}`,
        kind: "in" as const,
        dx: 0,
        dy: ((i + 1) * h) / (n + 1),
      })),
      { name: "bus", kind: "out", dx: 30, dy: h / 2, width: n },
    ],
    evaluate: (i) => ({ bus: Array.from({ length: n }, (_, k) => bit(i[`b${k}`])) }),
  };
}

/** Wide input: a column of `n` bit-cells the user clicks, driving an `n`-bit bus. */
function busInput(n: number): PrimitiveDef {
  const h = n * 12 + 8;
  return {
    type: `in${n}`,
    title: `IN${n}`,
    category: "io",
    width: 30,
    height: h,
    delay: 0,
    ports: [{ name: "out", kind: "out", dx: 30, dy: h / 2, width: n }],
    evaluate: (_i, state) => ({ out: numToBus((state?.value as number) ?? 0, n) }),
    initialState: () => ({ value: 0, width: n }),
    isSource: true,
  };
}

/** Wide output: shows the decimal value of an `n`-bit bus. */
function busOutput(n: number): PrimitiveDef {
  const h = n * 12 + 8;
  return {
    type: `out${n}`,
    title: `OUT${n}`,
    category: "io",
    width: 34,
    height: h,
    delay: 0,
    ports: [{ name: "in", kind: "in", dx: 0, dy: h / 2, width: n }],
    evaluate: () => ({}),
  };
}

const PRIMITIVE_LIST: PrimitiveDef[] = [
  {
    type: "input",
    title: "IN",
    category: "io",
    width: IO_W,
    height: IO_H,
    delay: 0,
    ports: [{ name: "out", kind: "out", dx: IO_W, dy: IO_H * 0.5 }],
    evaluate: (_i, state) => ({ out: [((state?.value as Logic | undefined) ?? 0)] }),
    initialState: () => ({ value: 0 }),
    isSource: true,
  },
  {
    type: "output",
    title: "OUT",
    category: "io",
    width: IO_W,
    height: IO_H,
    delay: 0,
    ports: [{ name: "in", kind: "in", dx: 0, dy: IO_H * 0.5 }],
    evaluate: () => ({}),
  },
  {
    type: "not",
    title: "NOT",
    category: "gate",
    width: 46,
    height: 32,
    delay: 1,
    ports: [
      { name: "a", kind: "in", dx: 0, dy: 16 },
      { name: "y", kind: "out", dx: 46, dy: 16 },
    ],
    evaluate: (i) => ({ y: [not(bit(i.a))] }),
  },
  gate2("nand", "NAND", nand),
  gate2("and", "AND", and),
  gate2("or", "OR", or),
  gate2("nor", "NOR", nor),
  gate2("xor", "XOR", xor),
  gate2("xnor", "XNOR", xnor),
  splitter(4),
  splitter(8),
  merger(4),
  merger(8),
  busInput(8),
  busOutput(8),
];

const REGISTRY: Record<string, PrimitiveDef> = Object.fromEntries(
  PRIMITIVE_LIST.map((p) => [p.type, p]),
);

/**
 * Look up a primitive definition by its type key. Returns undefined for
 * unknown types (e.g. a saved file referencing a component we no longer ship).
 * Used by the simulator, the renderer, and geometry hit-testing.
 */
export function getPrimitive(type: string): PrimitiveDef | undefined {
  return REGISTRY[type];
}

/** Every primitive, in palette order. Used to build the component palette UI. */
export function allPrimitives(): PrimitiveDef[] {
  return PRIMITIVE_LIST;
}

/** One port definition by type + port name, or undefined. Convenience over `getPrimitive`. */
export function portDef(type: string, name: string): PortDef | undefined {
  return getPrimitive(type)?.ports.find((p) => p.name === name);
}
