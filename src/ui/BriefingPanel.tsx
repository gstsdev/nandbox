// The teaching half of the app: the lesson for the current challenge, its
// on-demand hints and solution, and — for real challenges — the "Check" button
// and the resulting truth table.

import { useState } from "react";
import {
  CHALLENGES,
  challengeInputs,
  challengeOutputs,
  getChallenge,
} from "../challenges";
import type { Challenge } from "../challenges";
import type { VerifyResult } from "../challenges/verify";
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
        {challenge.hints && challenge.hints.length > 0 && (
          <HintsSection challenge={challenge} key={challenge.id} />
        )}
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

/**
 * Progressive hints plus a last-resort solution. The reveal state is local;
 * the caller passes `key={challenge.id}` so switching challenges remounts this
 * and clears what was revealed.
 */
function HintsSection({ challenge }: { challenge: Challenge }) {
  const hints = challenge.hints ?? [];
  const [revealed, setRevealed] = useState(0);
  const [showSolution, setShowSolution] = useState(false);

  return (
    <section className="briefing-section hints">
      <h3>Hints</h3>
      {hints.slice(0, revealed).map((h, i) => (
        <div className="hint" key={i}>
          <span className="hint-tag">Hint {i + 1}</span>
          <p>{h}</p>
        </div>
      ))}

      {revealed < hints.length ? (
        <button
          type="button"
          className="hint-btn"
          onClick={() => setRevealed((n) => n + 1)}
        >
          {revealed === 0 ? "Show a hint" : "Show another hint"}
          <span className="hint-count">
            {revealed}/{hints.length}
          </span>
        </button>
      ) : (
        !showSolution &&
        challenge.solution && (
          <button
            type="button"
            className="hint-link"
            onClick={() => setShowSolution(true)}
          >
            Still stuck? Show the solution
          </button>
        )
      )}

      {showSolution && challenge.solution && (
        <div className="solution">
          <span className="hint-tag">Solution</span>
          <p>{challenge.solution}</p>
        </div>
      )}
    </section>
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

const valLabel = (v: number | null): string => (v === null ? "X" : String(v));

function VerifySummary({
  result,
  challenge,
}: {
  result: VerifyResult;
  challenge: Challenge;
}) {
  const inNames = challengeInputs(challenge).map((t) => t.name);
  const outNames = challengeOutputs(challenge).map((t) => t.name);

  if (result.ok) {
    const how =
      result.mode === "exhaustive"
        ? `every combination (${result.tested})`
        : `${result.tested} sampled cases`;
    return <p className="verify-msg is-ok">Passed — checked {how}.</p>;
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
  const inParts = inNames.map((n, i) => `${n}=${row.inputs[i]}`).join(", ");
  const wantParts = outNames.map((n, i) => `${n}=${row.expected[i]}`).join(", ");
  const gotParts = outNames.map((n, i) => `${n}=${valLabel(row.actual[i])}`).join(", ");
  return (
    <p className="verify-msg is-bad">
      Fails when {inParts}: expected {wantParts}, got {gotParts}.
    </p>
  );
}

/** Truth table with a pass/fail marker per row; long sampled runs show failures only. */
function TruthTable({
  result,
  challenge,
}: {
  result: VerifyResult;
  challenge: Challenge;
}) {
  const inNames = challengeInputs(challenge).map((t) => t.name);
  const outNames = challengeOutputs(challenge).map((t) => t.name);

  const fails = result.rows.filter((r) => !r.ok);
  const shown =
    result.rows.length <= 20
      ? result.rows
      : (fails.length > 0 ? fails : result.rows).slice(0, 16);
  const omitted = result.rows.length - shown.length;

  return (
    <div className="truth-wrap">
      <table className="truth">
        <thead>
          <tr>
            {inNames.map((n) => (
              <th key={n}>{n}</th>
            ))}
            <th className="sep" />
            {outNames.map((n) => (
              <th key={n}>{n}</th>
            ))}
            <th />
          </tr>
        </thead>
        <tbody>
          {shown.map((row, i) => (
            <tr key={i} className={row.ok ? "" : "is-bad"}>
              {row.inputs.map((b, j) => (
                <td key={j}>{b}</td>
              ))}
              <td className="sep" />
              {row.actual.map((v, j) => (
                <td key={j} className={v !== row.expected[j] ? "is-wrong" : ""}>
                  {valLabel(v)}
                </td>
              ))}
              <td>{row.ok ? "✓" : "✕"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {omitted > 0 && <p className="truth-more">…and {omitted} more rows</p>}
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
