// What an agent printed in one session, read as an account: what it said, each tool it used as one
// line, the first lines of what came back, and the end with what it cost. The lines as the CLI
// printed them are one button away. All of it is the agent's text, shown as text.
import { useMemo, useState } from "react";
import { account, type Out, type Step } from "../core/runs/transcript.ts";
import { Text, useFile, Waiting } from "./Evidence.tsx";
import { tokens } from "./words.ts";

const SHOWN = 3; // lines of a result before the rest is folded

function Result({ out }: { out: Out }) {
  const [all, setAll] = useState(false);
  const rest = out.lines.length - SHOWN + out.more;
  const shown = all ? out.lines : out.lines.slice(0, SHOWN);
  return (
    <>
      <pre className="out code">{shown.join("\n") || "(no output)"}</pre>
      {rest > 0 && !all ? (
        <button type="button" className="more" aria-expanded="false" onClick={() => setAll(true)}>
          {rest} more {rest === 1 ? "line" : "lines"}
        </button>
      ) : null}
      {all && out.more > 0 ? <p className="quiet">{out.more} more lines are in the raw lines.</p> : null}
    </>
  );
}

function StepView({ step }: { step: Step }) {
  if (step.kind === "said") return <p className="said">{step.text}</p>;
  if (step.kind === "plain") return <p className="plain-line code">{step.text}</p>;
  if (step.kind === "end") {
    const used = [
      step.tokens ? tokens(step.tokens) : "",
      step.usd === undefined ? "" : `$${step.usd.toFixed(2)}`,
    ].filter(Boolean);
    return (
      <p className="end">
        <strong>{step.error ? "Ended with an error" : "Finished"}</strong>
        {step.text ? `: ${step.text}` : ""}
        {used.length > 0 ? <span className="quiet data"> {used.join(", ")}</span> : null}
      </p>
    );
  }
  return (
    <div className={step.out?.error ? "call failed" : "call"}>
      <div className="head">
        <span className="tool code">{step.tool}</span>
        <code className="arg">{step.arg}</code>
        {step.out?.error ? (
          <span className="failure">
            <span className="mark fail" aria-hidden="true" /> failed
          </span>
        ) : null}
      </div>
      {step.out ? <Result out={step.out} /> : null}
    </div>
  );
}

export function TranscriptView({ runId, path }: { runId: string; path: string }) {
  const loaded = useFile(runId, path, true);
  const [raw, setRaw] = useState(false);
  const got = useMemo(() => (loaded.state === "here" ? account(loaded.text) : undefined), [loaded]);
  if (loaded.state !== "here" || !got) return <Waiting loaded={loaded} />;
  return (
    <>
      <fieldset className="views">
        <legend className="sr">How to read it</legend>
        <button type="button" className="button" aria-pressed={!raw} onClick={() => setRaw(false)}>
          What it did
        </button>
        <button type="button" className="button" aria-pressed={raw} onClick={() => setRaw(true)}>
          The lines as printed
        </button>
      </fieldset>
      {raw ? (
        <Text text={loaded.text} />
      ) : (
        <>
          <ol className="account">
            {got.steps.map((step, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: the steps of one session never move
              <li key={i}>
                <StepView step={step} />
              </li>
            ))}
          </ol>
          {got.steps.length === 0 ? <p className="quiet">Nothing was printed.</p> : null}
          {got.hidden > 0 ? (
            <p className="quiet">
              Only the first {got.steps.length} steps are shown; {got.hidden} more are in the lines as
              printed.
            </p>
          ) : null}
          {got.quiet > 0 ? (
            <p className="quiet">
              {got.quiet} hook and bookkeeping {got.quiet === 1 ? "event" : "events"} left out.
            </p>
          ) : null}
        </>
      )}
    </>
  );
}
