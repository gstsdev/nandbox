// Turns a selection of components into a reusable block.
//
// The interface is auto-detected: any input port in the selection that nothing
// inside drives becomes a block input (ports fed by the same outside wire are
// merged into one); any output port that leaves the selection — or goes
// nowhere — becomes a block output.
//
// Ports are ordered by the order the boundary wires were connected — the
// student controls port order by wiring order, and can adjust it afterward
// with the block's port controls. Ports left unwired at encapsulation time
// fall back to spatial order and come last.
//
// The block keeps its full internal hierarchy (nested blocks stay nested);
// the flattener expands it at simulation time.

import type { CircuitDoc, ComponentInstance, PortRef, Wire } from "../domain/types";
import { portKey, samePort } from "../domain/types";
import { getComponentDef } from "../domain/composite";
import type { CompositeDef } from "../domain/composite";
import type { PortDef } from "../domain/primitives";
import { snap } from "../canvas/geometry";

export interface EncapResult {
  def: CompositeDef;
  nextDoc: CircuitDoc;
  instanceId: string;
}

function slug(s: string): string {
  return (
    s
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "block"
  );
}

/**
 * Build a composite from `selectedIds` in `doc`. Returns the new block
 * definition plus the parent document with the selection replaced by one
 * instance and boundary wires re-routed, or null if the selection has no
 * usable components or no external ports.
 */
