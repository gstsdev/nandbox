// Primitive component definitions: ports, geometry, propagation delay, and a
// pure evaluation function. Composite/subcircuit components come in a later
// phase; for now the palette is primitives only.

import type { Logic } from "../sim/values";
import { and, nand, nor, not, or, xnor, xor } from "../sim/values";

export type PortKind = "in" | "out";

export interface PortDef {
  name: string;
  kind: PortKind;
  /** Offset from the component's top-left corner, in world units. */
  dx: number;
  dy: number;
}

export interface PrimitiveDef {
  type: string;
  title: string;
  category: "io" | "gate";
  width: number;
  height: number;
  ports: PortDef[];
  /** Propagation delay in simulation time units (clamped to >= 1 when scheduling). */
  delay: number;
  /**
   * Pure evaluation. `inputs` maps each input port name to its current value;
   * `state` is the instance's mutable data. Returns output port values.
   */
  evaluate(
    inputs: Record<string, Logic>,
    state: Record<string, unknown> | undefined,
  ): Record<string, Logic>;
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
    evaluate: (i) => ({ y: fn(i.a ?? "x", i.b ?? "x") }),
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
    evaluate: (_i, state) => ({ out: ((state?.value as Logic | undefined) ?? 0) }),
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
    evaluate: (i) => ({ y: not(i.a ?? "x") }),
  },
  gate2("nand", "NAND", nand),
  gate2("and", "AND", and),
  gate2("or", "OR", or),
  gate2("nor", "NOR", nor),
  gate2("xor", "XOR", xor),
  gate2("xnor", "XNOR", xnor),
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
