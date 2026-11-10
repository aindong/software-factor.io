// The factory floor: the workflow as a line diagram or as its JSON, with the inspector beside it.
// One document is behind both views, so a change in either shows in the other. The checker runs
// on every change, here in the page: it is the same code the command line runs.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addLane, connect, hadConditions } from "../core/floor/edit.ts";
import { drawable, layout } from "../core/floor/layout.ts";
import { parseWorkflow } from "../core/schema/parse.ts";
import { getWorkflow, getWorkspace, type Json, saveWorkflow, type WorkspaceInfo } from "./api.ts";
import { Diagram } from "./Diagram.tsx";
import { Inspector } from "./Inspector.tsx";
import { statusOf } from "./status.ts";

const print = (doc: Json) => `${JSON.stringify(doc, null, 2)}\n`;

export function Floor() {
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
  const headRef = useRef<HTMLHeadingElement>(null);
  const connectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    getWorkspace().then(({ body }) => {
      setWorkspace(body);
      setName(body.workflow);
    });
  }, []);
  const load = useCallback((which: string) => {
    getWorkflow(which).then(({ body }) => {
      const loaded = body.workflow ?? {};
      setDoc(loaded);
      setText(print(loaded));
      setSaved(print(loaded));
      setBroken(body.workflow ? undefined : body.problems[0]?.message);
      setSelected(undefined);
      setNotice(undefined);
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
  const dirty = doc !== undefined && print(doc) !== saved;
  const canSave = dirty && problems.length === 0 && !broken;

  /** A change made on the map or in the inspector: the JSON view follows. */
  const change = (next: Json) => {
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
      setNotice({ text: "Saved.", bad: false });
    } else {
      // the server refused: say why, though the workflow is still not saved
      const why =
        status === 401
          ? "this tab's key is no longer good: open the address the command printed"
          : (body.problems?.[0]?.message ?? "the server refused it");
      setNotice({ text: `Not saved: ${why}`, bad: true });
    }
  }, [name, doc, canSave]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "s") {
        event.preventDefault();
        save();
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
    const before = new Set(((doc.lanes as { id: string }[] | undefined) ?? []).map((l) => l.id));
    const next = addLane(doc, { after: before.has(selected ?? "") ? selected : undefined, kind });
    change(next);
    const added = (next.lanes as { id: string }[]).find((l) => !before.has(l.id));
    if (added) open(added.id);
  };

  const status = statusOf({ broken, problems: problems.length, dirty, notice });
  return (
    <main className="work">
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
            >
              {workspace.workflows.map((w) => (
                <option key={w}>{w}</option>
              ))}
            </select>
          ) : (
            <span className="code">{name}</span>
          )}
        </div>
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
          <button type="button" className="button" disabled={!dirty} onClick={() => name && load(name)}>
            Revert
          </button>
          <button type="button" className="button primary" disabled={!canSave} onClick={save}>
            Save
          </button>
        </div>
      </div>
      <div className="floor">
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
                  onSelect={setSelected}
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
                        text: `The conditions on ${from}.${outcome} were replaced. Revert brings them back.`,
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
              <p className="broken" role="alert">
                This is not JSON yet, so the diagram shows the last version that was: {broken}
              </p>
            ) : null}
          </div>
        )}
        {doc ? (
          <Inspector
            doc={doc}
            selected={selected}
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
