// The inbox: what waits for a person, each item with its run's map and evidence beside it, so a
// decision is made with the proof in view. One key decides: `a` approves, `r` rejects, `s` sends
// the work back, and both of those take a note first. A question takes a typed answer and Enter.
// The decision is the command line's own command, started by the server: the run then goes on by
// itself. What the factory answered is said where the decision was made, by the task's name.
import { type KeyboardEvent as ReactKey, useEffect, useRef, useState } from "react";
import type { Decision, InboxItem } from "../core/views.ts";
import { op } from "./api.ts";
import { InboxNote } from "./InboxNote.tsx";
import { InboxRow } from "./InboxRow.tsx";
import { useRuns } from "./live.ts";
import { nextStop } from "./next-lane.ts";
import { Offline } from "./Offline.tsx";
import { DOING, DONE, HINT, type Said, typing, useDecidingKeyOutside, useTakesKeyboard } from "./outside.ts";
import { RunView } from "./RunDetail.tsx";
import { useWorkflows } from "./Runs.tsx";
import { go, openIn, usePath } from "./route.ts";
import { standing } from "./words.ts";
import "./runs.css";
import "./sections.css";

export function Inbox() {
  const { runs, live } = useRuns();
  const workflows = useWorkflows(runs);
  const [items, setItems] = useState<InboxItem[]>();
  // The item that was entered is in the address, by its run (`/inbox/<run>`). Until one is
  // entered, an item is only picked.
  const opened = openIn(usePath(), "/inbox");
  const [picked, setPicked] = useState<number>();
  const [noting, setNoting] = useState<"reject" | "send-back">(); // which decision the note box is for
  const [note, setNote] = useState("");
  const [fieldSaid, setFieldSaid] = useState<string>(); // what is wrong with the note, said at the note
  const [sending, setSending] = useState<Decision>();
  const [said, setSaid] = useState<Said>(); // what the factory answered to the last decision
  const rows = useRef(new Map<number, HTMLDivElement>());
  const head = useRef<HTMLHeadingElement>(null);
  const top = useRef<HTMLHeadingElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: on arrival only
  useEffect(() => {
    if (!opened) top.current?.focus();
  }, []);
  const box = useRef<HTMLTextAreaElement>(null);
  const bar = useRef<HTMLDivElement>(null); // the item's decision and proof: not displayed in the narrow list
  const decided = useRef<number>(undefined); // the item this page just decided on
  const lost = useRef(false); // the item on show was decided elsewhere: nothing is chosen until the person chooses
  const guard = useRef(0); // until when deciding rests, after the page itself moved to another item
  const moving = useRef(false); // the page itself is putting the keyboard on the next item
  const list = useRef(items); // the list as it is now, for an answer that comes back later
  list.current = items;

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
  const inside = opened !== undefined; // on a narrow screen the item is shown in place of the list
  const current = opened ? items?.find((i) => i.run === opened) : items?.find((i) => i.id === picked);
  const chosen = opened ? current?.id : picked;
  // What is on show changes only in ways the person can follow. After their own decision the page
  // moves to the next item, and deciding rests a moment so a second press does not land on it.
  // When the item was decided elsewhere, nothing is chosen: a key must never decide on what was
  // not read.
  useEffect(() => {
    if (!items) return;
    if (current) {
      // A decision of this page whose item has left, while the person had already moved to another,
      // is seen through: forgotten, so that an item that goes later is known to be someone else's doing.
      if (decided.current !== current.id && !items.some((i) => i.id === decided.current)) {
        decided.current = undefined;
      }
      return;
    }
    const shown = opened ? decided.current : chosen; // an entered item that is gone has no id any more
    if (shown === undefined && !opened) {
      if (!lost.current && items[0]) setPicked(items[0].id);
      return;
    }
    const mine = decided.current !== undefined && (opened !== undefined || decided.current === chosen);
    const next = mine ? items[0] : undefined;
    if (mine) guard.current = Date.now() + 600;
    else {
      lost.current = true;
      setSaid({
        text: "What you were looking at was decided elsewhere. Choose what to decide on next.",
        bad: false,
      });
    }
    decided.current = undefined;
    setPicked(next?.id);
    if (opened) go(next ? `/inbox/${next.run}` : "/inbox", true);
    requestAnimationFrame(() => {
      moving.current = true;
      const row = next && rows.current.get(next.id);
      // with the item in place of the list the row is not shown: its heading, or the page's, takes the keyboard
      (row?.getClientRects().length ? row : next ? head.current : opened ? top.current : null)?.focus();
      moving.current = false;
    });
  }, [items, current, chosen, opened]);
  /** The person chooses an item: by an arrow key, a click, or by moving the keyboard onto it. */
  const choose = (item: InboxItem) => {
    lost.current = false;
    // good news about another item has been read, once the person moves on by themselves
    if ((item.id !== current?.id || said?.text === HINT) && !said?.bad && !moving.current) setSaid(undefined);
    setPicked(item.id);
    if (opened) go(`/inbox/${item.run}`, true); // the address follows the item on show
  };
  // a note belongs to the item it was begun for
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when another item is chosen
  useEffect(() => {
    setNoting(undefined);
    setNote("");
    setFieldSaid(undefined);
  }, [current?.id]);
  const row = runs?.find((r) => r.id === current?.run);
  const question = current?.kind === "question";
  const next = current && nextStop(workflows[row?.workflow ?? ""], current);
  useTakesKeyboard(Boolean(opened && current && row), head);

  const decide = async (decision: Decision, words = "") => {
    // also for a button: a second press just as the page moved on must not land on the next item
    if (!current || sending || Date.now() < guard.current) return;
    setSending(decision);
    setFieldSaid(undefined);
    // known before the answer: the record may show the item gone first, and that is this page's doing
    decided.current = current.id;
    const { status, body } = await op<{ state?: string; run?: string }>("inbox_decide", {
      run: current.run,
      item: current.id, // the item that was on show: the decision is for it and for nothing the run waits on later
      decision,
      ...(words.trim() ? { note: words } : {}),
    });
    setSending(undefined);
    if (status === 200) {
      // what the pass route sets going, when it is known; a run that has stopped or been dropped since is said as it is
      const gone = body.state === "ended" && (body.run === "stopped" || body.run === "dropped");
      const after =
        next && !gone
          ? `${next[0]?.toUpperCase()}${next.slice(1)}.`
          : body.state === "going"
            ? "The run goes on."
            : "The run has moved on.";
      setSaid({ text: `${DONE[decision]}: ${current.task}. ${after}`, bad: false });
      setNoting(undefined);
      setNote("");
      // it leaves the list at once: the record will say the same in a moment
      setItems((now) => now?.filter((i) => i.id !== current.id));
    } else {
      // the factory refused: its own words, and what to do, about this task
      decided.current = undefined;
      setSaid({
        text: `Not ${DONE[decision].toLowerCase()}: ${current.task}. ${body.error ?? "The factory did not take the decision."}`,
        fix: body.fix,
        bad: true,
        // said at its item, or to the whole inbox when the item has left the list meanwhile
        item: list.current?.some((i) => i.id === current.id) ? current.id : undefined,
      });
    }
  };
  const ask = (decision: "reject" | "send-back") => {
    setNoting(decision);
    setFieldSaid(undefined);
    requestAnimationFrame(() => box.current?.focus());
  };
  const send = () => {
    if (question) return note.trim() ? decide("answer", note) : setFieldSaid("Type your answer first.");
    if (!noting) return;
    if (noting === "send-back" && !note.trim()) {
      return setFieldSaid("Say what the lane should do differently. Nothing was sent.");
    }
    decide(noting, note);
  };
  // The keys that decide, heard while the keyboard is in the inbox: on a row, or anywhere in the
  // decision and its proof (a click on the proof to read it keeps the keyboard there). Not from the
  // rest of the page: a key pressed with nothing chosen by the person must not decide. Not while
  // typing (letters in a note are letters), not with a modifier, not for a key held down.
  const onKey = (event: ReactKey) => {
    if (!current || typing(event.target) || event.metaKey || event.ctrlKey || event.altKey || event.repeat)
      return;
    if (!bar.current?.getClientRects().length) {
      if (!"ars".includes(event.key)) return;
      setSaid({ text: "Open the item first: Enter opens it.", bad: false });
      return event.preventDefault();
    }
    const can = (d: Decision) => current.decisions.includes(d);
    if (event.key === "a" && can("approve")) decide("approve");
    else if (event.key === "r" && can("reject")) ask("reject");
    else if (event.key === "s" && can("send-back")) ask("send-back");
    else if (event.key === "s" && can("approve")) {
      setSaid({
        text: "This lane has not run yet, so there is no work to send back. Approve it or reject it.",
        bad: true,
        item: current.id,
      });
    } else if (event.key === "a" && question) box.current?.focus();
    else return;
    event.preventDefault();
  };
  const onRowKey = (event: ReactKey, at: number) => {
    const list = items ?? [];
    const to = event.key === "ArrowDown" ? at + 1 : event.key === "ArrowUp" ? at - 1 : undefined;
    const next = to === undefined ? undefined : list[to];
    const here = list[at];
    if (next) {
      choose(next);
      rows.current.get(next.id)?.focus();
    } else if (event.key === "Enter" && here) {
      go(`/inbox/${here.run}`);
      requestAnimationFrame(() => (here.kind === "question" ? box.current : head.current)?.focus());
    } else if (to === undefined) return;
    event.preventDefault();
  };
  // A refusal is said in the decision bar of the item it is about. What went well is said above the
  // list, where the item was: inside the next item's bar it would read as being about that item.
  useDecidingKeyOutside(current !== undefined, () => setSaid({ text: HINT, bad: false }));
  const refusal = said?.bad && (said.item === undefined || said.item === current?.id);
  const answer =
    said && (said.bad ? refusal : true) ? (
      <p className={`said${said.bad ? " bad" : ""}`} role="status">
        {said.text}
        {said.fix ? ` ${said.fix}` : ""}
      </p>
    ) : null;
  const label = (decision: Decision, words: string) => (sending === decision ? DOING[decision] : words);

  return (
    <main className="work">
      <div className="topbar">
        <div className="where">
          <h1 tabIndex={-1} ref={top}>
            Inbox
          </h1>
          {items ? (
            <span>
              {items.length === 0
                ? "nothing waits"
                : `${items.length} ${items.length === 1 ? "waits" : "wait"} for you`}
            </span>
          ) : null}
        </div>
        <div className="group push">{live ? null : <Offline />}</div>
      </div>
      {!items ? (
        <div className="plain">
          <p>Reading the inbox.</p>
        </div>
      ) : items.length === 0 ? (
        <div className="plain">
          {answer}
          <p>Nothing waits for you.</p>
          <p>
            A run stops here when a lane's checkpoint asks for your approval, or when an agent has a question
            only you can answer.
          </p>
        </div>
      ) : (
        // biome-ignore lint/a11y/noStaticElementInteractions: the keys that decide work while the keyboard is in the inbox, and each is also a button
        <div className="runs inbox" data-inside={inside} onKeyDown={onKey}>
          <div className="listside">
            {said && !said.bad ? answer : null}
            <div className="runlist" role="listbox" aria-label="What waits for you">
              {items.map((item, at) => {
                const run = runs?.find((r) => r.id === item.run);
                return (
                  <InboxRow
                    key={item.id}
                    item={item}
                    run={run}
                    node={(node) => {
                      if (node) rows.current.set(item.id, node);
                      else rows.current.delete(item.id);
                    }}
                    selected={item.id === current?.id}
                    stop={item.id === (current?.id ?? items[0]?.id)}
                    onFocus={() => choose(item)}
                    onClick={() => {
                      choose(item);
                      go(`/inbox/${item.run}`);
                    }}
                    onKeyDown={(event) => onRowKey(event, at)}
                  />
                );
              })}
            </div>
          </div>
          {current ? (
            // it takes the keyboard when its text is clicked, so the deciding keys go on working while the proof is read
            <div className="deciding" tabIndex={-1} ref={bar}>
              <fieldset className="decide">
                <legend className="sr">Decide on {current.task}</legend>
                <p className="asks">
                  {question ? current.body : (row?.sentence ?? current.body)}
                  {next ? ` Approve: ${next.endsWith("starts") ? `${next} next` : next}.` : ""}
                </p>
                {question || noting ? (
                  <InboxNote
                    question={question}
                    noting={noting}
                    box={box}
                    note={note}
                    setNote={setNote}
                    fieldSaid={fieldSaid}
                    setFieldSaid={setFieldSaid}
                    send={send}
                    leave={() => {
                      setNoting(undefined);
                      rows.current.get(current.id)?.focus();
                    }}
                  />
                ) : null}
                <div className="choices">
                  {question ? (
                    <button
                      type="button"
                      className="button approve"
                      disabled={sending !== undefined}
                      onClick={send}
                    >
                      {label("answer", "Answer")}
                    </button>
                  ) : noting ? (
                    <>
                      <button
                        type="button"
                        className="button primary"
                        disabled={sending !== undefined}
                        onClick={send}
                      >
                        {label(noting, noting === "reject" ? "Reject" : "Send back")}
                      </button>
                      <button
                        type="button"
                        className="button"
                        onClick={() => {
                          setNoting(undefined);
                          rows.current.get(current.id)?.focus();
                        }}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="button approve"
                        disabled={sending !== undefined}
                        onClick={() => decide("approve")}
                      >
                        {sending === "approve" ? (
                          DOING.approve
                        ) : (
                          <>
                            Approve <kbd>a</kbd>
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        className="button"
                        disabled={sending !== undefined}
                        onClick={() => ask("reject")}
                      >
                        Reject <kbd>r</kbd>
                      </button>
                      {current.decisions.includes("send-back") ? (
                        <button
                          type="button"
                          className="button"
                          disabled={sending !== undefined}
                          onClick={() => ask("send-back")}
                        >
                          Send back <kbd>s</kbd>
                        </button>
                      ) : null}
                    </>
                  )}
                </div>
                {said?.bad ? answer : null}
              </fieldset>
              {row ? (
                <RunView
                  key={row.id}
                  row={row}
                  workflow={workflows[row.workflow]}
                  headRef={head}
                  back="Inbox"
                  deciding
                  lead={current}
                  onBack={() => {
                    setPicked(current.id);
                    go("/inbox", true); // in place of the item's address: Back does not enter it again
                    requestAnimationFrame(() => rows.current.get(current.id)?.focus());
                  }}
                />
              ) : null}
            </div>
          ) : (
            <div className="plain">
              {said?.bad ? answer : null}
              <p>Choose what to decide on.</p>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
