// Draws the circuit onto a 2D canvas context. One pure function, `renderScene`,
// called once per animation frame by CircuitCanvas. It reads a snapshot of the
// store plus the resolved theme colours and draws everything: grid, wires,
// components, port pins, the in-progress wire, and the placement ghost.
//
// The canvas transform is set to (dpr * scale) with a (dpr * pan) translation,
// so all drawing below is done directly in world coordinates.

import type { CircuitDoc, ComponentInstance, PortRef } from "../domain/types";
import { getPrimitive } from "../domain/primitives";
import type { Simulator } from "../sim/simulator";
import type { Logic } from "../sim/values";
import type { Point, Viewport } from "./geometry";
import { GRID, componentBounds, eachPort, endpoint, screenToWorld, snap } from "./geometry";

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
}

export interface RenderInput {
  ctx: CanvasRenderingContext2D;
  /** Canvas size in CSS pixels. */
  width: number;
  height: number;
  dpr: number;
  view: Viewport;
  doc: CircuitDoc;
  sim: Simulator;
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

/** Colour for a wire/pin given the logic value it carries. */
function wireColor(v: Logic, c: SceneColors): string {
  return v === 1 ? c.wire1 : v === 0 ? c.wire0 : c.wireX;
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
    drawWire(ctx, a, b, wireColor(input.sim.outputValue(w.from), colors));
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
): void {
  const dx = Math.max(18, Math.abs(b.x - a.x) * 0.5);
  ctx.strokeStyle = color;
  ctx.lineWidth = WIRE_W;
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
  const { ctx, sim, selection, hoverPort, colors } = input;
  const def = getPrimitive(inst.type);
  if (!def) return;
  const b = componentBounds(inst);
  const selected = selection.has(inst.id);

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
    const v = sim.inputValue({ component: inst.id, port: "in" });
    ctx.beginPath();
    ctx.arc(b.x + b.w / 2, b.y + b.h / 2, b.h / 2, 0, Math.PI * 2);
    ctx.fillStyle = v === 1 ? colors.ledOn : colors.gateFill;
    ctx.fill();
    ctx.strokeStyle = v === "x" ? colors.wireX : colors.gateStroke;
    ctx.lineWidth = STROKE_W;
    ctx.stroke();
  } else {
    roundRect(ctx, b.x, b.y, b.w, b.h, 4);
    ctx.fillStyle = colors.gateFill;
    ctx.fill();
    ctx.strokeStyle = colors.gateStroke;
    ctx.lineWidth = STROKE_W;
    ctx.stroke();
    label(ctx, def.title, b.x + b.w / 2, b.y + b.h / 2, colors.gateText, 10);
  }

  // Port pins and stubs.
  for (const p of eachPort(inst)) {
    const v = p.kind === "out" ? sim.outputValue(p.ref) : sim.inputValue(p.ref);
    const stubX = p.kind === "out" ? p.x + 4 : p.x - 4;
    ctx.strokeStyle = wireColor(v, colors);
    ctx.lineWidth = WIRE_W;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(stubX, p.y);
    ctx.stroke();

    const hovered =
      hoverPort?.component === p.ref.component && hoverPort?.port === p.ref.port;
    ctx.beginPath();
    ctx.arc(p.x, p.y, hovered ? 2.6 : 1.7, 0, Math.PI * 2);
    ctx.fillStyle = wireColor(v, colors);
    ctx.fill();
    if (hovered) {
      ctx.strokeStyle = colors.selection;
      ctx.lineWidth = 0.6;
      ctx.stroke();
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
  const def = getPrimitive(pendingPlacement);
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
