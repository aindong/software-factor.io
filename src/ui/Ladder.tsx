// The autonomy ladder at a lane: where it stands, the record it has earned its next step with,
// and the last move. The factory only suggests a step up. The person takes it here, with a
// button, and the workflow's file changes. A step back (after a defect got through) is made from
// the command line, and is shown here when it has happened.
import { useEffect, useState } from "react";
import { op } from "./api.ts";

type Mode = "in" | "near" | "out";
interface LadderLane {
  lane: string;
  checkpoint: Mode;
  streak: number;
  needed: number;
  suggestion: Mode | null;
  why: string | null;
  last: { kind: string; to: Mode | null; at: string; note: string; run: string | null } | null;
}
const STANDS: Record<Mode, string> = { in: "in the loop", near: "near the loop", out: "out of the loop" };

function lastWords(last: NonNullable<LadderLane["last"]>): string {
  const to = STANDS[last.to ?? "in"];
  const day = new Date(last.at).toLocaleDateString("sv-SE"); // the person's own day, as year-month-day
  if (last.kind === "promoted") return `Moved ${to} on ${day}.`;
  if (last.kind === "demoted")
    return `Moved back ${to} on ${day}, after a defect got through in run ${last.run}: ${last.note}`;
  if (last.kind === "outside")
    return `Set ${to} outside the ladder, seen on ${day}: its record starts again.`;
  return `A defect got through in run ${last.run} on ${day}: ${last.note}`;
}

export function Ladder(props: {
  lane: string;
  /** The floor holds changes that are not saved: a move would be made on a file the floor is about to write over. */
  dirty: boolean;
  /** Changes when the workflow's file does: the record is read again. */
  stamp: string | undefined;
  onMoved: () => void;
}) {
  const [lanes, setLanes] = useState<LadderLane[]>();
  const [refused, setRefused] = useState<string>();
  const [busy, setBusy] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the stamp and the lane stand for "read it again"
  useEffect(() => {
    let left = false;
    op<{ lanes: LadderLane[] }>("ladder_list").then(({ status, body }) => {
      if (!left && status === 200) setLanes(body.lanes);
    });
    return () => {
      left = true;
    };
  }, [props.lane, props.stamp]);
  const l = lanes?.find((x) => x.lane === props.lane);
  if (!l) return null; // a lane the file does not hold yet has no record
  const step = l.suggestion;
  const accept = async () => {
    setBusy(true);
    const { status, body } = await op<{ lane: string }>("ladder_accept", { lane: l.lane });
    setBusy(false);
    setRefused(status === 200 ? undefined : `Not moved: ${body.error ?? "the factory refused it"}`);
    if (status === 200) props.onMoved();
  };
  return (
    <div className="ladder">
      <p className="note">
        {l.checkpoint === "out" && !l.why
          ? "Out of the loop: there is no further step."
          : `${l.streak} of ${l.needed} runs in a row ${l.checkpoint === "in" ? "approved as they were" : "with nothing found later"}.`}
        {step
          ? ` Its record has earned a step: it can move ${STANDS[step]}.`
          : l.why
            ? ` It stays here: ${l.why}.`
            : ""}
      </p>
      {l.last ? <p className="note">{lastWords(l.last)}</p> : null}
      {step ? (
        <>
          <button type="button" className="button" disabled={props.dirty || busy} onClick={accept}>
            {busy ? "Moving" : `Move ${STANDS[step]}`}
          </button>
          {props.dirty ? (
            <p className="note">Save or revert first: the move changes the workflow's file.</p>
          ) : null}
        </>
      ) : null}
      {refused ? (
        <p className="hint bad" role="status">
          {refused}
        </p>
      ) : null}
    </div>
  );
}
