// The inspector: what is selected, with its settings as standard controls. With a lane selected,
// its settings, its gates and where each outcome leads. With nothing selected, the workflow itself.
import { type ReactNode, type RefObject, useEffect, useState } from "react";
import { connect, END_TARGETS, removeLane, renameLane, updateLane } from "../core/floor/edit.ts";
import type { Problem } from "../core/schema/parse.ts";
import type { Json } from "./api.ts";
import { WholeNumber } from "./Fields.tsx";

type LaneJson = Json & { id: string };
const OUTCOMES = [
  { key: "pass", word: "Passes" },
  { key: "fail", word: "Fails" },
  { key: "needsPerson", word: "Asks" },
] as const;
const CHECKPOINT: Record<string, string> = {
  in: "In the loop: a person approves before the run goes on.",
  near: "Near the loop: the run goes on, and a person is told.",
  out: "Out of the loop: the run goes on by itself.",
};
const END_NAME: Record<string, string> = {
  "@done": "Done",
  "@inbox": "Inbox (a person)",
  "@stop": "Stopped",
  "@drop": "Dropped",
};
const record = (v: unknown): Json =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Json) : {};
const text = (v: unknown) => (typeof v === "string" ? v : "");
/** The document's lanes, each at its own place. JSON can hold anything there: what is no object is left empty. */
const lanesIn = (doc: Json) =>
  (Array.isArray(doc.lanes) ? doc.lanes : []).map((l) =>
    typeof l === "object" && l !== null ? (l as LaneJson) : undefined,
  );

