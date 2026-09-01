// The circuit canvas: a plain <canvas> driven by its own requestAnimationFrame
// loop that reads the Zustand store directly, so panning and simulation never
// trigger React re-renders. This component also owns all pointer interaction —
// placing, selecting, moving, wiring, panning, zooming — translating events
// into store actions.

import { useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { PortRef } from "../domain/types";
import { getPrimitive } from "../domain/primitives";
import { useCircuitStore } from "../store/circuitStore";
import type { Point } from "./geometry";
import { componentAt, portAt, screenToWorld, wireAt } from "./geometry";
import type { SceneColors } from "./renderer";
import { renderScene } from "./renderer";

/** World-space radius within which a pointer "hits" a port. */
const PORT_HIT = 5;
/** Pixels the pointer must move before a press on a component becomes a drag. */
const DRAG_SLOP = 3;

type DragState =
  | { kind: "idle" }
  | { kind: "pan"; lastX: number; lastY: number }
  | { kind: "press"; id: string; downX: number; downY: number; isInput: boolean }
  | { kind: "move"; ids: string[]; last: Point }
  | { kind: "wire" };

export function CircuitCanvas() {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointerWorld = useRef<Point | null>(null);
  const hoverPort = useRef<PortRef | null>(null);
  const drag = useRef<DragState>({ kind: "idle" });
  const colors = useRef<SceneColors>(DEFAULT_COLORS);
  const dims = useRef({ w: 0, h: 0, dpr: 1 });

  // Keep the canvas backing store matched to its container and device pixels.
  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    const ro = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1;
      const { clientWidth: w, clientHeight: h } = host;
      dims.current = { w, h, dpr };
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  // Resolve theme colours from CSS variables now and whenever the theme changes.
  useEffect(() => {
    const refresh = () => {
      colors.current = readColors(hostRef.current);
    };
    refresh();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", refresh);
    const mo = new MutationObserver(refresh);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      mq.removeEventListener("change", refresh);
      mo.disconnect();
    };
  }, []);

  // The render loop. Pulls a fresh store snapshot each frame.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    let raf = 0;
    const loop = () => {
      const s = useCircuitStore.getState();
      renderScene({
        ctx,
        width: dims.current.w,
        height: dims.current.h,
        dpr: dims.current.dpr,
        view: s.view,
        doc: s.doc,
        sim: s.sim,
        selection: new Set(s.selection),
        wireDraft: s.wireDraft,
        pointerWorld: pointerWorld.current,
        pendingPlacement: s.pendingPlacement,
        hoverPort: hoverPort.current,
        colors: colors.current,
      });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Non-passive wheel listener so we can preventDefault the page from scrolling.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      useCircuitStore.getState().zoomAt(e.clientX - rect.left, e.clientY - rect.top, factor);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

  // Delete / Escape, ignored while typing in a form field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const store = useCircuitStore.getState();
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        store.deleteSelection();
      } else if (e.key === "Escape") {
        store.cancelWire();
        store.armPlacement(null);
        store.clearSelection();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /** Pointer position in screen (canvas-local) and world coordinates. */
  const locate = (e: ReactPointerEvent): { sx: number; sy: number; world: Point } => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const world = screenToWorld(useCircuitStore.getState().view, sx, sy);
    return { sx, sy, world };
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    canvasRef.current?.setPointerCapture(e.pointerId);
    const { sx, sy, world } = locate(e);
    pointerWorld.current = world;
    const store = useCircuitStore.getState();

    if (store.pendingPlacement) {
      store.placeComponent(world.x, world.y);
      return;
    }

    const port = portAt(store.doc, world.x, world.y, PORT_HIT);
    if (port) {
      store.beginWire(port.ref);
      drag.current = { kind: "wire" };
      return;
    }

    const comp = componentAt(store.doc, world.x, world.y);
    if (comp) {
      if (!store.selection.includes(comp.id)) store.select([comp.id], e.shiftKey);
      drag.current = {
        kind: "press",
        id: comp.id,
        downX: sx,
        downY: sy,
        isInput: comp.type === "input",
      };
      return;
    }

    const wire = wireAt(store.doc, world.x, world.y, 3);
    if (wire) {
      store.select([wire.id], e.shiftKey);
      drag.current = { kind: "idle" };
      return;
    }

    store.clearSelection();
    drag.current = { kind: "pan", lastX: e.clientX, lastY: e.clientY };
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const { sx, sy, world } = locate(e);
    pointerWorld.current = world;
    const store = useCircuitStore.getState();
    hoverPort.current = portAt(store.doc, world.x, world.y, PORT_HIT)?.ref ?? null;
    const d = drag.current;
    
    if (canvasRef.current) {
      canvasRef.current.style.cursor = cursorFor(store, world, d, hoverPort.current !== null);
    }

    if (d.kind === "pan") {
      store.setView({
        panX: store.view.panX + (e.clientX - d.lastX),
        panY: store.view.panY + (e.clientY - d.lastY),
      });
      drag.current = { kind: "pan", lastX: e.clientX, lastY: e.clientY };
    } else if (d.kind === "press") {
      if (Math.hypot(sx - d.downX, sy - d.downY) > DRAG_SLOP) {
        const ids = store.selection.includes(d.id) ? store.selection : [d.id];
        drag.current = { kind: "move", ids, last: world };
      }
    } else if (d.kind === "move") {
      const dx = world.x - d.last.x;
      const dy = world.y - d.last.y;
      for (const id of d.ids) {
        const inst = store.doc.components[id];
        if (inst) store.setComponentPosition(id, inst.x + dx, inst.y + dy);
      }
      drag.current = { kind: "move", ids: d.ids, last: world };
    }
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    canvasRef.current?.releasePointerCapture(e.pointerId);
    const { world } = locate(e);
    const store = useCircuitStore.getState();
    const d = drag.current;

    if (d.kind === "press" && d.isInput) {
      store.toggleInput(d.id);
    } else if (d.kind === "move") {
      for (const id of d.ids) {
        const inst = store.doc.components[id];
        if (inst) store.setComponentPosition(id, inst.x, inst.y, true);
      }
    } else if (d.kind === "wire") {
      const port = portAt(store.doc, world.x, world.y, PORT_HIT);
      if (port) store.completeWire(port.ref);
      else store.cancelWire();
    }
    drag.current = { kind: "idle" };
  };

  return (
    <div ref={hostRef} className="canvas-host">
      <canvas
        ref={canvasRef}
        className="circuit-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
      <CanvasHints />
    </div>
  );
}

