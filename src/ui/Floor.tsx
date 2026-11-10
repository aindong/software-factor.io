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
import { Ladder } from "./Ladder.tsx";
import { AddLane, caretToLane, Legend, trainsOf } from "./Legend.tsx";
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
  const field = useRef<{ at: Element | null; when: number }>({ at: null, when: 0 }); // the text field last typed in
  const [ahead, setAhead] = useState(0); // how many steps the floor is from the workflow as read or saved: under 0 after undo
  // the version of the file this copy began from: a save names it, so a change made elsewhere is not saved over
  const [version, setVersion] = useState<string>();
  // the version a save was refused for: the file as it is elsewhere, which "Save over it" names and no other
  const [theirs, setTheirs] = useState<string>();
  const reading = useRef(false); // a read of the file is out
  const saving = useRef(false); // a save is out: a second one would be refused by the first's own write
  const area = useRef<HTMLTextAreaElement>(null);
  const stay = useRef(false); // the next read keeps the selection

  useEffect(() => {
    getWorkspace().then(({ status, body }) => {
      if (status === 401) forgetKey();
      if (status !== 200) return;
      setWorkspace(body);
      setName(body.workflow);
    });
  }, []);
  type Read = Awaited<ReturnType<typeof getWorkflow>>;
  const take = useCallback(({ status, body }: Read) => {
    const loaded = (status === 200 && body.workflow) || {};
    setDoc(loaded);
    setText(print(loaded));
    setSaved(print(loaded));
    const why = status === 200 ? body.problems[0]?.message : (body.error ?? "It could not be read.");
    setBroken(status === 200 && body.workflow ? undefined : why);
    // a move on the ladder reads the file again with the lane still open
    if (!stay.current) setSelected(undefined);
    stay.current = false;
    setNotice(undefined);
    // what is read is where undo begins
    setPast([]);
    setFuture([]);
    setAhead(0);
    setVersion(body.version);
    setTheirs(undefined);
    typed.current = false;
    field.current = { at: null, when: 0 };
  }, []);
  const load = useCallback(
    (which: string) => {
      reading.current = true;
      getWorkflow(which).then((answer) => {
        reading.current = false;
        take(answer);
      });
    },
    [take],
  );
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
    setAhead((n) => Math.abs(n) + 1); // after undo past the saved point, the steps back count as changes too
  };
  const show = (to: Json) => {
    setDoc(to);
    setText(print(to));
    setBroken(undefined);
    setNotice(undefined);
    typed.current = false;
    field.current = { at: null, when: 0 };
  };
  const undo = () => {
    const to = past.at(-1);
    if (!to || !doc) return;
    setPast(past.slice(0, -1));
    setFuture([...future, doc]);
    setAhead((n) => n - 1);
    show(to);
  };
  const redo = () => {
    const to = future.at(-1);
    if (!to || !doc) return;
    setFuture(future.slice(0, -1));
    setPast([...past, doc]);
    setAhead((n) => n + 1);
    show(to);
  };
  const [discarding, setDiscarding] = useState(false); // Revert asks first when more than one change would go
  const unsavedSteps = Math.abs(ahead); // the changes since the workflow was read or saved
  // the question is about the changes there were when it was asked: with none left it is not asked
  useEffect(() => {
    if (!dirty) setDiscarding(false);
  }, [dirty]);
  // the keys reach the latest undo and redo without being bound again at every change
  const steps = useRef({ undo, redo, shown });
  steps.current = { undo, redo, shown };

  /** A change made on the map or in the inspector: the JSON view follows. */
  const change = (next: Json) => {
    // Typing in one text field of the inspector is one step, as a run of typing in the JSON view
    // is: a step for every letter would push the workflow as it was read out of what undo holds.
    const on = document.activeElement;
    const words =
      on instanceof HTMLTextAreaElement ||
      (on instanceof HTMLInputElement && on.type !== "checkbox" && on.type !== "radio");
    const same = words && on === field.current.at && Date.now() - field.current.when < 5000;
    if (!same) keep();
    field.current = { at: words ? on : null, when: Date.now() };
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
  const save = useCallback(
    async (over = false) => {
      if (!name || !doc || !canSave || saving.current) return;
      saving.current = true;
      // saving over names the version that was refused: a file changed again since then is not written over unseen
      const { status, body } = await saveWorkflow(name, doc, over ? theirs : version).finally(() => {
        saving.current = false;
      });
      if (status === 200) {
        setSaved(print(doc));
        setAhead(0);
        setVersion(body.version);
        setTheirs(undefined);
        setNotice({ text: "Saved", bad: false });
        field.current = { at: null, when: 0 }; // typing after a save is a new step
        typed.current = false;
        return;
      }
      if (status === 409 && body.version) {
        // the file is not the one this copy began from: nothing was written, and the person chooses
        setTheirs(body.version);
        setNotice({
          text: "Not saved: the workflow's file was changed since this copy of it was read. Reading it again drops the changes made here.",
          bad: true,
        });
        return;
      }
      // the server refused: say why, though the workflow is still not saved
      const why =
        status === 401
          ? "this tab's key is no longer good: open the address the command printed"
          : (body.problems?.[0]?.message ?? body.error ?? "the server refused it");
      setNotice({ text: `Not saved: ${why}`, bad: true });
    },
    [name, doc, canSave, version, theirs],
  );
  // While the floor holds no change of its own, it follows the file: when the floor is shown again
  // and when the window is come back to, a file changed elsewhere is read again.
  const now = useRef({ dirty, version });
  now.current = { dirty, version };
  useEffect(() => {
    if (!shown || !name) return;
    const look = () => {
      if (now.current.dirty || reading.current) return;
      getWorkflow(name).then((answer) => {
        // what was read is taken at once, if the floor still holds no change: a second read would leave a gap
        const changed = answer.status === 200 && answer.body.version !== now.current.version;
        if (changed && !now.current.dirty && !reading.current && !saving.current) take(answer);
      });
    };
    look();
    addEventListener("focus", look);
    return () => removeEventListener("focus", look);
  }, [shown, name, take]);

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

  /** A problem chosen while the JSON view is up leads to its lane in the text, where it is mended. */
  const choose = (id: string | undefined) => {
    setSelected(id);
    if (id && view === "json" && area.current) caretToLane(area.current, text, id);
  };
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

  const trains = onMap ? trainsOf(runs ?? [], name) : [];
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
        {view === "diagram" ? <AddLane onAdd={add} /> : null}
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
          {theirs ? (
            // the file changed elsewhere since this copy was read: nothing is written until the person chooses
            <>
              <button type="button" className="button" onClick={() => name && load(name)}>
                Read the file again
              </button>
              <button type="button" className="button" disabled={!canSave} onClick={() => save(true)}>
                Save over it
              </button>
            </>
          ) : discarding && dirty ? (
            <>
              <span className="status bad">Discard {unsavedSteps} changes?</span>
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
              onClick={() => (unsavedSteps > 1 ? setDiscarding(true) : name && load(name))}
            >
              Revert
            </button>
          )}
          {/* while the file is changed elsewhere, the two choices beside it are the ways on */}
          <button
            type="button"
            className="button primary"
            disabled={!canSave || theirs !== undefined}
            onClick={() => save()}
          >
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
            <Legend />
          </div>
        ) : (
          <div className="json">
            <textarea
              ref={area}
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
            onSelect={choose}
            onClose={() => setSheet(false)}
            ladder={
              name !== workspace?.workflow
                ? undefined
                : (lane) => (
                    <Ladder
                      lane={lane}
                      dirty={dirty}
                      stamp={version}
                      onMoved={() => {
                        stay.current = true;
                        if (name) load(name);
                      }}
                    />
                  )
            }
          />
        ) : null}
      </div>
    </main>
  );
}
