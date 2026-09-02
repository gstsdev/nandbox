// Turns a selection of components into a reusable block.
//
// The interface is auto-detected: any input port in the selection that nothing
// inside drives becomes a block input (ports fed by the same outside wire are
// merged into one); any output port that leaves the selection — or goes
// nowhere — becomes a block output. Ports are named in1.., out1.. in spatial
// order. The block keeps its full internal hierarchy (nested blocks stay
// nested); the flattener expands it at simulation time.

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

  const ordered = [...ids].sort((a, b) => {
    const A = doc.components[a];
    const B = doc.components[b];
    return A.y - B.y || A.x - B.x;
  });

  // A dangling input is a "chain tail" if the same-named port on another
  // selected instance of the same component type IS internally driven — i.e.
  // it's the loose end of a carry/enable chain. Chain tails are ordered after
  // the regular data inputs (so the ripple adder's cin lands last, not third).
  const drivenPortNamesByType = new Map<string, Set<string>>();
  for (const w of internalWires) {
    const type = doc.components[w.to.component]?.type;
    if (!type) continue;
    const set = drivenPortNamesByType.get(type) ?? new Set<string>();
    set.add(w.to.port);
    drivenPortNamesByType.set(type, set);
  }
  const isChainTail = (ref: PortRef): boolean => {
    const type = doc.components[ref.component]?.type ?? "";
    return drivenPortNamesByType.get(type)?.has(ref.port) ?? false;
  };

  // External inputs: dangling input ports, merged when fed by the same driver.
  type InGroup = { driver: PortRef | null; sinks: PortRef[]; tail: boolean };
  const inputGroups: InGroup[] = [];
  const groupIndexByDriver = new Map<string, number>();
  for (const cid of ordered) {
    const def = getComponentDef(doc.components[cid].type);
    if (!def) continue;
    for (const p of def.ports) {
      if (p.kind !== "in") continue;
      const ref: PortRef = { component: cid, port: p.name };
      if (drivenInputs.has(portKey(ref))) continue;
      const tail = isChainTail(ref);
      const feed = wires.find((w) => samePort(w.to, ref));
      if (feed && !idSet.has(feed.from.component)) {
        const dk = portKey(feed.from);
        const gi = groupIndexByDriver.get(dk);
        if (gi === undefined) {
          groupIndexByDriver.set(dk, inputGroups.length);
          inputGroups.push({ driver: feed.from, sinks: [ref], tail });
        } else {
          inputGroups[gi].sinks.push(ref);
          inputGroups[gi].tail = inputGroups[gi].tail && tail;
        }
      } else {
        inputGroups.push({ driver: null, sinks: [ref], tail });
      }
    }
  }
  // Regular inputs keep spatial order; chain tails go to the end.
  inputGroups.sort((a, b) => Number(a.tail) - Number(b.tail));

  // External outputs: output ports that leave the selection or go nowhere.
  const outputPorts: { source: PortRef; sinks: PortRef[] }[] = [];
  for (const cid of ordered) {
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