/**
 * Pick the canvas cursor from what's under the pointer, so ports, draggable
 * bodies, and clickable switches each read as interactive.
 */
function cursorFor(
  store: ReturnType<typeof useCircuitStore.getState>,
  world: Point,
  d: DragState,
  overPort: boolean,
): string {
  if (d.kind === "pan" || d.kind === "move") return "grabbing";
  if (d.kind === "wire" || overPort || store.pendingPlacement) return "crosshair";
  const c = componentAt(store.doc, world.x, world.y);
  if (!c) return "default";
  return c.type === "input" ? "pointer" : "grab";
}

/** Small contextual hint strip in the corner of the canvas. */
function CanvasHints() {
  const pending = useCircuitStore((s) => s.pendingPlacement);
  const wiring = useCircuitStore((s) => s.wireDraft !== null);
  const text = pending
    ? `Click to place ${getPrimitive(pending)?.title ?? pending} · Esc to cancel`
    : wiring
      ? "Release on an input port to connect · Esc to cancel"
      : "Drag from a port to wire · click a switch to toggle · Del to remove";
  return <div className="canvas-hints">{text}</div>;
}

// Fallback palette used until CSS variables resolve (also documents the keys).
const DEFAULT_COLORS: SceneColors = {
  bg: "#0d0f12",
  grid: "#20242b",
  gateFill: "#171b21",
  gateStroke: "#3a4049",
  gateText: "#c9ced8",
  pin: "#8b93a1",
  wire0: "#4a515d",
  wire1: "#3fd4bb",
  wireX: "#e0973f",
  selection: "#5b8cff",
  inputOn: "#123a35",
  ledOn: "#3fd4bb",
  ghost: "#2a2f38",
};

/** Read the scene palette from `--scene-*` CSS variables on the host element. */
function readColors(host: HTMLElement | null): SceneColors {
  if (!host) return DEFAULT_COLORS;
  const cs = getComputedStyle(host);
  const v = (name: string, fallback: string) =>
    cs.getPropertyValue(name).trim() || fallback;
  return {
    bg: v("--scene-bg", DEFAULT_COLORS.bg),
    grid: v("--scene-grid", DEFAULT_COLORS.grid),
    gateFill: v("--scene-gate-fill", DEFAULT_COLORS.gateFill),
    gateStroke: v("--scene-gate-stroke", DEFAULT_COLORS.gateStroke),
    gateText: v("--scene-gate-text", DEFAULT_COLORS.gateText),
    pin: v("--scene-pin", DEFAULT_COLORS.pin),
    wire0: v("--scene-wire0", DEFAULT_COLORS.wire0),
    wire1: v("--scene-wire1", DEFAULT_COLORS.wire1),
    wireX: v("--scene-wireX", DEFAULT_COLORS.wireX),
    selection: v("--scene-selection", DEFAULT_COLORS.selection),
    inputOn: v("--scene-input-on", DEFAULT_COLORS.inputOn),
    ledOn: v("--scene-led-on", DEFAULT_COLORS.ledOn),
    ghost: v("--scene-ghost", DEFAULT_COLORS.ghost),
  };
}
