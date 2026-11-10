// The factory floor: the workflow as a line diagram or as its JSON, with the inspector beside it.
// One document is behind both views, so a change in either shows in the other. The checker runs
// on every change, here in the page: it is the same code the command line runs.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addLane, connect, hadConditions } from "../core/floor/edit.ts";
import { drawable, layout } from "../core/floor/layout.ts";
import { parseWorkflow } from "../core/schema/parse.ts";
import { forgetKey, getWorkflow, getWorkspace, type Json, saveWorkflow, type WorkspaceInfo } from "./api.ts";
import { Diagram } from "./Diagram.tsx";
import { Inspector } from "./Inspector.tsx";
import { useRuns } from "./live.ts";
import { go } from "./route.ts";
import { statusOf } from "./status.ts";

const print = (doc: Json) => `${JSON.stringify(doc, null, 2)}\n`;

export function Floor({ shown, onUnsaved }: { shown: boolean; onUnsaved: (unsaved: boolean) => void }) {
  const [workspace, setWorkspace] = useState<WorkspaceInfo>();
  const [name, setName] = useState<string>();
  const [doc, setDoc] = useState<Json>();
  const [text, setText] = useState("");
  const [broken, setBroken] = useState<string>();
  const [saved, setSaved] = useState("");
  const [view, setView] = useState<"diagram" | "json">("diagram");
  const [selected, setSelected] = useState<string>();
  const [sheet, setSheet] = useState(false);
  const [notice, setNotice] = useState<{ text: string; bad: boolean }>();
  const [onMap, setOnMap] = useState(true);
  const { runs } = useRuns();
  const headRef = useRef<HTMLHeadingElement>(null);
  const connectRef = useRef<HTMLSelectElement>(null);
  // undo: every document the floor has held since it was read, and those taken back
  const [past, setPast] = useState<Json[]>([]);
  const [future, setFuture] = useState<Json[]>([]);
  const typed = useRef(false);

  useEffect(() => {
    getWorkspace().then(({ status, body }) => {
      if (status === 401) forgetKey();
      if (status !== 200) return;
      setWorkspace(body);
      setName(body.workflow);
    });
  }, []);
  const load = useCallback((which: string) => {
    getWorkflow(which).then(({ status, body }) => {
      const loaded = (status === 200 && body.workflow) || {};
      setDoc(loaded);
      setText(print(loaded));
      setSaved(print(loaded));
      const why = status === 200 ? body.problems[0]?.message : (body.error ?? "It could not be read.");
      setBroken(status === 200 && body.workflow ? undefined : why);
      setSelected(undefined);
      setNotice(undefined);
      // what is read is where undo begins
      setPast([]);
      setFuture([]);
      typed.current = false;
    });
  }, []);
  useEffect(() => {
    if (name) load(name);
  }, [name, load]);

  const problems = useMemo(() => (doc ? parseWorkflow(doc).problems : []), [doc]);
  const floor = useMemo(() => {
    const workflow = drawable(doc);
    return workflow ? layout(workflow) : undefined;
  }, [doc]);
  const flagged = useMemo(() => {
    const lanes = (Array.isArray(doc?.lanes) ? doc.lanes : []) as { id?: string }[];
    return new Set(
      problems.flatMap((p) => lanes[Number(/^lanes\[(\d+)\]/.exec(p.path)?.[1] ?? -1)]?.id ?? []),
    );
  }, [doc, problems]);
  // text that does not parse is a change too, though the document behind it is the last that did
  const dirty = broken ? text !== saved : doc !== undefined && print(doc) !== saved;
  const canSave = dirty && problems.length === 0 && !broken;

  // Undo: every document the floor has held since it was read, and those taken back. A run of
  // typing in the JSON view is one step.
  const keep = () => {
    if (doc) setPast((before) => [...before.slice(-99), doc]);
    setFuture([]);
  };
  const show = (to: Json) => {
    setDoc(to);
    setText(print(to));
    setBroken(undefined);
    setNotice(undefined);
    typed.current = false;
  };
  const undo = () => {
    const to = past.at(-1);
    if (!to || !doc) return;
    setPast(past.slice(0, -1));
    setFuture([...future, doc]);
    show(to);
  };
  const redo = () => {
    const to = future.at(-1);
    if (!to || !doc) return;
    setFuture(future.slice(0, -1));
    setPast([...past, doc]);
    show(to);
  };
  const [discarding, setDiscarding] = useState(false); // Revert asks first when more than one change would go
  // the keys reach the latest undo and redo without being bound again at every change
  const steps = useRef({ undo, redo, shown });
  steps.current = { undo, redo, shown };

  /** A change made on the map or in the inspector: the JSON view follows. */
  const change = (next: Json) => {
    keep();
    typed.current = false;
    setDoc(next);
    setText(print(next));
    setBroken(undefined);
    setNotice(undefined);
  };
  /** A change typed in the JSON view: the map follows as soon as the text is JSON again. */
  const type = (value: string) => {
    setText(value);
    setNotice(undefined);
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
        throw new Error("A workflow is a JSON object.");
      if (!typed.current) keep(); // the document as it was when the typing began
      typed.current = true;
      setDoc(parsed as Json);
      setBroken(undefined);
    } catch (error) {
      setBroken((error as Error).message);
    }
  };
  const save = useCallback(async () => {
    if (!name || !doc || !canSave) return;
    const { status, body } = await saveWorkflow(name, doc);
    if (status === 200) {
      setSaved(print(doc));
      setNotice({ text: "Saved", bad: false });
    } else {
      // the server refused: say why, though the workflow is still not saved
      const why =
        status === 401
          ? "this tab's key is no longer good: open the address the command printed"
          : (body.problems?.[0]?.message ?? body.error ?? "the server refused it");
      setNotice({ text: `Not saved: ${why}`, bad: true });
    }
  }, [name, doc, canSave]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || !steps.current.shown) return; // kept aside, the floor takes no key
      if (event.key === "s") {
        event.preventDefault();
        save();
      } else if (
        event.key.toLowerCase() === "z" &&
        !(event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement)
      ) {
        // in a text field the key is the field's own undo
        event.preventDefault();
        if (event.shiftKey) steps.current.redo();
        else steps.current.undo();
      }
    };
    const onLeave = (event: BeforeUnloadEvent) => dirty && event.preventDefault();
    addEventListener("keydown", onKey);
    addEventListener("beforeunload", onLeave);
    return () => {
      removeEventListener("keydown", onKey);
      removeEventListener("beforeunload", onLeave);
    };
  }, [save, dirty]);

  const open = (id: string) => {
    setSelected(id);
    setSheet(true);
    requestAnimationFrame(() => headRef.current?.focus());
  };
  const add = (kind: "agent" | "command" | "wait") => {
    if (!doc) return;
    const before = new Set(floor?.stations.map((s) => s.id));
    const next = addLane(doc, { after: before.has(selected ?? "") ? selected : undefined, kind });
    change(next);
    const added = (next.lanes as { id: string }[]).find((l) => !before.has(l.id));
    if (added) open(added.id);
  };

  // the runs of this workflow that are moving or waiting, each as a train at its lane
  const trains = (onMap ? (runs ?? []) : [])
    .filter((r) => (r.status === "running" || r.status === "waiting") && r.workflow === name && r.at)
    .map((r) => ({
      lane: r.at ?? "",
      label: String(r.taskId),
      title: `${r.task}. ${r.sentence}`,
      asks: r.stopCode === "awaiting_approval" || r.stopCode === "needs_person",
      // a train leads to its run, and to the inbox when the run waits for a person
      href: `${r.stopCode === "awaiting_approval" || r.stopCode === "needs_person" ? "/inbox" : "/runs"}/${r.id}`,
    }));
  const status = statusOf({ broken, problems: problems.length, dirty, notice });
  useEffect(() => onUnsaved(dirty), [dirty, onUnsaved]);
  return (
    <main className="work" hidden={!shown}>
      <div className="topbar">
        <div className="where">
          <h1>Floor</h1>
          <span>{workspace?.name}</span>
          {workspace && workspace.workflows.length > 1 ? (
            <select
              aria-label="Workflow"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={dirty}
              title={dirty ? "Save or revert before changing to another workflow" : undefined}
            >
              {workspace.workflows.map((w) => (
                <option key={w}>{w}</option>
              ))}
            </select>
          ) : (
            <span className="code">{name}</span>
          )}
        </div>
        <button
          type="button"
          className="button narrow-only"
          onClick={() => {
            setSelected(undefined);
            setSheet(true);
            requestAnimationFrame(() => headRef.current?.focus());
          }}
        >
          Workflow settings
        </button>
        <fieldset className="segmented">
          <legend className="sr">View</legend>
          <button type="button" aria-pressed={view === "diagram"} onClick={() => setView("diagram")}>
            Diagram
          </button>
          <button type="button" aria-pressed={view === "json"} onClick={() => setView("json")}>
            JSON
          </button>
        </fieldset>
        {view === "diagram" ? (
          <label className="check">
            <input type="checkbox" checked={onMap} onChange={(event) => setOnMap(event.target.checked)} />
            Runs on map
          </label>
        ) : null}
        {view === "diagram" ? (
          <div className="group">
            <span className="label">Add a lane</span>
            <button type="button" className="button" onClick={() => add("agent")}>
              Agent
            </button>
            <button type="button" className="button" onClick={() => add("command")}>
              Command
            </button>
            <button type="button" className="button" onClick={() => add("wait")}>
              Wait
            </button>
          </div>
        ) : null}
        <div className="group push">
          <span className={`status${status.bad ? " bad" : ""}`} role="status">
            {status.text}
          </span>
          <button
            type="button"
            className="button"
            disabled={past.length === 0}
            onClick={undo}
            title="Undo: Ctrl or Cmd and Z"
          >
            Undo
          </button>
          {discarding ? (
            <>
              <span className="status bad">Discard {past.length} changes?</span>
              <button
                type="button"
                className="button"
                onClick={() => {
                  setDiscarding(false);
                  if (name) load(name);
                }}
              >
                Discard
              </button>
              <button type="button" className="button" onClick={() => setDiscarding(false)}>
                Keep
              </button>
            </>
          ) : (
            <button
              type="button"
              className="button"
              disabled={!dirty}
              // one change is undone as easily as it was made: more than one is asked about first
              onClick={() => (past.length > 1 ? setDiscarding(true) : name && load(name))}
            >
              Revert
            </button>
          )}
          <button type="button" className="button primary" disabled={!canSave} onClick={save}>
            Save
          </button>
        </div>
      </div>
      <div className="floor" data-sheet={sheet}>
        {view === "diagram" ? (
          <div className="map-side">
            {broken ? (
              <p className="broken" role="alert">
                The text in the JSON view is not JSON, so this is the last version that was. A change made
                here replaces that text.
              </p>
            ) : null}
            <div className="map-scroll">
              {floor ? (
                <Diagram
                  floor={floor}
                  selected={selected}
                  flagged={flagged}
                  trains={trains}
                  onGo={go}
                  onSelect={setSelected}
                  // where the inspector is a sheet, a click or a tap on a station opens it
                  onPick={(id) => (matchMedia("(max-width: 1000px)").matches ? open(id) : setSelected(id))}
                  onOpen={open}
                  onAskConnect={(id) => {
                    setSelected(id);
                    setSheet(true);
                    requestAnimationFrame(() => connectRef.current?.focus());
                  }}
                  onConnect={(from, outcome, to) => {
                    if (!doc) return;
                    const replaced = hadConditions(doc, from, outcome);
                    change(connect(doc, from, outcome, to));
                    // a drag gives no chance to read a warning first: say what it did
                    if (replaced)
                      setNotice({
                        text: `The conditions on ${from}.${outcome} were replaced. Undo brings them back.`,
                        bad: false,
                      });
                  }}
                />
              ) : (
                <div className="plain">
                  <p>
                    {doc
                      ? "This workflow has no lane to draw yet. Add one, or write it in the JSON view."
                      : "Reading the workflow."}
                  </p>
                </div>
              )}
            </div>
            <div className="legend">
              <span>
                <i className="pass" />
                passes
              </span>
              <span>
                <i className="fail" />
                fails
              </span>
              <span>
                <i className="asks" />
                asks a person
              </span>
              <span>
                <i className="end" />
                ends the run
              </span>
              <span>
                <i className="cond" />
                only on a condition
              </span>
              <span>
                <i className="capsule" />a person approves here
              </span>
              <span>
                <i className="bar" />a gate
              </span>
              <span>×2: goes back at most twice</span>
              <span>
                <kbd>←</kbd> <kbd>→</kbd> move, <kbd>Enter</kbd> open, <kbd>c</kbd> connect
              </span>
            </div>
          </div>
        ) : (
          <div className="json">
            <textarea
              aria-label="The workflow as JSON"
              spellCheck={false}
              value={text}
              onChange={(event) => type(event.target.value)}
            />
            {broken ? (
              // said once when the text stops being JSON: the parser's own words change at every key and are not read out
              <div className="broken">
                <p role="status">This is not JSON yet, so the diagram shows the last version that was.</p>
                <p className="quiet code">{broken}</p>
              </div>
            ) : null}
          </div>
        )}
        {doc ? (
          <Inspector
            doc={doc}
            // a station the JSON view has since renamed or removed is no longer selected
            selected={floor?.stations.some((s) => s.id === selected && !s.missing) ? selected : undefined}
            problems={problems}
            open={sheet}
            headRef={headRef}
            connectRef={connectRef}
            onChange={change}
            onSelect={setSelected}
            onClose={() => setSheet(false)}
          />
        ) : null}
      </div>
    </main>
  );
}
