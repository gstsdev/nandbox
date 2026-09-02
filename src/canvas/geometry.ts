// View transform and hit-testing helpers. Pure functions over the document —
// no canvas, no React. The renderer (drawing) and the pointer-interaction code
// in CircuitCanvas both build on these.

import type { CircuitDoc, ComponentInstance, PortRef, Wire } from "../domain/types";
import { getComponentDef } from "../domain/composite";
import type { PortKind } from "../domain/primitives";

/**
 * Camera state for the circuit canvas. Screen = world * scale + pan.
 * `scale` is pixels-per-world-unit; `panX/panY` is where the world origin
 * sits on screen. Stored in the circuit store and mutated by pan/zoom.
 */
export interface Viewport {
  panX: number;
  panY: number;
  scale: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Editing grid size in world units. Placement and drags snap to it. */
export const GRID = 8;

/** Snap a world coordinate to the nearest grid line. Used when placing/moving components. */
export function snap(v: number): number {
  return Math.round(v / GRID) * GRID;
}

/**
 * World point -> on-screen (canvas CSS) pixels.
 * Used by the renderer for every draw call and to place the wire-draft endpoint.
 */
export function worldToScreen(v: Viewport, wx: number, wy: number): Point {
  return { x: wx * v.scale + v.panX, y: wy * v.scale + v.panY };
}

/**
 * On-screen pixel point -> world space.
 * Used by CircuitCanvas to turn pointer events into world coordinates before
 * hit-testing or placing components.
 */
export function screenToWorld(v: Viewport, sx: number, sy: number): Point {
  return { x: (sx - v.panX) / v.scale, y: (sy - v.panY) / v.scale };
}

export interface PortHit {
  ref: PortRef;
  kind: PortKind;
  /** Absolute world position of the port. */
  x: number;
  y: number;
}

/**
 * Absolute world position of one named port on an instance (its top-left plus
 * the port's local offset), or null if the type/port is unknown.
 * Used to draw wires and port dots and to resolve wire endpoints.
 */
export function portPosition(inst: ComponentInstance, port: string): Point | null {
  const def = getComponentDef(inst.type);
  const p = def?.ports.find((pp) => pp.name === port);
  if (!p) return null;
  return { x: inst.x + p.dx, y: inst.y + p.dy };
}

/**
 * All ports of an instance resolved to absolute world positions and tagged
 * in/out. Used by the renderer to draw port dots and by `portAt` for hit-testing.
 */
export function eachPort(inst: ComponentInstance): PortHit[] {
  const def = getComponentDef(inst.type);
  if (!def) return [];
  return def.ports.map((p) => ({
    ref: { component: inst.id, port: p.name },
    kind: p.kind,
    x: inst.x + p.dx,
    y: inst.y + p.dy,
  }));
}

/**
 * Axis-aligned world-space bounding box of an instance's body.
 * Used for body hit-testing (`componentAt`) and drawing selection outlines.
 */
export function componentBounds(inst: ComponentInstance): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  const def = getComponentDef(inst.type);
  return { x: inst.x, y: inst.y, w: def?.width ?? 40, h: def?.height ?? 30 };
}

/**
 * Topmost component whose body contains the world point, or null.
 * Iterates last-to-first so the visually-on-top component wins.
 * Called on pointer-down in CircuitCanvas to decide what got clicked.
 */
export function componentAt(doc: CircuitDoc, wx: number, wy: number): ComponentInstance | null {
  const items = Object.values(doc.components);
  for (let i = items.length - 1; i >= 0; i--) {
    const b = componentBounds(items[i]);
    if (wx >= b.x && wx <= b.x + b.w && wy >= b.y && wy <= b.y + b.h) return items[i];
  }
  return null;
}

/**
 * Nearest port to the world point within `radius` world units, or null.
 * Ports win over bodies in CircuitCanvas's pointer-down handler, so this is
 * checked first — to begin a wire (from an output) or complete one (to an input).
 */
export function portAt(
  doc: CircuitDoc,
  wx: number,
  wy: number,
  radius: number,
): PortHit | null {
  let best: PortHit | null = null;
  let bestD = radius * radius;
  for (const inst of Object.values(doc.components)) {
    for (const p of eachPort(inst)) {
      const dx = p.x - wx;
      const dy = p.y - wy;
      const d = dx * dx + dy * dy;
      if (d <= bestD) {
        bestD = d;
        best = p;
      }
    }
  }
  return best;
}

/**
 * First wire passing within `tol` world units of the point, or null.
 * Called on pointer-down (after ports and bodies miss) so a wire can be
 * selected and deleted.
 */
export function wireAt(doc: CircuitDoc, wx: number, wy: number, tol: number): Wire | null {
  for (const w of Object.values(doc.wires)) {
    const a = endpoint(doc, w.from);
    const b = endpoint(doc, w.to);
    if (!a || !b) continue;
    if (distToSegment(wx, wy, a.x, a.y, b.x, b.y) <= tol) return w;
  }
  return null;
}

/**
 * World position of a wire endpoint (the port it names), or null if that
 * component no longer exists. Used by the renderer and `wireAt`.
 */
export function endpoint(doc: CircuitDoc, ref: PortRef): Point | null {
  const inst = doc.components[ref.component];
  if (!inst) return null;
  return portPosition(inst, ref.port);
}

/**
 * Shortest distance from a point to a line segment. Internal helper for
 * `wireAt`'s proximity test.
 */
function distToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}