export function buildComposite(
  doc: CircuitDoc,
  selectedIds: string[],
  name: string,
): EncapResult | null {
  const ids = selectedIds.filter((id) => doc.components[id] && !doc.components[id].locked);
  if (ids.length === 0) return null;
  const idSet = new Set(ids);
  const wires = Object.values(doc.wires);

  const internalWires = wires.filter(
    (w) => idSet.has(w.from.component) && idSet.has(w.to.component),
  );
  const drivenInputs = new Set(internalWires.map((w) => portKey(w.to)));

  const spatial = (a: PortRef, b: PortRef): number => {
    const A = doc.components[a.component];
    const B = doc.components[b.component];
    return A.y - B.y || A.x - B.x;
  };

  // External inputs, in the order their wires were connected. A group is one
  // external port; sinks fed by the same outside driver merge into it.
  const inputGroups: { driver: PortRef | null; sinks: PortRef[] }[] = [];
  const groupIndexByDriver = new Map<string, number>();
  const claimedSinks = new Set<string>();
  for (const w of wires) {
    if (!idSet.has(w.to.component) || idSet.has(w.from.component)) continue;
    if (drivenInputs.has(portKey(w.to))) continue;
    const dk = portKey(w.from);
    const gi = groupIndexByDriver.get(dk);
    if (gi === undefined) {
      groupIndexByDriver.set(dk, inputGroups.length);
      inputGroups.push({ driver: w.from, sinks: [w.to] });
    } else {
      inputGroups[gi].sinks.push(w.to);
    }
    claimedSinks.add(portKey(w.to));
  }
  // Unwired dangling inputs come last, in spatial order.
  const loose: PortRef[] = [];
  for (const cid of ids) {
    const def = getComponentDef(doc.components[cid].type);
    if (!def) continue;
    for (const p of def.ports) {
      if (p.kind !== "in") continue;
      const ref: PortRef = { component: cid, port: p.name };
      if (drivenInputs.has(portKey(ref)) || claimedSinks.has(portKey(ref))) continue;
      loose.push(ref);
    }
  }
  for (const ref of loose.sort(spatial)) inputGroups.push({ driver: null, sinks: [ref] });

  // External outputs, in the order their wires were connected; unwired outputs last.
  const outputPorts: { source: PortRef; sinks: PortRef[] }[] = [];
  const outIndexBySource = new Map<string, number>();
  for (const w of wires) {
    if (!idSet.has(w.from.component) || idSet.has(w.to.component)) continue;
    const sk = portKey(w.from);
    const oi = outIndexBySource.get(sk);
    if (oi === undefined) {
      outIndexBySource.set(sk, outputPorts.length);
      outputPorts.push({ source: w.from, sinks: [w.to] });
    } else {
      outputPorts[oi].sinks.push(w.to);
    }
  }
  const looseOut: PortRef[] = [];
  for (const cid of ids) {
    const def = getComponentDef(doc.components[cid].type);
    if (!def) continue;
    for (const p of def.ports) {
      if (p.kind !== "out") continue;
      const ref: PortRef = { component: cid, port: p.name };
      if (outIndexBySource.has(portKey(ref))) continue;
      if (wires.some((w) => samePort(w.from, ref))) continue; // drives only internal
      looseOut.push(ref);
    }
  }
  for (const ref of looseOut.sort(spatial)) outputPorts.push({ source: ref, sinks: [] });

  if (inputGroups.length === 0 && outputPorts.length === 0) return null;

  const inN = inputGroups.length;
  const outN = outputPorts.length;
  const width = 64;
  const height = Math.max(40, Math.max(inN, outN) * 14 + 12);
  const ports: PortDef[] = [];
  const inMap: Record<string, PortRef[]> = {};
  const outMap: Record<string, PortRef> = {};

  inputGroups.forEach((g, i) => {
    const nm = `in${i + 1}`;
    ports.push({ name: nm, kind: "in", dx: 0, dy: ((i + 1) * height) / (inN + 1) });
    inMap[nm] = g.sinks;
  });
  outputPorts.forEach((o, j) => {
    const nm = `out${j + 1}`;
    ports.push({ name: nm, kind: "out", dx: width, dy: ((j + 1) * height) / (outN + 1) });
    outMap[nm] = o.source;
  });

  // Internal document, positions normalised so a future block editor is sane.
  const minX = Math.min(...ids.map((id) => doc.components[id].x));
  const minY = Math.min(...ids.map((id) => doc.components[id].y));
  const subComponents: Record<string, ComponentInstance> = {};
  for (const id of ids) {
    const c = doc.components[id];
    subComponents[id] = { ...c, x: c.x - minX + 20, y: c.y - minY + 20 };
  }
  const subWires: Record<string, Wire> = {};
  for (const w of internalWires) subWires[w.id] = w;

  const def: CompositeDef = {
    type: `user:${slug(name)}:${Math.random().toString(36).slice(2, 7)}`,
    title: name,
    category: "composite",
    width,
    height,
    delay: 0,
    ports,
    sub: {
      id: crypto.randomUUID(),
      name,
      components: subComponents,
      wires: subWires,
    },
    inMap,
    outMap,
  };

  // Parent document: drop the selection, add one instance, re-route boundary wires.
  const xs = ids.map((id) => doc.components[id].x);
  const ys = ids.map((id) => doc.components[id].y);
  const instX = snap((Math.min(...xs) + Math.max(...xs)) / 2);
  const instY = snap((Math.min(...ys) + Math.max(...ys)) / 2);
  const instanceId = crypto.randomUUID();

  const components: Record<string, ComponentInstance> = {};
  for (const [id, c] of Object.entries(doc.components)) {
    if (!idSet.has(id)) components[id] = c;
  }
  components[instanceId] = { id: instanceId, type: def.type, x: instX, y: instY };

  const nextWires: Record<string, Wire> = {};
  for (const [wid, w] of Object.entries(doc.wires)) {
    if (idSet.has(w.from.component) || idSet.has(w.to.component)) continue;
    nextWires[wid] = w;
  }
  inputGroups.forEach((g, i) => {
    if (!g.driver) return;
    const id = crypto.randomUUID();
    nextWires[id] = { id, from: g.driver, to: { component: instanceId, port: `in${i + 1}` } };
  });
  outputPorts.forEach((o, j) => {
    for (const sink of o.sinks) {
      const id = crypto.randomUUID();
      nextWires[id] = {
        id,
        from: { component: instanceId, port: `out${j + 1}` },
        to: sink,
      };
    }
  });

  return {
    def,
    nextDoc: { ...doc, components, wires: nextWires },
    instanceId,
  };
}
