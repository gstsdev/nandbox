// Draws the circuit onto a 2D canvas context. One pure function, `renderScene`,
// called once per animation frame by CircuitCanvas. It reads a snapshot of the
// store plus the resolved theme colours and draws everything: grid, wires,
// components, port pins, the in-progress wire, and the placement ghost.
//
// The canvas transform is set to (dpr * scale) with a (dpr * pan) translation,
// so all drawing below is done directly in world coordinates.

import type { CircuitDoc, ComponentInstance, PortRef } from "../domain/types";
import { getComponentDef, isComposite } from "../domain/composite";
import type { Bus } from "../sim/values";
import { bit, busLabel } from "../sim/values";
import type { AnyComponentDef } from "../domain/composite";
import type { Point, Viewport } from "./geometry";
import { GRID, componentBounds, eachPort, endpoint, screenToWorld, snap } from "./geometry";

/** Reads the bus value at a port, transparently following block boundaries. */
export type SignalReader = (ref: PortRef, kind: "in" | "out") => Bus;

export interface SceneColors {
  bg: string;
  grid: string;
  gateFill: string;
  gateStroke: string;
  gateText: string;
  pin: string;
  wire0: string;
  wire1: string;
  wireX: string;
  selection: string;
  inputOn: string;
  ledOn: string;
  ghost: string;
  blockFill: string;
}

export interface RenderInput {
  ctx: CanvasRenderingContext2D;
  /** Canvas size in CSS pixels. */
  width: number;
  height: number;
  dpr: number;
  view: Viewport;
  doc: CircuitDoc;
  read: SignalReader;
  selection: Set<string>;
  wireDraft: PortRef | null;
  /** Current pointer position in world space, for the wire draft and ghost. */
  pointerWorld: Point | null;
  pendingPlacement: string | null;
  hoverPort: PortRef | null;
  colors: SceneColors;
}

const WIRE_W = 0.9;
const STROKE_W = 0.8;
const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';

/**
 * Colour for a wire/pin given the bus it carries: amber if any bit is unknown,
 * otherwise "off" only when every bit is 0, else "on".
 */
function busColor(b: Bus, c: SceneColors): string {
  if (b.some((v) => v === "x")) return c.wireX;
  return b.some((v) => v === 1) ? c.wire1 : c.wire0;
}

/** Line width for a wire: heavier for multi-bit buses. */
function wireWidth(b: Bus): number {
  return b.length > 1 ? WIRE_W * 2.1 : WIRE_W;
}

/** Full-frame draw. Clears and repaints; safe to call every frame. */
export function renderScene(input: RenderInput): void {
  const { ctx, width, height, dpr, view, doc, colors } = input;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, width * dpr, height * dpr);

  ctx.setTransform(
    dpr * view.scale,
    0,
    0,
    dpr * view.scale,
    dpr * view.panX,
    dpr * view.panY,
  );

  drawGrid(input);

  for (const w of Object.values(doc.wires)) {
    const a = endpoint(doc, w.from);
    const b = endpoint(doc, w.to);
    if (!a || !b) continue;
    const bus = input.read(w.from, "out");
    drawWire(ctx, a, b, busColor(bus, colors), wireWidth(bus));
  }

  drawWireDraft(input);

  for (const inst of Object.values(doc.components)) {
    drawComponent(input, inst);
  }

  drawGhost(input);
}

