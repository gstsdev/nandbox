// Binary min-heap priority queue for the event-driven simulator.
// Events are ordered by (time, insertion sequence) so that same-timestamp
// events process in the order they were scheduled.

export interface QueuedEvent {
  time: number;
  seq: number;
  componentId: string;
}

/**
 * Min-heap of pending "re-evaluate this component" events, ordered by
 * simulation time then insertion order. The simulator's settle loop pops from
 * here until it's empty. Insertion order as a tiebreaker keeps same-timestamp
 * evaluations deterministic.
 */
export class EventQueue {
  private heap: QueuedEvent[] = [];
  private seqCounter = 0;

  get size(): number {
    return this.heap.length;
  }

  /** Schedule `componentId` to be evaluated at `time`. Sift-up keeps the heap ordered. */
  push(time: number, componentId: string): void {
    const h = this.heap;
    h.push({ time, seq: this.seqCounter++, componentId });
    let i = h.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (less(h[i], h[parent])) {
        swap(h, i, parent);
        i = parent;
      } else {
        break;
      }
    }
  }

  /** Remove and return the earliest event, or undefined if empty. Sift-down restores the heap. */
  pop(): QueuedEvent | undefined {
    const h = this.heap;
    if (h.length === 0) return undefined;
    const top = h[0];
    const last = h.pop() as QueuedEvent;
    if (h.length > 0) {
      h[0] = last;
      let i = 0;
      const n = h.length;
      for (;;) {
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        let smallest = i;
        if (l < n && less(h[l], h[smallest])) smallest = l;
        if (r < n && less(h[r], h[smallest])) smallest = r;
        if (smallest === i) break;
        swap(h, i, smallest);
        i = smallest;
      }
    }
    return top;
  }

  clear(): void {
    this.heap.length = 0;
    this.seqCounter = 0;
  }
}

function less(a: QueuedEvent, b: QueuedEvent): boolean {
  return a.time !== b.time ? a.time < b.time : a.seq < b.seq;
}

function swap(h: QueuedEvent[], i: number, j: number): void {
  const t = h[i];
  h[i] = h[j];
  h[j] = t;
}
