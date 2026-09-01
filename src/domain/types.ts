// Core circuit-document types. The document is plain, serializable data;
// the renderer and simulator are pure functions over it. This is what gets
// saved to JSON, shared in a URL, and loaded back.

export type ComponentId = string;
export type WireId = string;

/** A reference to one named port on one component instance. Wires connect two of these. */
export interface PortRef {
  component: ComponentId;
  port: string;
}

export interface ComponentInstance {
  id: ComponentId;
  /** Primitive type key, e.g. "nand" | "input" | "output". Looked up in the primitive registry. */
  type: string;
  /** World-space position of the component's top-left corner, grid-aligned. */
  x: number;
  y: number;
  label?: string;
  /** Per-instance mutable data, e.g. an input switch's current value `{ value: 0 | 1 }`. */
  state?: Record<string, unknown>;
}

export interface Wire {
  id: WireId;
  /** Driving side — an output port. */
  from: PortRef;
  /** Driven side — an input port. Each input port has at most one incoming wire. */
  to: PortRef;
}

export interface CircuitDoc {
  /** Document identity, stable across edits. */
  id: string;
  name: string;
  components: Record<ComponentId, ComponentInstance>;
  wires: Record<WireId, Wire>;
}

/** Version tag written into saved files so future loaders can migrate old formats. */
export const DOC_FORMAT = "nandbox.circuit/1" as const;

export interface CircuitFile {
  format: typeof DOC_FORMAT;
  doc: CircuitDoc;
}

/** A fresh, empty document with a new id. Used for "New document" and as the store's initial state. */
export function emptyDoc(name = "Untitled"): CircuitDoc {
  return { id: crypto.randomUUID(), name, components: {}, wires: {} };
}

/** Stable string key for a port ref, for use in Maps/Sets. */
export function portKey(ref: PortRef): string {
  return `${ref.component}:${ref.port}`;
}

/** Whether two port refs point at the exact same port. */
export function samePort(a: PortRef, b: PortRef): boolean {
  return a.component === b.component && a.port === b.port;
}