// Component palette. Clicking an entry "arms" it; the next click on the canvas
// drops an instance. The armed entry is highlighted.

import { allPrimitives } from "../domain/primitives";
import type { PrimitiveDef } from "../domain/primitives";
import { useCircuitStore } from "../store/circuitStore";

const GROUP_LABELS: Record<PrimitiveDef["category"], string> = {
  io: "In / Out",
  gate: "Gates",
};

export function Palette() {
  const pending = useCircuitStore((s) => s.pendingPlacement);
  const arm = useCircuitStore((s) => s.armPlacement);

  const groups = new Map<PrimitiveDef["category"], PrimitiveDef[]>();
  for (const p of allPrimitives()) {
    const list = groups.get(p.category) ?? [];
    list.push(p);
    groups.set(p.category, list);
  }

  return (
    <aside className="palette">
      <h2 className="panel-title">Components</h2>
      {[...groups.entries()].map(([cat, items]) => (
        <div key={cat} className="palette-group">
          <div className="palette-group-label">{GROUP_LABELS[cat]}</div>
          <div className="palette-items">
            {items.map((p) => (
              <button
                key={p.type}
                type="button"
                className={`palette-item${pending === p.type ? " is-armed" : ""}`}
                onClick={() => arm(pending === p.type ? null : p.type)}
              >
                {p.title}
              </button>
            ))}
          </div>
        </div>
      ))}
      <p className="palette-tip">
        Pick a component, then click the canvas to place it.
      </p>
    </aside>
  );
}
