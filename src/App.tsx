import { CircuitCanvas } from "./canvas/CircuitCanvas";
import { BriefingPanel } from "./ui/BriefingPanel";
import { Palette } from "./ui/Palette";
import { Toolbar } from "./ui/Toolbar";
import "./App.css";

export default function App() {
  return (
    <div className="app">
      <Toolbar />
      <div className="workspace">
        <BriefingPanel />
        <CircuitCanvas />
        <Palette />
      </div>
    </div>
  );
}
