// Component palette. Clicking an entry "arms" it; the next click on the canvas
// drops an instance. Below the built-ins sit the user's blocks, plus a button
// that turns the current selection into a new block.

import { allPrimitives } from "../domain/primitives";
import type { PrimitiveDef } from "../domain/primitives";
import { getComposite } from "../domain/composite";
import { getChallenge } from "../challenges";
import { useCircuitStore } from "../store/circuitStore";

const GROUP_LABELS: Record<PrimitiveDef["category"], string> = {
  io: "In / Out",
  gate: "Gates",
  bus: "Buses",
};

export function Palette() {
  const pending = useCircuitStore((s) => s.pendingPlacement);
  const arm = useCircuitStore((s) => s.armPlacement);
  const allowed = useCircuitStore((s) => getChallenge(s.activeChallengeId).allowedTypes);
  const blockTypes = useCircuitStore((s) => s.blockTypes);

  // A challenge restricts the palette to the components it "unlocks"; the
  // sandbox (allowed === undefined) offers everything. Blocks show in the
  // sandbox and in any challenge that lists "composite".
  const visible = allowed
    ? allPrimitives().filter((p) => allowed.includes(p.type))
    : allPrimitives();
  const showBlocks = !allowed || allowed.includes("composite");

  const groups = new Map<PrimitiveDef["category"], PrimitiveDef[]>();
  for (const p of visible) {
    const list = groups.get(p.category) ?? [];
    list.push(p);
    groups.set(p.category, list);
  }

  const blocks = showBlocks
    ? blockTypes.map(getComposite).filter((b) => b !== undefined)
    : [];

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

      {showBlocks && (
        <div className="palette-group">
          <div className="palette-group-label">Blocks</div>
          {blocks.length > 0 && (
            <div className="palette-items">
              {blocks.map((b) => (
                <button
                  key={b.type}
                  type="button"
                  className={`palette-item${pending === b.type ? " is-armed" : ""}`}
                  onClick={() => arm(pending === b.type ? null : b.type)}
                >
                  {b.title}
                </button>
              ))}
            </div>
          )}
          <CreateBlockButton />
        </div>
      )}

      <SelectedBlockPorts />

      <p className="palette-tip">Pick a component, then click the canvas to place it.</p>
    </aside>
  );
}

/** When one block instance is selected, lets you reorder its ports. */
function SelectedBlockPorts() {
  const rev = useCircuitStore((s) => s.blockRevision);
  const type = useCircuitStore((s) => {
    if (s.selection.length !== 1) return null;
    const c = s.doc.components[s.selection[0]];
    return c && getComposite(c.type) ? c.type : null;
  });
  const move = useCircuitStore((s) => s.moveBlockPort);
  if (!type) return null;
  const def = getComposite(type);
  if (!def) return null;
  const inputs = def.ports.filter((p) => p.kind === "in");
  const outputs = def.ports.filter((p) => p.kind === "out");

  const list = (ports: typeof inputs, label: string) => (
    <div className="blockport-list">
      <div className="palette-group-label">{label}</div>
      {ports.map((p, i) => (
        <div className="blockport-row" key={p.name}>
          <span className="blockport-name">{p.name}</span>
          <button
            type="button"
            disabled={i === 0}
            onClick={() => move(type, p.name, -1)}
            aria-label={`Move ${p.name} up`}
          >
            ↑
          </button>
          <button
            type="button"
            disabled={i === ports.length - 1}
            onClick={() => move(type, p.name, 1)}
            aria-label={`Move ${p.name} down`}
          >
            ↓
          </button>
        </div>
      ))}
    </div>
  );

  return (
    <div className="palette-group blockports" key={rev}>
      <div className="palette-group-label">{def.title} — ports</div>
      {inputs.length > 1 ? list(inputs, "Inputs") : null}
      {outputs.length > 1 ? list(outputs, "Outputs") : null}
      {inputs.length <= 1 && outputs.length <= 1 && (
        <p className="palette-tip">Only one port each side — nothing to reorder.</p>
      )}
    </div>
  );
}

/** Turns the current non-locked selection into a block, prompting for a name. */
function CreateBlockButton() {
  const count = useCircuitStore(
    (s) => s.selection.filter((id) => s.doc.components[id] && !s.doc.components[id].locked).length,
  );
  const encapsulate = useCircuitStore((s) => s.encapsulate);

  return (
    <button
      type="button"
      className="palette-create"
      disabled={count === 0}
      onClick={() => {
        const name = window.prompt("Name this block:");
        if (name?.trim()) encapsulate(name.trim());
      }}
    >
      {count === 0 ? "Select parts to make a block" : `Make block from ${count} part${count === 1 ? "" : "s"}`}
    </button>
  );
}