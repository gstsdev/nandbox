// Composite components: a saved sub-circuit that behaves like a primitive.
//
// A composite's `sub` circuit keeps its full hierarchy — if you encapsulate a
// selection containing other blocks, those blocks stay as blocks inside it.
// The simulator's flattener (src/sim/flatten.ts) expands the tree recursively
// at simulation time, so "descend into a block" can always show the real
// nested structure.

import type { CircuitDoc, PortRef } from "./types";
import type { PortDef, PrimitiveDef } from "./primitives";
import { getPrimitive } from "./primitives";

export interface CompositeDef {
  type: string;
  title: string;
  category: "composite";
  width: number;
  height: number;
  /** Unused; the internal primitives carry the real propagation delays. */
  delay: number;
  ports: PortDef[];
  /** The internal circuit — may itself contain composite instances. */
  sub: CircuitDoc;
  /** External input port name -> the internal input port(s) it feeds. */
  inMap: Record<string, PortRef[]>;
  /** External output port name -> the internal output port it exposes. */
  outMap: Record<string, PortRef>;
}

export type AnyComponentDef = PrimitiveDef | CompositeDef;

export function isComposite(def: AnyComponentDef | undefined): def is CompositeDef {
  return def?.category === "composite";
}

const COMPOSITES = new Map<string, CompositeDef>();

/** Add a composite to the registry so it can be placed and simulated. */
export function registerComposite(def: CompositeDef): void {
  COMPOSITES.set(def.type, def);
}

export function getComposite(type: string): CompositeDef | undefined {
  return COMPOSITES.get(type);
}

/** All registered composites, for the palette's "Blocks" group. */
export function listComposites(): CompositeDef[] {
  return [...COMPOSITES.values()];
}

/** Drop all composites — used when loading a file, before registering its own. */
export function clearComposites(): void {
  COMPOSITES.clear();
}

/**
 * Look up any component definition — a built-in primitive or a registered
 * composite. Used everywhere that needs ports/size/title: the renderer,
 * geometry hit-testing, the store, and the flattener.
 */
export function getComponentDef(type: string): AnyComponentDef | undefined {
  return getPrimitive(type) ?? getComposite(type);
}
