// Turns a selection of components into a reusable block.
//
// The interface is auto-detected: any input port in the selection that nothing
// inside drives becomes a block input (ports fed by the same outside wire are
// merged into one); any output port that leaves the selection — or goes
// nowhere — becomes a block output.
//
// Ports are ordered the way you'd read the schematic: top to bottom, then
// left to right, by each port's actual pin position. A merged input's
// position is the topmost (then leftmost) of its sinks. This is a default
// guess derived straight from the diagram — not a promise — and the block's
// port controls let you rename or reorder freely afterward.
//
// The block keeps its full internal hierarchy (nested blocks stay nested);
// the flattener expands it at simulation time.

import type { CircuitDoc, ComponentInstance, PortRef, Wire } from "../domain/types";
import { portKey, samePort } from "../domain/types";
import { getComponentDef } from "../domain/composite";
import type { CompositeDef } from "../domain/composite";
import type { PortDef } from "../domain/primitives";
import { snap } from "../canvas/geometry";

interface Pos {
  x: number;
  y: number;
}

/** Absolute world position of a port's pin: its component's origin plus the port's local offset. */
function pinPos(doc: CircuitDoc, ref: PortRef): Pos {
  const c = doc.components[ref.component];
  const p = getComponentDef(c?.type ?? "")?.ports.find((pp) => pp.name === ref.port);
  return { x: (c?.x ?? 0) + (p?.dx ?? 0), y: (c?.y ?? 0) + (p?.dy ?? 0) };
}

/** Reading order: top first, then left. */
function readingOrder(a: Pos, b: Pos): number {
  return a.y - b.y || a.x - b.x;
}

/** The topmost-then-leftmost position among a set of port refs. */
function topmost(doc: CircuitDoc, refs: PortRef[]): Pos {
  return refs.map((r) => pinPos(doc, r)).reduce((best, p) => (readingOrder(p, best) < 0 ? p : best));
}

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

  // External inputs: one group per dangling input port, merged when several
  // share the same outside driver.
  const inputGroups: { driver: PortRef | null; sinks: PortRef[] }[] = [];
  const groupIndexByDriver = new Map<string, number>();
  for (const cid of ids) {
    const def = getComponentDef(doc.components[cid].type);
    if (!def) continue;
    for (const p of def.ports) {
      if (p.kind !== "in") continue;
      const ref: PortRef = { component: cid, port: p.name };
      if (drivenInputs.has(portKey(ref))) continue;
      const feed = wires.find((w) => samePort(w.to, ref));
      if (feed && !idSet.has(feed.from.component)) {
        const dk = portKey(feed.from);
        const gi = groupIndexByDriver.get(dk);
        if (gi === undefined) {
          groupIndexByDriver.set(dk, inputGroups.length);
          inputGroups.push({ driver: feed.from, sinks: [ref] });
        } else {
          inputGroups[gi].sinks.push(ref);
        }
      } else {
        inputGroups.push({ driver: null, sinks: [ref] });
      }
    }
  }
  // Reading order: top to bottom, then left to right. A merged group sorts by
  // its topmost sink, so a driver feeding a gate near the top of the
  // selection reads there even if it also feeds a copy further down.
  inputGroups.sort((a, b) => readingOrder(topmost(doc, a.sinks), topmost(doc, b.sinks)));

  // External outputs: a port that leaves the selection, or drives nothing.
  const outputPorts: { source: PortRef; sinks: PortRef[] }[] = [];
  for (const cid of ids) {
    const def = getComponentDef(doc.components[cid].type);
    if (!def) continue;
    for (const p of def.ports) {
      if (p.kind !== "out") continue;
      const ref: PortRef = { component: cid, port: p.name };
      const from = wires.filter((w) => samePort(w.from, ref));
      const outside = from.filter((w) => !idSet.has(w.to.component)).map((w) => w.to);
      if (outside.length > 0 || from.length === 0) {
        outputPorts.push({ source: ref, sinks: outside });
      }
    }
  }
  outputPorts.sort((a, b) => readingOrder(pinPos(doc, a.source), pinPos(doc, b.source)));

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
