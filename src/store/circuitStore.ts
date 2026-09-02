// The single source of truth for the editor: the document, the camera, the
// current selection, the in-progress interaction (armed placement / wire
// draft), and the live simulator.
//
// It lives in a Zustand store rather than React state so the canvas render
// loop can read it every frame via `getState()` without causing React
// re-renders; the surrounding UI subscribes with selectors as normal.
//
// Simulation policy for now: any change that affects behaviour rebuilds the
// simulator from scratch and re-settles. At this scale that is instant and
// obviously correct; incremental updates are a later optimisation.

import { create } from "zustand";
import type { CircuitDoc, CircuitFile, ComponentId, PortRef, Wire } from "../domain/types";
import { DOC_FORMAT, samePort } from "../domain/types";
import type { CompositeDef } from "../domain/composite";
import {
  clearComposites,
  getComponentDef,
  getComposite,
  isComposite,
  registerComposite,
} from "../domain/composite";
import { Simulator } from "../sim/simulator";
import { flatten } from "../sim/flatten";
import type { Bus } from "../sim/values";
import type { Viewport } from "../canvas/geometry";
import { snap } from "../canvas/geometry";
import { buildStarterDoc, getChallenge } from "../challenges";
import type { VerifyResult } from "../challenges/verify";
import { verifyChallenge } from "../challenges/verify";
import { buildComposite } from "./encapsulate";

interface SimStatus {
  settled: boolean;
  steps: number;
}

/** Starting camera, also used by the toolbar's "Reset view". */
export const DEFAULT_VIEW: Viewport = { panX: 100, panY: 80, scale: 1.6 };

interface CircuitState {
  doc: CircuitDoc;
  view: Viewport;
  /** Component and wire ids currently selected. */
  selection: string[];
  /** Primitive type armed for placement (next canvas click drops one), or null. */
  pendingPlacement: string | null;
  /** Output port a wire is being dragged from, or null. */
  wireDraft: PortRef | null;
  sim: Simulator;
  /** Maps "instanceId:blockPort" to the flat internal port carrying its value. */
  signalAlias: Map<string, PortRef>;
  simStatus: SimStatus;
  activeChallengeId: string;
  /** Result of the last "Check", or null if not run since the circuit changed. */
  verifyResult: VerifyResult | null;
  /** Registered block types, in creation order — drives the palette's Blocks group. */
  blockTypes: string[];
  /** Bumped whenever a block definition changes (e.g. port reorder), for UI reactivity. */
  blockRevision: number;

  /** Read a port's bus value, following block boundaries. Used by the renderer. */
  readSignal: (ref: PortRef, kind: "in" | "out") => Bus;

  // --- placement / structure ---
  armPlacement: (type: string | null) => void;
  placeComponent: (worldX: number, worldY: number) => void;
  setComponentPosition: (id: ComponentId, x: number, y: number, snapToGrid?: boolean) => void;
  deleteSelection: () => void;
  /** Replace the current selection with a single reusable block named `name`. */
  encapsulate: (name: string) => void;
  /** Move one of a block's ports up (-1) or down (+1) among its same-kind ports. */
  moveBlockPort: (type: string, portName: string, dir: -1 | 1) => void;

  // --- wiring ---
  beginWire: (from: PortRef) => void;
  cancelWire: () => void;
  completeWire: (to: PortRef) => void;
  /** Delete every wire touching a port (either endpoint). For click-to-disconnect. */
  removeWiresAtPort: (ref: PortRef) => void;

  // --- simulation input ---
  toggleInput: (id: ComponentId) => void;
  /** Flip one bit of a wide input terminal (in8 etc.). */
  toggleInputBit: (id: ComponentId, bitIndex: number) => void;

  // --- view ---
  setView: (patch: Partial<Viewport>) => void;
  zoomAt: (screenX: number, screenY: number, factor: number) => void;

  // --- selection ---
  select: (ids: string[], additive?: boolean) => void;
  clearSelection: () => void;

