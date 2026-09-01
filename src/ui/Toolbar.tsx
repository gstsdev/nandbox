// Top bar: document name, file actions, view reset, and the live simulation
// status (settled / oscillating).

import { useRef } from "react";
import { DOC_FORMAT } from "../domain/types";
import type { CircuitFile } from "../domain/types";
import { useCircuitStore } from "../store/circuitStore";

/** Trigger a browser download of a text file. Used by "Save". */
function download(filename: string, text: string): void {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function Toolbar() {
  const name = useCircuitStore((s) => s.doc.name);
  const status = useCircuitStore((s) => s.simStatus);
  const fileInput = useRef<HTMLInputElement>(null);

  const onSave = () => {
    const file = useCircuitStore.getState().exportFile();
    download(`${slug(name)}.json`, JSON.stringify(file, null, 2));
  };

  const onLoadPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try {
      const parsed = JSON.parse(await f.text()) as CircuitFile;
      if (parsed.format !== DOC_FORMAT || !parsed.doc) throw new Error("unrecognised file");
      useCircuitStore.getState().loadFile(parsed);
    } catch (err) {
      alert(`Could not load that file: ${(err as Error).message}`);
    }
  };

  return (
    <header className="toolbar">
      <div className="toolbar-brand">Nandbox</div>

      <input
        className="toolbar-name"
        name="circuit-name"
        value={name}
        onChange={(e) =>
          useCircuitStore.setState((s) => ({ doc: { ...s.doc, name: e.target.value } }))
        }
        aria-label="Circuit name"
      />

      <div className="toolbar-actions">
        <button type="button" onClick={() => useCircuitStore.getState().newDoc()}>
          New
        </button>
        <button type="button" onClick={onSave}>
          Save
        </button>
        <button type="button" onClick={() => fileInput.current?.click()}>
          Load
        </button>
        <button
          type="button"
          onClick={() => useCircuitStore.getState().setView({ panX: 120, panY: 90, scale: 2 })}
        >
          Reset view
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={onLoadPicked}
        />
      </div>

      <div
        className={`sim-status${status.settled ? "" : " is-unstable"}`}
        title={
          status.settled
            ? `Settled in ${status.steps} step${status.steps === 1 ? "" : "s"}`
            : "Circuit is oscillating — it never settles"
        }
      >
        <span className="sim-dot" />
        {status.settled ? "Stable" : "Oscillating"}
      </div>
    </header>
  );
}

function slug(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "circuit";
}
