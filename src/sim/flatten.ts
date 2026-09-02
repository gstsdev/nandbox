// Expands a document with composite blocks into a primitives-only document
// the event-driven simulator can run. Composites are expanded recursively:
// every instance path becomes an id prefix, and wires that cross a block's
// boundary are re-routed straight to the primitive ports inside.
//
// Called by the store (and the verifier) before constructing a Simulator.

import type { CircuitDoc, ComponentInstance, PortRef, Wire } from "../domain/types";
import { getComponentDef, isComposite } from "../domain/composite";

export interface FlatResult {
  /** Primitives-only circuit, ready for `new Simulator(...)`. */
  flat: CircuitDoc;
  /**
   * "instanceId:externalPort" -> the flat internal port carrying that signal.
   * Lets the renderer read values at a top-level block's boundary.
   */
  alias: Map<string, PortRef>;
}

/** Follow an output ref through any blocks to the primitive output that drives it. */
function resolveOut(doc: CircuitDoc, ref: PortRef, prefix: string): PortRef {
  const def = getComponentDef(doc.components[ref.component]?.type ?? "");
  if (isComposite(def)) {
    const internal = def.outMap[ref.port];
    if (internal) return resolveOut(def.sub, internal, `${prefix}${ref.component}/`);
  }
  return { component: `${prefix}${ref.component}`, port: ref.port };
}

/** Follow an input ref through any blocks to the primitive input(s) it feeds. */
function resolveIn(doc: CircuitDoc, ref: PortRef, prefix: string): PortRef[] {
  const def = getComponentDef(doc.components[ref.component]?.type ?? "");
  if (isComposite(def)) {
    const internals = def.inMap[ref.port] ?? [];
    return internals.flatMap((t) => resolveIn(def.sub, t, `${prefix}${ref.component}/`));
  }
  return [{ component: `${prefix}${ref.component}`, port: ref.port }];
}

/** Expand `doc` (and every block inside it, recursively) into primitives + wires. */
export function flatten(doc: CircuitDoc): FlatResult {
  const components: Record<string, ComponentInstance> = {};
  const wires: Record<string, Wire> = {};
  let seq = 0;

  function walk(sub: CircuitDoc, prefix: string): void {
    for (const c of Object.values(sub.components)) {
      const def = getComponentDef(c.type);
      if (isComposite(def)) {
        walk(def.sub, `${prefix}${c.id}/`);
      } else {
        const id = `${prefix}${c.id}`;
        components[id] = { ...c, id };
      }
    }
    for (const w of Object.values(sub.wires)) {
      const from = resolveOut(sub, w.from, prefix);
      for (const to of resolveIn(sub, w.to, prefix)) {
        const id = `fw${seq++}`;
        wires[id] = { id, from, to };
      }
    }
  }
  walk(doc, "");

  const alias = new Map<string, PortRef>();
  for (const c of Object.values(doc.components)) {
    const def = getComponentDef(c.type);
    if (!isComposite(def)) continue;
    for (const ext of Object.keys(def.inMap)) {
      const [first] = resolveIn(doc, { component: c.id, port: ext }, "");
      if (first) alias.set(`${c.id}:${ext}`, first);
    }
    for (const ext of Object.keys(def.outMap)) {
      alias.set(`${c.id}:${ext}`, resolveOut(doc, { component: c.id, port: ext }, ""));
    }
  }

  return { flat: { ...doc, components, wires }, alias };
}