  // --- document ---
  newDoc: () => void;
  loadFile: (file: CircuitFile) => void;
  exportFile: () => CircuitFile;

  // --- lesson ---
  setActiveChallenge: (id: string) => void;
  /** Run the active challenge's exhaustive truth-table check. */
  verify: () => void;
}

/**
 * Flatten any blocks, build a fresh simulator, settle it, and return the parts
 * of the store state that depend on the circuit. Spread into every `set` that
 * changes behaviour.
 */
function recompute(doc: CircuitDoc): {
  sim: Simulator;
  signalAlias: Map<string, PortRef>;
  simStatus: SimStatus;
} {
  const { flat, alias } = flatten(doc);
  const sim = new Simulator(flat);
  const result = sim.reset();
  return {
    sim,
    signalAlias: alias,
    simStatus: { settled: result.settled, steps: result.steps },
  };
}

/**
 * Every composite referenced by `doc`, transitively (a saved block's internals
 * may reference other blocks). Written into the file so blocks survive a reload.
 */
function usedComposites(doc: CircuitDoc): CompositeDef[] {
  const found = new Map<string, CompositeDef>();
  const visit = (d: CircuitDoc): void => {
    for (const c of Object.values(d.components)) {
      const def = getComposite(c.type);
      if (def && !found.has(def.type)) {
        found.set(def.type, def);
        visit(def.sub);
      }
    }
  };
  visit(doc);
  return [...found.values()];
}

const initialDoc = buildStarterDoc(getChallenge("sandbox"));

