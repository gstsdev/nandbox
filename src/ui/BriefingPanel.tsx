// The teaching half of the app: the lesson for the current challenge. Until
// gating and verification land (phase P1) any challenge can be selected here
// for reading.

import { useState } from "react";
import { CHALLENGES, getChallenge } from "../challenges";
import { useCircuitStore } from "../store/circuitStore";

export function BriefingPanel() {
  const activeId = useCircuitStore((s) => s.activeChallengeId);
  const setActive = useCircuitStore((s) => s.setActiveChallenge);
  const [collapsed, setCollapsed] = useState(false);
  const challenge = getChallenge(activeId);

  if (collapsed) {
    return (
      <aside className="briefing is-collapsed">
        <button
          type="button"
          className="briefing-toggle"
          onClick={() => setCollapsed(false)}
          aria-label="Expand briefing"
        >
          ‹
        </button>
      </aside>
    );
  }

  return (
    <aside className="briefing">
      <div className="briefing-head">
        <select
          className="briefing-select"
          name="challenge"
          value={activeId}
          onChange={(e) => setActive(e.target.value)}
        >
          {CHALLENGES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.index === 0 ? c.title : `${c.index}. ${c.title}`}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="briefing-toggle"
          onClick={() => setCollapsed(true)}
          aria-label="Collapse briefing"
        >
          ›
        </button>
      </div>

      <div className="briefing-body">
        <Section label="The goal">{challenge.goal}</Section>
        <Section label="How it works">{challenge.howItWorks}</Section>
        <Section label="Fun fact" accent>
          {challenge.funFact}
        </Section>
        <Section label="What's checked">{challenge.checks}</Section>
      </div>
    </aside>
  );
}

function Section({
  label,
  accent,
  children,
}: {
  label: string;
  accent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={`briefing-section${accent ? " is-accent" : ""}`}>
      <h3>{label}</h3>
      <p>{children}</p>
    </section>
  );
}