function Field(props: { label: string; hint?: string; bad?: boolean; children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is the child passed in
    <label className="field">
      <span className="label">{props.label}</span>
      {props.children}
      {props.hint ? <span className={`hint${props.bad ? " bad" : ""}`}>{props.hint}</span> : null}
    </label>
  );
}
/** A condition of a transition, in words. */
const whenWords = (when: unknown) => {
  const { ref, in: among } = record(when);
  return typeof ref === "string" && Array.isArray(among)
    ? `if ${ref} is ${among.length === 1 ? "" : "one of "}${among.join(", ")}`
    : `if ${JSON.stringify(when)}`;
};
function Choice(props: {
  label: string;
  value: string;
  options: [string, string][];
  hint?: string;
  onChange: (v: string) => void;
}) {
  return (
    <Field label={props.label} hint={props.hint}>
      <select value={props.value} onChange={(event) => props.onChange(event.target.value)}>
        {props.options.map(([value, name]) => (
          <option key={value} value={value}>
            {name}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function Problems({
  problems,
  laneAt,
  onSelect,
}: {
  problems: Problem[];
  laneAt: (path: string) => string | undefined;
  onSelect: (id: string) => void;
}) {
  if (problems.length === 0) return null;
  return (
    <section aria-label="Problems">
      <h2>{problems.length === 1 ? "1 problem" : `${problems.length} problems`}</h2>
      <ul className="problems">
        {problems.map((p) => {
          const lane = laneAt(p.path);
          return (
            <li key={`${p.path} ${p.message}`}>
              {lane ? (
                <button type="button" className="code" onClick={() => onSelect(lane)}>
                  {p.path}
                </button>
              ) : (
                <span className="code">{p.path}</span>
              )}
              <span>{p.message}</span>
              <span className="fix">{p.fix}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function LaneForm({
  doc,
  lane,
  connectRef,
  onChange,
  onSelect,
}: {
  doc: Json;
  lane: LaneJson;
  connectRef: RefObject<HTMLSelectElement | null>;
  onChange: (doc: Json) => void;
  onSelect: (id: string | undefined) => void;
}) {
  const [id, setId] = useState(lane.id);
  const [refused, setRefused] = useState(false);
  const [removing, setRemoving] = useState(false);
  useEffect(() => {
    setId(lane.id);
    setRefused(false);
    setRemoving(false);
  }, [lane.id]);

  const lanes = lanesIn(doc).filter((l) => l !== undefined);
  const set = (patch: Json) => onChange(updateLane(doc, lane.id, patch));
  const agent = record(lane.agent);
  const settings = record(lane.with);
  const on = record(lane.on);
  const kind = text(lane.uses);
  const gates = Object.keys(record(doc.gates));
  const mine = Array.isArray(lane.gates) ? (lane.gates as string[]) : [];
  const commit = () => {
    if (id === lane.id) return setRefused(false);
    const next = renameLane(doc, lane.id, id);
    setRefused(next === doc);
    if (next !== doc) {
      onChange(next);
      onSelect(id);
    }
  };
  const targets: [string, string][] = [
    ["", "(not set)"],
    ...lanes.map((l): [string, string] => [
      l.id,
      l.id === lane.id ? `${l.id} (this lane again)` : text(l.name) || l.id,
    ]),
    ...END_TARGETS.map((e): [string, string] => [e, END_NAME[e] ?? e]),
  ];

  return (
    <>
      <section>
        <Field
          label="Id"
          bad={refused}
          hint={
            refused
              ? `Not taken: "${id}" is another lane's id, or is not small letters, digits and -. The lane is still ${lane.id}.`
              : "Other lanes point at this lane by its id."
          }
        >
          <input
            value={id}
            spellCheck={false}
            aria-invalid={refused}
            onChange={(event) => {
              setId(event.target.value);
              setRefused(false); // the refusal was about what was tried, not about what is being typed now
            }}
            onBlur={commit}
            onKeyDown={(event) => event.key === "Enter" && commit()}
          />
        </Field>
        <Field label="Name">
          <input
            value={text(lane.name)}
            placeholder={lane.id}
            onChange={(event) => set({ name: event.target.value || undefined })}
          />
        </Field>
        <Choice
          label="Checkpoint"
          value={text(lane.checkpoint)}
          hint={CHECKPOINT[text(lane.checkpoint)]}
          options={[
            ["in", "In the loop"],
            ["near", "Near the loop"],
            ["out", "Out of the loop"],
          ]}
          onChange={(v) => set({ checkpoint: v })}
        />
      </section>

      {kind === "core/agent@1" ? (
        <section>
          <h2>Agent</h2>
          <div className="pair">
            <Choice
              label="Role"
              value={text(agent.role)}
              options={Object.keys(record(doc.roles)).map((r): [string, string] => [r, r])}
              onChange={(v) => set({ agent: { role: v } })}
            />
            <Choice
              label="May change files"
              value={text(agent.access)}
              options={[
                ["read", "No, it only reads"],
                ["write", "Yes, it writes"],
              ]}
              onChange={(v) => set({ agent: { access: v } })}
            />
            <Choice
              label="Model size"
              value={text(agent.tier)}
              options={[
                ["", "The role's default"],
                ["small", "Small"],
                ["medium", "Medium"],
                ["large", "Large"],
              ]}
              onChange={(v) => set({ agent: { tier: v || undefined } })}
            />
            <Choice
              label="Effort"
              value={text(agent.effort)}
              options={[
                ["", "The role's default"],
                ["low", "Low"],
                ["medium", "Medium"],
                ["high", "High"],
                ["max", "Max"],
              ]}
              onChange={(v) => set({ agent: { effort: v || undefined } })}
            />
          </div>
          {typeof agent.prompt === "string" ? (
            <Field label="Instructions">
              <textarea
                value={agent.prompt}
                placeholder="Say what this lane must do, and what it hands off."
                onChange={(event) => set({ agent: { prompt: event.target.value } })}
              />
            </Field>
          ) : (
            <Field label="Instructions" hint="Kept in a file beside the workflow.">
              <input readOnly value={text(record(agent.prompt).file)} />
            </Field>
          )}
          {lane.panel ? (
            <p className="note">This lane is worked by a panel. Its members are in the JSON view.</p>
          ) : null}
        </section>
      ) : null}
      {kind === "core/command@1" ? (
        <section>
          <h2>Command</h2>
          <Choice
            label="A command of this project"
            value={text(settings.command)}
            hint="Named in the workflow, defined in .factor/factory.json."
            options={[
              ["", "(none)"],
              ...Object.keys(record(doc.commands)).map((c): [string, string] => [c, c]),
            ]}
            onChange={(v) =>
              set({ with: { ...settings, command: v || undefined, run: v ? undefined : settings.run } })
            }
          />
          <Field label="Or a shell command" hint="Give one of the two.">
            <input
              className="code"
              value={text(settings.run)}
              spellCheck={false}
              onChange={(event) =>
                set({
                  with: {
                    ...settings,
                    run: event.target.value || undefined,
                    command: event.target.value ? undefined : settings.command,
                  },
                })
              }
            />
          </Field>
        </section>
      ) : null}
      {kind === "core/wait@1" && typeof settings.minutes === "number" ? (
        <section>
          <h2>Wait</h2>
          <WholeNumber
            label="Minutes"
            value={settings.minutes}
            onCommit={(minutes) => set({ with: { ...settings, minutes } })}
          />
        </section>
      ) : null}

      <section>
        <h2>Where it goes</h2>
        {OUTCOMES.map(({ key, word }, i) => {
          const transition = on[key];
          const steps =
            typeof transition === "string"
              ? [{ to: transition }]
              : Array.isArray(transition)
                ? (transition as { to: string; when?: unknown; maxRounds?: number }[])
                : [];
          const main = steps.find((s) => s.maxRounds !== undefined) ?? steps.at(-1);
          const conditional = steps.some((s) => s.when !== undefined);
          return (
            <div key={key}>
              <label className={`route ${key}`}>
                <span className="label">{word}</span>
                <select
                  ref={i === 0 ? connectRef : undefined}
                  aria-label={`When this lane ${word.toLowerCase()}, go to`}
                  value={main?.to ?? ""}
                  onChange={(event) => {
                    const to = event.target.value;
                    if (to) onChange(connect(doc, lane.id, key, to));
                    else
                      onChange(
                        updateLane(doc, lane.id, {
                          on: Object.fromEntries(Object.entries(on).filter(([k]) => k !== key)),
                        }),
                      );
                  }}
                >
                  {targets.map(([value, name]) => (
                    <option key={value} value={value}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              {main?.maxRounds ? (
                <p className="note">
                  It goes back at most {main.maxRounds === 1 ? "once" : `${main.maxRounds} times`}, then
                  stops.
                </p>
              ) : null}
              {conditional ? (
                // every way this outcome can go, in the order they are tried
                <>
                  <ol className="ways note">
                    {steps.map((step) => (
                      <li key={JSON.stringify(step)}>
                        to{" "}
                        {/* text that is JSON but not yet a workflow can lead anywhere: it is shown, not trusted */}
                        {typeof step.to !== "string"
                          ? JSON.stringify(step.to)
                          : lanes.find((l) => l.id === step.to)?.name?.toString() ||
                            END_NAME[step.to] ||
                            step.to}{" "}
                        {step.when === undefined ? "otherwise" : whenWords(step.when)}
                      </li>
                    ))}
                  </ol>
                  <p className="note">
                    Conditions are edited in the JSON view. Choosing above replaces them.
                  </p>
                </>
              ) : null}
            </div>
          );
        })}
      </section>

      <section>
        <h2>Gates</h2>
        {gates.length === 0 ? (
          <p className="note">This workflow declares no gates. Add them in the JSON view.</p>
        ) : null}
        {gates.map((gate) => (
          <label key={gate} className="check">
            <input
              type="checkbox"
              checked={mine.includes(gate)}
              onChange={(event) => {
                const next = event.target.checked ? [...mine, gate] : mine.filter((g) => g !== gate);
                set({ gates: next.length > 0 ? next : undefined });
              }}
            />
            <span>{gate}</span>
            <span className="note code">{text(record(record(doc.gates)[gate]).uses)}</span>
          </label>
        ))}
      </section>

      <section>
        <div className="row">
          {removing ? (
            <>
              <span>Remove this lane?</span>
              <button
                type="button"
                className="button primary"
                onClick={() => {
                  onChange(removeLane(doc, lane.id));
                  onSelect(undefined);
                }}
              >
                Remove
              </button>
              <button type="button" className="button" onClick={() => setRemoving(false)}>
                Keep
              </button>
            </>
          ) : (
            <button
              type="button"
              className="button"
              disabled={lanes.length <= 1}
              onClick={() => setRemoving(true)}
            >
              Remove lane
            </button>
          )}
        </div>
        {lanes.length <= 1 ? <p className="note">A workflow keeps at least one lane.</p> : null}
      </section>
    </>
  );
}

export interface InspectorProps {
  doc: Json;
  selected?: string;
  problems: Problem[];
  open: boolean;
  headRef: RefObject<HTMLHeadingElement | null>;
  connectRef: RefObject<HTMLSelectElement | null>;
  onChange: (doc: Json) => void;
  onSelect: (id: string | undefined) => void;
  onClose: () => void;
}

export function Inspector({
  doc,
  selected,
  problems,
  open,
  headRef,
  connectRef,
  onChange,
  onSelect,
  onClose,
}: InspectorProps) {
  const lanes = lanesIn(doc);
  const lane = lanes.find((l) => l?.id === selected);
  const laneAt = (path: string) => lanes[Number(/^lanes\[(\d+)\]/.exec(path)?.[1] ?? -1)]?.id;
  const elsewhere = lane ? problems.filter((p) => laneAt(p.path) !== lane.id).length : 0;
  const limits = record(doc.limits);
  return (
    <aside className="inspector" aria-label="Inspector" data-open={open}>
      <header>
        <h2 ref={headRef} tabIndex={-1}>
          {lane ? `Lane ${text(lane.name) || lane.id}` : selected ? selected : "Workflow"}
        </h2>
        <button type="button" className="button close" onClick={onClose}>
          Close
        </button>
      </header>
      <Problems
        problems={lane ? problems.filter((p) => laneAt(p.path) === lane.id) : problems}
        laneAt={laneAt}
        onSelect={onSelect}
      />
      {elsewhere > 0 ? (
        // the status line counts every problem: the ones that are not this lane's are one key away
        <p className="elsewhere">
          <button type="button" onClick={() => onSelect(undefined)}>
            {elsewhere} {elsewhere === 1 ? "problem" : "problems"} elsewhere in the workflow
          </button>
        </p>
      ) : null}
      {lane ? (
        <LaneForm doc={doc} lane={lane} connectRef={connectRef} onChange={onChange} onSelect={onSelect} />
      ) : selected ? (
        <section>
          <p>A run that reaches this station ends here.</p>
          <p className="note">Choose a lane to change where its outcomes lead.</p>
        </section>
      ) : (
        <>
          <section>
            <Field label="What this workflow is for">
              <textarea
                value={text(doc.description)}
                onChange={(event) => onChange({ ...doc, description: event.target.value })}
              />
            </Field>
            <div className="pair">
              <WholeNumber
                label="Minutes for one run"
                value={Number(limits.minutes) || undefined}
                onCommit={(minutes) => onChange({ ...doc, limits: { ...limits, minutes } })}
              />
              <WholeNumber
                label="Tokens for one run"
                value={Number(limits.tokens) || undefined}
                onCommit={(tokens) => onChange({ ...doc, limits: { ...limits, tokens } })}
              />
            </div>
          </section>
          <section>
            <dl className="data">
              <dt>Lanes</dt>
              <dd>{lanes.length}</dd>
              <dt>Roles</dt>
              <dd>{Object.keys(record(doc.roles)).join(", ") || "none"}</dd>
              <dt>Gates</dt>
              <dd>{Object.keys(record(doc.gates)).join(", ") || "none"}</dd>
              <dt>Tasks from</dt>
              <dd>
                {(Array.isArray(doc.collectors) ? doc.collectors : [])
                  .map((c) => text(record(c).uses))
                  .join(", ") || "nowhere yet"}
              </dd>
            </dl>
            <p className="note">Roles, gates, collectors and conditions are edited in the JSON view.</p>
          </section>
        </>
      )}
    </aside>
  );
}