/** Dotted background grid; spacing doubles when zoomed out so dots stay legible. */
function drawGrid({ ctx, view, width, height, colors }: RenderInput): void {
  let step = GRID;
  while (step * view.scale < 14) step *= 2;

  const tl = screenToWorld(view, 0, 0);
  const br = screenToWorld(view, width, height);
  const startX = Math.floor(tl.x / step) * step;
  const startY = Math.floor(tl.y / step) * step;

  ctx.fillStyle = colors.grid;
  const r = 0.6;
  for (let x = startX; x < br.x; x += step) {
    for (let y = startY; y < br.y; y += step) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** A wire as a smooth cubic with horizontal tangents, so it reads like a routed trace. */
function drawWire(
  ctx: CanvasRenderingContext2D,
  a: Point,
  b: Point,
  color: string,
  lineWidth = WIRE_W,
): void {
  const dx = Math.max(18, Math.abs(b.x - a.x) * 0.5);
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.bezierCurveTo(a.x + dx, a.y, b.x - dx, b.y, b.x, b.y);
  ctx.stroke();
}

/** The rubber-band wire from the draft's origin port to the pointer. */
function drawWireDraft({ ctx, doc, wireDraft, pointerWorld, colors }: RenderInput): void {
  if (!wireDraft || !pointerWorld) return;
  const a = endpoint(doc, wireDraft);
  if (!a) return;
  ctx.save();
  ctx.setLineDash([2, 2]);
  drawWire(ctx, a, pointerWorld, colors.selection);
  ctx.restore();
}

function drawComponent(input: RenderInput, inst: ComponentInstance): void {
  const { ctx, read, selection, hoverPort, colors } = input;
  const def = getComponentDef(inst.type);
  if (!def) return;
  const b = componentBounds(inst);
  const selected = selection.has(inst.id);
  const composite = isComposite(def);

  const wideIn = /^in\d+$/.test(inst.type);
  const wideOut = /^out\d+$/.test(inst.type);

  if (inst.type === "input") {
    const on = inst.state?.value === 1;
    roundRect(ctx, b.x, b.y, b.w, b.h, 3);
    ctx.fillStyle = on ? colors.inputOn : colors.gateFill;
    ctx.fill();
    ctx.strokeStyle = colors.gateStroke;
    ctx.lineWidth = STROKE_W;
    ctx.stroke();
    label(ctx, on ? "1" : "0", b.x + b.w / 2, b.y + b.h / 2, colors.gateText, 13);
  } else if (inst.type === "output") {
    const v = bit(read({ component: inst.id, port: "in" }, "in"));
    ctx.beginPath();
    ctx.arc(b.x + b.w / 2, b.y + b.h / 2, b.h / 2, 0, Math.PI * 2);
    ctx.fillStyle = v === 1 ? colors.ledOn : colors.gateFill;
    ctx.fill();
    ctx.strokeStyle = v === "x" ? colors.wireX : colors.gateStroke;
    ctx.lineWidth = STROKE_W;
    ctx.stroke();
  } else if (wideIn) {
    drawBitColumn(ctx, b, def, (inst.state?.value as number) ?? 0, colors);
  } else if (wideOut) {
    const bus = read({ component: inst.id, port: "in" }, "in");
    roundRect(ctx, b.x, b.y, b.w, b.h, 4);
    ctx.fillStyle = colors.gateFill;
    ctx.fill();
    ctx.strokeStyle = colors.gateStroke;
    ctx.lineWidth = STROKE_W;
    ctx.stroke();
    label(ctx, busLabel(bus), b.x + b.w / 2, b.y + b.h / 2, colors.gateText, 11);
  } else {
    roundRect(ctx, b.x, b.y, b.w, b.h, 4);
    ctx.fillStyle = composite ? colors.blockFill : colors.gateFill;
    ctx.fill();
    ctx.strokeStyle = colors.gateStroke;
    ctx.lineWidth = STROKE_W;
    ctx.stroke();
    label(ctx, def.title, b.x + b.w / 2, b.y + b.h / 2, colors.gateText, composite ? 9 : 10);
  }

  // Port pins and stubs.
  for (const p of eachPort(inst)) {
    const v = read(p.ref, p.kind === "out" ? "out" : "in");
    const stubX = p.kind === "out" ? p.x + 4 : p.x - 4;
    ctx.strokeStyle = busColor(v, colors);
    ctx.lineWidth = wireWidth(v);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(stubX, p.y);
    ctx.stroke();

    const hovered =
      hoverPort?.component === p.ref.component && hoverPort?.port === p.ref.port;
    ctx.beginPath();
    ctx.arc(p.x, p.y, hovered ? 2.6 : 1.7, 0, Math.PI * 2);
    ctx.fillStyle = busColor(v, colors);
    ctx.fill();
    if (hovered) {
      ctx.strokeStyle = colors.selection;
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }
  }

  // Block ports are named (in1, out2, …); print them just inside each edge.
  if (composite) {
    ctx.fillStyle = colors.gateText;
    ctx.font = `500 5.5px ${MONO}`;
    ctx.textBaseline = "middle";
    for (const p of eachPort(inst)) {
      ctx.textAlign = p.kind === "in" ? "left" : "right";
      const tx = p.kind === "in" ? p.x + 3 : p.x - 3;
      ctx.fillText(p.ref.port, tx, p.y);
    }
  }

  // Challenge IO terminals carry a label; draw it just outside the body.
  if (inst.locked && inst.label) {
    ctx.fillStyle = colors.gateText;
    ctx.font = `500 9px ${MONO}`;
    ctx.textBaseline = "middle";
    if (inst.type === "input") {
      ctx.textAlign = "right";
      ctx.fillText(inst.label, b.x - 7, b.y + b.h / 2);
    } else {
      ctx.textAlign = "left";
      ctx.fillText(inst.label, b.x + b.w + 7, b.y + b.h / 2);
    }
  }

  if (selected) {
    ctx.strokeStyle = colors.selection;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    roundRect(ctx, b.x - 3, b.y - 3, b.w + 6, b.h + 6, 5);
    ctx.stroke();
  }
}

/** Translucent preview of the component that a click would place. */
function drawGhost({ ctx, pendingPlacement, pointerWorld, colors }: RenderInput): void {
  if (!pendingPlacement || !pointerWorld) return;
  const def = getComponentDef(pendingPlacement);
  if (!def) return;
  const x = snap(pointerWorld.x - def.width / 2);
  const y = snap(pointerWorld.y - def.height / 2);
  ctx.save();
  ctx.globalAlpha = 0.5;
  roundRect(ctx, x, y, def.width, def.height, 4);
  ctx.fillStyle = colors.ghost;
  ctx.fill();
  ctx.strokeStyle = colors.selection;
  ctx.lineWidth = STROKE_W;
  ctx.stroke();
  ctx.restore();
}

/**
 * Wide input terminal: a stacked column of bit-cells (MSB at top), each filled
 * when that bit of `value` is 1. Clicking a cell toggles it (handled in
 * CircuitCanvas). Also prints the decimal value below.
 */
function drawBitColumn(
  ctx: CanvasRenderingContext2D,
  b: { x: number; y: number; w: number; h: number },
  def: AnyComponentDef,
  value: number,
  colors: SceneColors,
): void {
  const out = def.ports.find((p) => p.kind === "out");
  const n = out?.width ?? 1;
  const pad = 3;
  const cellH = (b.h - pad * 2) / n;
  roundRect(ctx, b.x, b.y, b.w, b.h, 3);
  ctx.fillStyle = colors.gateFill;
  ctx.fill();
  ctx.strokeStyle = colors.gateStroke;
  ctx.lineWidth = STROKE_W;
  ctx.stroke();
  for (let i = 0; i < n; i++) {
    const on = (value >> (n - 1 - i)) & 1;
    ctx.beginPath();
    ctx.rect(b.x + pad, b.y + pad + i * cellH + 0.5, b.w - pad * 2, cellH - 1);
    ctx.fillStyle = on ? colors.inputOn : colors.gateFill;
    ctx.fill();
    ctx.strokeStyle = colors.gateStroke;
    ctx.lineWidth = 0.4;
    ctx.stroke();
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function label(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  color: string,
  size: number,
): void {
  ctx.fillStyle = color;
  ctx.font = `600 ${size}px ui-monospace, "SF Mono", Menlo, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, cx, cy);
}
