// The inbox: what waits for a person, each item with its run's map and evidence beside it, so a
// decision is made with the proof in view. One key decides: `a` approves, `r` rejects, `s` sends
// the work back, and both of those take a note first. A question takes a typed answer and Enter.
// The decision is the command line's own command, started by the server: the run then goes on by
// itself, and the item leaves the list when the record says so.
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import type { Decision, InboxItem } from "../core/views.ts";
import { op } from "./api.ts";
import { useRuns } from "./live.ts";
import { RunView } from "./RunDetail.tsx";
import { useWorkflows } from "./Runs.tsx";
import { standing } from "./words.ts";
import "./runs.css";
import "./sections.css";

const DONE: Record<Decision, string> = {
  approve: "Approved.",
  reject: "Rejected.",
  "send-back": "Sent back.",
  answer: "Answered.",
};
const typing = (target: EventTarget) =>
  target instanceof HTMLTextAreaElement ||
  target instanceof HTMLInputElement ||
  target instanceof HTMLSelectElement;

export function Inbox() {
  const { runs, live } = useRuns();
  const workflows = useWorkflows(runs);
  const [items, setItems] = useState<InboxItem[]>();
  const [chosen, setChosen] = useState<number>();
  const [inside, setInside] = useState(false);
  const [noting, setNoting] = useState<"reject" | "send-back">(); // which decision the note box is for
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; fix?: string; bad: boolean }>();
  const rows = useRef(new Map<number, HTMLDivElement>());
  const head = useRef<HTMLHeadingElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const decided = useRef<number>(undefined); // the item this page just decided on
  const lost = useRef(false); // the item on show was decided elsewhere: nothing is chosen until the person chooses
  const guard = useRef(0); // until when the deciding keys rest, after the page itself moved to another item

  // the list changes when a run starts or stops waiting: ask again whenever those runs change
  const waiting = (runs ?? [])
    .filter((r) => standing(r).mark === "asked")
    .map((r) => `${r.id}:${r.at}:${r.visits.length}`)
    .join(" ");
  // biome-ignore lint/correctness/useExhaustiveDependencies: asked again when the waiting runs change
  useEffect(() => {
    let left = false;
    op<{ items: InboxItem[] }>("inbox_list").then(({ status, body }) => {
      if (!left && status === 200) setItems(body.items);
    });
    return () => {
      left = true;
    };
  }, [waiting]);
  const current = items?.find((i) => i.id === chosen);
  // What is on show changes only in ways the person can follow. After their own decision the page
  // moves to the next item, and the keys rest a moment so a second tap does not land on it. When
  // the item was decided elsewhere, nothing is chosen: a key must never decide on what was not read.
  useEffect(() => {
    if (!items || (chosen !== undefined && items.some((i) => i.id === chosen))) return;
    if (chosen === undefined) {
      if (!lost.current && items[0]) setChosen(items[0].id);
    } else if (decided.current === chosen) {
      const next = items[0];
      guard.current = Date.now() + 600;
      setChosen(next?.id);
      requestAnimationFrame(() => next && rows.current.get(next.id)?.focus());
    } else {
      lost.current = true;
      setChosen(undefined);
      setNotice({
        text: "What you were looking at was decided elsewhere. Choose what to decide on next.",
        bad: false,
      });
    }
  }, [items, chosen]);
  const choose = (id: number) => {
    lost.current = false;
    setChosen(id);
  };
  // a note belongs to the item it was begun for
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when another item is chosen
  useEffect(() => {
    setNoting(undefined);
    setNote("");
  }, [current?.id]);
  const row = runs?.find((r) => r.id === current?.run);
  const question = current?.kind === "question";

  const decide = async (decision: Decision, words = "") => {
    if (!current || busy) return;
    setBusy(true);
    const { status, body } = await op<{ state?: string }>("inbox_decide", {
      run: current.run,
      item: current.id, // the item that was on show: the decision is for it and for nothing the run waits on later
      decision,
      ...(words.trim() ? { note: words } : {}),
    });
    setBusy(false);
    if (status === 200) {
      setNotice({
        text: `${DONE[decision]} ${body.state === "going" ? "The run goes on." : "The run has moved on."}`,
        bad: false,
      });
      setNoting(undefined);
      setNote("");
      // it leaves the list at once: the record will say the same in a moment
      decided.current = current.id;
      setItems((items ?? []).filter((i) => i.id !== current.id));
    } else {
      // the factory refused: its own words, and what to do
      setNotice({ text: body.error ?? "The factory did not take the decision.", fix: body.fix, bad: true });
    }
  };
  const ask = (decision: "reject" | "send-back") => {
    setNoting(decision);
    setNotice(undefined);
    requestAnimationFrame(() => box.current?.focus());
  };
  const send = () => {
    if (question)
      return note.trim() ? decide("answer", note) : setNotice({ text: "Type your answer first.", bad: true });
    if (!noting) return;
    if (noting === "send-back" && !note.trim()) {
      return setNotice({ text: "Say what the lane should do differently. Nothing was sent.", bad: true });
    }
    decide(noting, note);
  };
  /** The keys that decide. Not while typing: letters in a note are letters. */
  const onKey = (event: KeyboardEvent) => {
    if (!current || typing(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
    // a key held down, or pressed again just as the page moved on, decides nothing
    if (event.repeat || Date.now() < guard.current) return;
    const can = (d: Decision) => current.decisions.includes(d);
    if (event.key === "a" && can("approve")) decide("approve");
    else if (event.key === "r" && can("reject")) ask("reject");
    else if (event.key === "s" && can("send-back")) ask("send-back");
    else if (event.key === "s" && can("approve")) {
      setNotice({
        text: "This lane has not run yet, so there is no work to send back. Approve it or reject it.",
        bad: true,
      });
    } else if (event.key === "a" && question) box.current?.focus();
    else return;
    event.preventDefault();
  };
  const onRowKey = (event: KeyboardEvent, at: number) => {
    const list = items ?? [];
    const to = event.key === "ArrowDown" ? at + 1 : event.key === "ArrowUp" ? at - 1 : undefined;
    const next = to === undefined ? undefined : list[to];
    if (next) {
      choose(next.id);
      rows.current.get(next.id)?.focus();
    } else if (event.key === "Enter") {
      setInside(true);
      requestAnimationFrame(() => (question ? box.current : head.current)?.focus());
    } else if (to === undefined) return;
    event.preventDefault();
  };

  return (
    <main className="work">
      <div className="topbar">
        <div className="where">
          <h1>Inbox</h1>
          {items ? (
            <span>
              {items.length === 0
                ? "nothing waits"
                : `${items.length} ${items.length === 1 ? "waits" : "wait"} for you`}
            </span>
          ) : null}
        </div>
        <div className="group push">
          <span className={`status${notice?.bad || !live ? " bad" : ""}`} role="status">
            {live
              ? notice
                ? `${notice.text}${notice.fix ? ` ${notice.fix}` : ""}`
                : ""
              : "Not connected to the factory. Trying again."}
          </span>
        </div>
      </div>
      {!items ? (
        <div className="plain">
          <p>Reading the inbox.</p>
        </div>
      ) : items.length === 0 ? (
        <div className="plain">
          <p>Nothing waits for you.</p>
          <p>
            A run stops here when a lane's checkpoint asks for your approval, or when an agent has a question
            only you can answer.
          </p>
        </div>
      ) : (
        // biome-ignore lint/a11y/noStaticElementInteractions: the keys that decide work anywhere in the inbox, and each is also a button
        <div className="runs" data-inside={inside} onKeyDown={onKey}>
          <div className="runlist" role="listbox" aria-label="What waits for you">
            {items.map((item, at) => (
              <div
                key={item.id}
                ref={(node) => {
                  if (node) rows.current.set(item.id, node);
                  else rows.current.delete(item.id);
                }}
                role="option"
                className="run"
                aria-selected={item.id === current?.id}
                tabIndex={item.id === (current?.id ?? items[0]?.id) ? 0 : -1}
                onFocus={() => choose(item.id)}
                onClick={() => {
                  choose(item.id);
                  setInside(true);
                }}
                onKeyDown={(event) => onRowKey(event, at)}
              >
                <span
                  className="mark asked"
                  role="img"
                  aria-label={item.kind === "question" ? "A question" : "An approval"}
                />
                <span className="task">{item.task}</span>
                <span className="when data">{item.kind === "question" ? "question" : "approval"}</span>
                <span className="sentence">
                  {item.kind === "question"
                    ? item.body
                    : (runs?.find((r) => r.id === item.run)?.sentence ?? item.body)}
                </span>
              </div>
            ))}
          </div>
          {current ? (
            <div className="deciding">
              <fieldset className="decide">
                <legend className="sr">Decide on {current.task}</legend>
                <p className="asks">{question ? current.body : current.body || "Approval"}</p>
                {question || noting ? (
                  <label className="field">
                    <span className="label">
                      {question
                        ? "Your answer"
                        : noting === "reject"
                          ? "Why (optional)"
                          : "What should change"}
                    </span>
                    <textarea
                      ref={box}
                      rows={2}
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.nativeEvent.isComposing) return; // Enter that ends a composition is not "send"
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          send();
                        } else if (event.key === "Escape" && !question) {
                          setNoting(undefined);
                          rows.current.get(current.id)?.focus();
                        }
                      }}
                    />
                    <span className="hint">
                      Enter sends. Shift and Enter makes a new line.{question ? "" : " Escape leaves it."}
                    </span>
                  </label>
                ) : null}
                <div className="choices">
                  {question ? (
                    <button type="button" className="button approve" disabled={busy} onClick={send}>
                      Answer
                    </button>
                  ) : noting ? (
                    <button type="button" className="button approve" disabled={busy} onClick={send}>
                      {noting === "reject" ? "Reject" : "Send back"}
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="button approve"
                        disabled={busy}
                        onClick={() => decide("approve")}
                      >
                        Approve <kbd>a</kbd>
                      </button>
                      <button type="button" className="button" disabled={busy} onClick={() => ask("reject")}>
                        Reject <kbd>r</kbd>
                      </button>
                      {current.decisions.includes("send-back") ? (
                        <button
                          type="button"
                          className="button"
                          disabled={busy}
                          onClick={() => ask("send-back")}
                        >
                          Send back <kbd>s</kbd>
                        </button>
                      ) : null}
                    </>
                  )}
                </div>
              </fieldset>
              {row ? (
                <RunView
                  key={row.id}
                  row={row}
                  workflow={workflows[row.workflow]}
                  headRef={head}
                  back="Inbox"
                  deciding
                  onBack={() => {
                    setInside(false);
                    requestAnimationFrame(() => rows.current.get(current.id)?.focus());
                  }}
                />
              ) : null}
            </div>
          ) : (
            <div className="plain">
              <p>Choose what to decide on.</p>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
