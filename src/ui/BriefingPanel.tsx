// The teaching half of the app: the lesson for the current challenge, plus —
// for real challenges — the "Check" button and the resulting truth table.

import { useState } from "react";
import { CHALLENGES, getChallenge } from "../challenges";
import type { Challenge } from "../challenges";
import type { VerifyResult } from "../challenges/verify";
import { logicLabel } from "../sim/values";
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
          ›
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
          ‹
        </button>
      </div>

      <div className="briefing-body">
        <Section label="The goal">{challenge.goal}</Section>
        <Section label="How it works">{challenge.howItWorks}</Section>
        <Section label="Fun fact" accent>
          {challenge.funFact}
        </Section>
        <Section label="What's checked">{challenge.checks}</Section>
        {challenge.truth && challenge.inputs.length > 0 && (
          <VerifyBlock challenge={challenge} />
        )}
      </div>
    </aside>
  );
}

/** The Check button and the truth table it produces. */
function VerifyBlock({ challenge }: { challenge: Challenge }) {
  const verify = useCircuitStore((s) => s.verify);
  const reset = useCircuitStore((s) => s.newDoc);
  const result = useCircuitStore((s) => s.verifyResult);

  return (
    <section className="verify">
      <div className="verify-actions">
        <button type="button" className="btn-primary" onClick={verify}>
          Check
        </button>
        <button type="button" onClick={reset}>
          Reset canvas
        </button>
      </div>
      {result && <VerifySummary result={result} challenge={challenge} />}
      {result && result.rows.length > 0 && (
        <TruthTable result={result} challenge={challenge} />
      )}
    </section>
  );
}

function VerifySummary({
  result,
  challenge,
}: {
  result: VerifyResult;
  challenge: Challenge;
}) {
  if (result.ok) {
    return <p className="verify-msg is-ok">Passed — every combination matches.</p>;
  }
  if (result.oscillated) {
    return (
      <p className="verify-msg is-bad">
        The circuit oscillates for some inputs — it never settles. Look for a
        feedback loop.
      </p>
    );
  }
  const row = result.rows[result.firstFail];
  if (!row) {
    return <p className="verify-msg is-bad">Wire the output terminal(s) up first.</p>;
  }
  const inParts = challenge.inputs.map((n, i) => `${n}=${row.inputs[i]}`).join(", ");
  const wantParts = challenge.outputs
    .map((n, i) => `${n}=${row.expected[i]}`)
    .join(", ");
  const gotParts = challenge.outputs
    .map((n, i) => `${n}=${logicLabel(row.actual[i] ?? "x")}`)
    .join(", ");
  return (
    <p className="verify-msg is-bad">
      Fails when {inParts}: expected {wantParts}, got {gotParts}.
    </p>
  );
}

/** Full truth table with a pass/fail dot per row. */
function TruthTable({
  result,
  challenge,
}: {
  result: VerifyResult;
  challenge: Challenge;
}) {
  return (
    <div className="truth-wrap">
      <table className="truth">
        <thead>
          <tr>
            {challenge.inputs.map((n) => (
              <th key={n}>{n}</th>
            ))}
            <th className="sep" />
            {challenge.outputs.map((n) => (
              <th key={n}>{n}</th>
            ))}
            <th />
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, i) => (
            <tr key={i} className={row.ok ? "" : "is-bad"}>
              {row.inputs.map((b, j) => (
                <td key={j}>{b}</td>
              ))}
              <td className="sep" />
              {row.actual.map((v, j) => (
                <td key={j} className={v !== row.expected[j] ? "is-wrong" : ""}>
                  {logicLabel(v)}
                </td>
              ))}
              <td>{row.ok ? "✓" : "✕"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
