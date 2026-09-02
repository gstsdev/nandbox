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
import type {
  CircuitDoc,
  CircuitFile,
  ComponentId,
  PortRef,
  Wire,
} from "../domain/types";
import { DOC_FORMAT, samePort } from "../domain/types";
import { getPrimitive } from "../domain/primitives";
import { Simulator } from "../sim/simulator";
import type { Viewport } from "../canvas/geometry";
import { snap } from "../canvas/geometry";
import { buildStarterDoc, getChallenge } from "../challenges";
import type { VerifyResult } from "../challenges/verify";
import { verifyChallenge } from "../challenges/verify";

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
  simStatus: SimStatus;
  activeChallengeId: string;
  /** Result of the last "Check", or null if not run since the circuit changed. */
  verifyResult: VerifyResult | null;

  // --- placement / structure ---
  armPlacement: (type: string | null) => void;
  placeComponent: (worldX: number, worldY: number) => void;
  setComponentPosition: (id: ComponentId, x: number, y: number, snapToGrid?: boolean) => void;
  deleteSelection: () => void;

  // --- wiring ---
  beginWire: (from: PortRef) => void;
  cancelWire: () => void;
  completeWire: (to: PortRef) => void;
  /** Delete every wire touching a port (either endpoint). For click-to-disconnect. */
  removeWiresAtPort: (ref: PortRef) => void;

  // --- simulation input ---
  toggleInput: (id: ComponentId) => void;

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

/** Build a fresh simulator for `doc`, settle it, and return it with its status. */
function recompute(doc: CircuitDoc): { sim: Simulator; simStatus: SimStatus } {
  const sim = new Simulator(doc);
  const result = sim.reset();
  return { sim, simStatus: { settled: result.settled, steps: result.steps } };
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

  armPlacement: (type) => set({ pendingPlacement: type, wireDraft: null }),

  /**
   * Drop an instance of the armed primitive centred on the given world point.
   * Clears the armed placement (hold-to-repeat can be added later) and rebuilds
   * the simulator so the new component evaluates immediately.
   */
  placeComponent: (worldX, worldY) => {
    const { pendingPlacement, doc } = get();
    if (!pendingPlacement) return;
    const def = getPrimitive(pendingPlacement);
    if (!def) return;
    const id = crypto.randomUUID();
    const inst = {
      id,
      type: pendingPlacement,
      x: snap(worldX - def.width / 2),
      y: snap(worldY - def.height / 2),
      state: def.initialState?.(),
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
      getPrimitive(doc.components[r.component]?.type ?? "")?.ports.find(
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

  loadFile: (file) => {
    const doc = file.doc;
    set({
      doc,
      selection: [],
      wireDraft: null,
      pendingPlacement: null,
      verifyResult: null,
      ...recompute(doc),
    });
  },

  exportFile: () => ({ format: DOC_FORMAT, doc: get().doc }),

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
