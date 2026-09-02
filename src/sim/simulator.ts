// Event-driven gate simulator.
//
// The editor is hierarchical, but the simulator is not: callers pass a
// document that `flatten()` has already reduced to primitive components only.
// Each output port carries a current bus value (a length-1 bus for a plain
// wire). Evaluating a node reads its input buses (following wires to their
// driver, coerced to the port's width), computes new outputs, and — for any
// output that changed — schedules the downstream nodes to re-evaluate after
// this node's propagation delay.
//
// "Settling" runs the queue until it empties. If it does not empty within
// `maxSteps`, the circuit is oscillating and is reported as unsettled.

import type { CircuitDoc, ComponentId, PortRef } from "../domain/types";
import { getPrimitive } from "../domain/primitives";
import type { Bus } from "./values";
import { busEqual, busX, coerceWidth } from "./values";
import { EventQueue } from "./eventQueue";

interface Source {
  comp: ComponentId;
  port: string;
}

interface SimNode {
  id: ComponentId;
  type: string;
  delay: number;
  state: Record<string, unknown> | undefined;
  inputPorts: string[];
  outputPorts: string[];
  /** Declared bus width per port (input and output), defaulting to 1. */
  widths: Record<string, number>;
  /** For each input port: the driving output port, or null if unconnected. */
  inputSource: Record<string, Source | null>;
  /** Current bus value on each output port. */
  out: Record<string, Bus>;
}

export interface SettleResult {
  settled: boolean;
  steps: number;
  time: number;
}

export class Simulator {
  private nodes = new Map<ComponentId, SimNode>();
  /** "comp:outPort" -> component ids that read it. */
  private downstream = new Map<string, ComponentId[]>();
  private queue = new EventQueue();
  private now = 0;
  maxSteps = 200_000;

  constructor(doc: CircuitDoc) {
    this.build(doc);
  }

  /**
   * One-time translation of the document into the flat node graph:
   * a SimNode per primitive component, each input port linked to its single
   * driving output port, and a reverse "who reads this output" index for
   * fast fan-out during evaluation. Unknown component types are skipped.
   */
  private build(doc: CircuitDoc): void {
    for (const c of Object.values(doc.components)) {
      const def = getPrimitive(c.type);
      if (!def) continue;
      const inputPorts = def.ports.filter((p) => p.kind === "in").map((p) => p.name);
      const outputPorts = def.ports.filter((p) => p.kind === "out").map((p) => p.name);
      const widths: Record<string, number> = {};
      for (const p of def.ports) widths[p.name] = p.width ?? 1;
      const out: Record<string, Bus> = {};
      for (const p of outputPorts) out[p] = busX(widths[p]);
      const inputSource: Record<string, Source | null> = {};
      for (const p of inputPorts) inputSource[p] = null;
      this.nodes.set(c.id, {
        id: c.id,
        type: c.type,
        delay: def.delay,
        state: c.state,
        inputPorts,
        outputPorts,
        widths,
        inputSource,
        out,
      });
    }

    for (const w of Object.values(doc.wires)) {
      const src = this.nodes.get(w.from.component);
      const dst = this.nodes.get(w.to.component);
      if (!src || !dst) continue;
      if (!(w.to.port in dst.inputSource)) continue;
      if (!(w.from.port in src.out)) continue;
      dst.inputSource[w.to.port] = { comp: w.from.component, port: w.from.port };
      const key = `${w.from.component}:${w.from.port}`;
      const list = this.downstream.get(key);
      if (list) list.push(w.to.component);
      else this.downstream.set(key, [w.to.component]);
    }
  }

  /**
   * Set every output back to X, queue every node for evaluation at time 0, and
   * settle. Called by the store right after (re)building the simulator so the
   * canvas shows correct values immediately.
   */
  reset(): SettleResult {
    this.queue.clear();
    this.now = 0;
    for (const node of this.nodes.values()) {
      for (const p of node.outputPorts) node.out[p] = busX(node.widths[p]);
      this.queue.push(0, node.id);
    }
    return this.settle();
  }

  /**
   * Replace one node's mutable state (e.g. after the user toggles an input
   * switch), re-evaluate just that node, and settle the ripple. Lets the store
   * update a running circuit without rebuilding the whole simulator.
   */
  pokeState(id: ComponentId, state: Record<string, unknown>): SettleResult {
    const node = this.nodes.get(id);
    if (!node) return { settled: true, steps: 0, time: this.now };
    node.state = state;
    this.queue.push(this.now, id);
    return this.settle();
  }

  /**
   * Drain the event queue: pop the earliest event, evaluate that node, and
   * enqueue anything its changed outputs affect — repeat until quiet. If it
   * runs past `maxSteps` the circuit is oscillating; returns `settled: false`
   * so the UI can flag it instead of hanging.
   */
  settle(): SettleResult {
    let steps = 0;
    while (this.queue.size > 0) {
      if (steps >= this.maxSteps) {
        return { settled: false, steps, time: this.now };
      }
      const ev = this.queue.pop() as { time: number; componentId: string };
      this.now = ev.time;
      steps++;
      this.evaluateNode(ev.componentId, ev.time);
    }
    return { settled: true, steps, time: this.now };
  }

  /**
   * Recompute one node: read its input buses, run the primitive's `evaluate`,
   * and for every output that actually changed, schedule its readers to run
   * again after this node's propagation delay (min 1 tick, so time always
   * advances and loops can't stall the clock).
   */
  private evaluateNode(id: ComponentId, time: number): void {
    const node = this.nodes.get(id);
    if (!node) return;
    const def = getPrimitive(node.type);
    if (!def) return;

    const inputs: Record<string, Bus> = {};
    for (const p of node.inputPorts) {
      inputs[p] = coerceWidth(this.readSource(node.inputSource[p]), node.widths[p]);
    }

    const result = def.evaluate(inputs, node.state);
    const scheduleAt = time + Math.max(1, node.delay);
    for (const p of node.outputPorts) {
      const next = coerceWidth(result[p] ?? busX(node.widths[p]), node.widths[p]);
      if (!busEqual(next, node.out[p])) {
        node.out[p] = next;
        const readers = this.downstream.get(`${id}:${p}`);
        if (readers) {
          for (const r of readers) this.queue.push(scheduleAt, r);
        }
      }
    }
  }

  private readSource(src: Source | null): Bus {
    if (!src) return busX(1);
    const node = this.nodes.get(src.comp);
    return node?.out[src.port] ?? busX(1);
  }

  /** Current bus on an output port. Called by the renderer to colour wires and pins. */
  outputValue(ref: PortRef): Bus {
    const node = this.nodes.get(ref.component);
    return node?.out[ref.port] ?? busX(1);
  }

  /**
   * Bus seen at an input port — follows its wire back to the driving output,
   * or all-X if unconnected. Used by the renderer for input pins and OUTPUTs.
   */
  inputValue(ref: PortRef): Bus {
    const node = this.nodes.get(ref.component);
    if (!node) return busX(1);
    return coerceWidth(
      this.readSource(node.inputSource[ref.port] ?? null),
      node.widths[ref.port] ?? 1,
    );
  }
}