export const useCircuitStore = create<CircuitState>((set, get) => ({
  doc: initialDoc,
  view: { ...DEFAULT_VIEW },
  selection: [],
  pendingPlacement: null,
  wireDraft: null,
  ...recompute(initialDoc),
  activeChallengeId: "sandbox",
  verifyResult: null,
  blockTypes: [],
  blockRevision: 0,

  readSignal: (ref, kind) => {
    const { sim, signalAlias } = get();
    const flatRef = signalAlias.get(`${ref.component}:${ref.port}`) ?? ref;
    return kind === "out" ? sim.outputValue(flatRef) : sim.inputValue(flatRef);
  },

  armPlacement: (type) => set({ pendingPlacement: type, wireDraft: null }),

  /**
   * Drop an instance of the armed primitive centred on the given world point.
   * Clears the armed placement (hold-to-repeat can be added later) and rebuilds
   * the simulator so the new component evaluates immediately.
   */
  placeComponent: (worldX, worldY) => {
    const { pendingPlacement, doc } = get();
    if (!pendingPlacement) return;
    const def = getComponentDef(pendingPlacement);
    if (!def) return;
    const id = crypto.randomUUID();
    const inst = {
      id,
      type: pendingPlacement,
      x: snap(worldX - def.width / 2),
      y: snap(worldY - def.height / 2),
      state: isComposite(def) ? undefined : def.initialState?.(),
    };
    const nextDoc: CircuitDoc = {
      ...doc,
      components: { ...doc.components, [id]: inst },
    };
    set({
      doc: nextDoc,
      pendingPlacement: null,
      selection: [id],
      verifyResult: null,
      ...recompute(nextDoc),
    });
  },

  /**
   * Move a component. During a drag `snapToGrid` is false for smooth motion;
   * pass true on drop. Position changes don't affect behaviour, so the
   * simulator is left alone.
   */
  setComponentPosition: (id, x, y, snapToGrid = false) => {
    const { doc } = get();
    const inst = doc.components[id];
    if (!inst) return;
    set({
      doc: {
        ...doc,
        components: {
          ...doc.components,
          [id]: { ...inst, x: snapToGrid ? snap(x) : x, y: snapToGrid ? snap(y) : y },
        },
      },
    });
  },

  /**
   * Remove every selected component and wire, plus any wire left dangling
   * because a component it touched was removed. Rebuilds the simulator.
   */
  deleteSelection: () => {
    const { doc, selection } = get();
    if (selection.length === 0) return;
    const sel = new Set(selection);
    const components = { ...doc.components };
    for (const id of selection) {
      if (!components[id]?.locked) delete components[id];
    }
    const wires: Record<string, Wire> = {};
    for (const [wid, w] of Object.entries(doc.wires)) {
      if (sel.has(wid)) continue;
      if (!components[w.from.component] || !components[w.to.component]) continue;
      wires[wid] = w;
    }
    const nextDoc = { ...doc, components, wires };
    set({ doc: nextDoc, selection: [], verifyResult: null, ...recompute(nextDoc) });
  },

  /**
   * Bundle the selected components into one reusable block, register it so it
   * appears in the palette, and swap the selection for a single instance with
   * boundary wires re-routed.
   */
  encapsulate: (name) => {
    const { doc, selection } = get();
    const result = buildComposite(doc, selection, name);
    if (!result) return;
    registerComposite(result.def);
    set({
      doc: result.nextDoc,
      selection: [result.instanceId],
      verifyResult: null,
      blockTypes: [...get().blockTypes, result.def.type],
      blockRevision: get().blockRevision + 1,
      ...recompute(result.nextDoc),
    });
  },

  /**
   * Move one of a block's ports up (-1) or down (+1) among its same-kind
   * siblings. Port names are identities and don't change — only their order in
   * the list and the vertical position of the pin — so no wires or port maps
   * need rewriting and the circuit's behaviour is untouched.
   */
  moveBlockPort: (type, portName, dir) => {
    const def = getComposite(type);
    const kind = def?.ports.find((p) => p.name === portName)?.kind;
    if (!def || !kind) return;

    const sameKind = def.ports.filter((p) => p.kind === kind);
    const from = sameKind.findIndex((p) => p.name === portName);
    const to = from + dir;
    if (to < 0 || to >= sameKind.length) return;
    [sameKind[from], sameKind[to]] = [sameKind[to], sameKind[from]];

    // Re-space the pins of this side; the other side is unchanged.
    const n = sameKind.length;
    const repositioned = sameKind.map((p, i) => ({
      ...p,
      dy: ((i + 1) * def.height) / (n + 1),
    }));
    const others = def.ports.filter((p) => p.kind !== kind);

    registerComposite({
      ...def,
      ports: kind === "in" ? [...repositioned, ...others] : [...others, ...repositioned],
    });
    set({ blockRevision: get().blockRevision + 1 });
  },

  beginWire: (from) => set({ wireDraft: from, pendingPlacement: null }),
  cancelWire: () => set({ wireDraft: null }),

  removeWiresAtPort: (ref) => {
    const { doc } = get();
    const wires: Record<string, Wire> = {};
    let removed = 0;
    for (const [wid, w] of Object.entries(doc.wires)) {
      if (samePort(w.from, ref) || samePort(w.to, ref)) {
        removed++;
        continue;
      }
      wires[wid] = w;
    }
    if (removed === 0) return;
    const nextDoc = { ...doc, wires };
    set({ doc: nextDoc, verifyResult: null, ...recompute(nextDoc) });
  },

  /**
   * Finish the wire started by `beginWire`. Normalises direction (always
   * output → input), rejects same-kind and no-op connections, and enforces one
   * driver per input by dropping any existing wire into that port. Rebuilds
   * the simulator.
   */
  completeWire: (to) => {
    const { doc, wireDraft } = get();
    if (!wireDraft) return;
    set({ wireDraft: null });
    if (samePort(wireDraft, to)) return;

    const kindOf = (r: PortRef) =>
      getComponentDef(doc.components[r.component]?.type ?? "")?.ports.find(
        (p) => p.name === r.port,
      )?.kind;

    const k1 = kindOf(wireDraft);
    const k2 = kindOf(to);
    if (!k1 || !k2 || k1 === k2) return;

    const from = k1 === "out" ? wireDraft : to;
    const dest = k1 === "out" ? to : wireDraft;

    const wires: Record<string, Wire> = {};
    for (const [wid, w] of Object.entries(doc.wires)) {
      if (samePort(w.to, dest)) continue; // one driver per input port
      wires[wid] = w;
    }
    const id = crypto.randomUUID();
    wires[id] = { id, from, to: dest };
    const nextDoc = { ...doc, wires };
    set({ doc: nextDoc, verifyResult: null, ...recompute(nextDoc) });
  },

  /**
   * Flip an input switch between 0 and 1 and re-settle. Updates the document
   * (so the value persists on save) and rebuilds the simulator.
   */
  toggleInput: (id) => {
    const { doc } = get();
    const inst = doc.components[id];
    if (!inst || inst.type !== "input") return;
    const value = inst.state?.value === 1 ? 0 : 1;
    const nextDoc: CircuitDoc = {
      ...doc,
      components: {
        ...doc.components,
        [id]: { ...inst, state: { ...inst.state, value } },
      },
    };
    set({ doc: nextDoc, ...recompute(nextDoc) });
  },

  toggleInputBit: (id, bitIndex) => {
    const { doc } = get();
    const inst = doc.components[id];
    if (!inst) return;
    const cur = (inst.state?.value as number) ?? 0;
    const value = cur ^ (1 << bitIndex);
    const nextDoc: CircuitDoc = {
      ...doc,
      components: {
        ...doc.components,
        [id]: { ...inst, state: { ...inst.state, value } },
      },
    };
    set({ doc: nextDoc, ...recompute(nextDoc) });
  },

  setView: (patch) => set((s) => ({ view: { ...s.view, ...patch } })),

  /** Zoom toward a screen point, keeping the world point under the cursor fixed. */
  zoomAt: (screenX, screenY, factor) => {
    const { view } = get();
    const scale = Math.min(6, Math.max(0.4, view.scale * factor));
    const k = scale / view.scale;
    set({
      view: {
        scale,
        panX: screenX - (screenX - view.panX) * k,
        panY: screenY - (screenY - view.panY) * k,
      },
    });
  },

  select: (ids, additive = false) =>
    set((s) => ({
      selection: additive ? [...new Set([...s.selection, ...ids])] : ids,
    })),
  clearSelection: () => set({ selection: [] }),

  /** Reset the current challenge's canvas back to just its IO terminals. */
  newDoc: () => {
    const doc = buildStarterDoc(getChallenge(get().activeChallengeId));
    set({
      doc,
      selection: [],
      wireDraft: null,
      pendingPlacement: null,
      verifyResult: null,
      ...recompute(doc),
    });
  },

  /** Load a saved file: register its blocks first, then swap in its document. */
  loadFile: (file) => {
    clearComposites();
    const composites = file.composites ?? [];
    for (const c of composites) registerComposite(c);
    const doc = file.doc;
    set({
      doc,
      selection: [],
      wireDraft: null,
      pendingPlacement: null,
      verifyResult: null,
      blockTypes: composites.map((c) => c.type),
      blockRevision: get().blockRevision + 1,
      ...recompute(doc),
    });
  },

  exportFile: () => ({
    format: DOC_FORMAT,
    doc: get().doc,
    composites: usedComposites(get().doc),
  }),

  /** Switch challenges: load the new one's starter canvas and reset the view. */
  setActiveChallenge: (id) => {
    const ch = getChallenge(id);
    const doc = buildStarterDoc(ch);
    set({
      activeChallengeId: ch.id,
      doc,
      selection: [],
      wireDraft: null,
      pendingPlacement: null,
      verifyResult: null,
      view: { ...DEFAULT_VIEW },
      ...recompute(doc),
    });
  },

  verify: () => {
    const { doc, activeChallengeId } = get();
    set({ verifyResult: verifyChallenge(doc, getChallenge(activeChallengeId)) });
  },
}));
