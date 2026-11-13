// One quiet line in the Floor's top bar: how many runs of the whole workspace wait for the person and
// how many stopped, each a link to where they are. A count of none is left out, and with both none there is no line.
import { withShow } from "./filter.ts";
import { useRuns } from "./live.ts";
import { go } from "./route.ts";
import { standing } from "./words.ts";

export function Needs() {
  const runs = useRuns().runs ?? [];
  const waits = runs.filter((r) => standing(r).mark === "asked").length;
  const stopped = runs.filter((r) => r.status === "stopped").length;
  const link = (to: string, text: string) => (
    <a
      href={to}
      onClick={(event) => {
        event.preventDefault();
        go(to);
      }}
    >
      {text}
    </a>
  );
  if (waits + stopped === 0) return null;
  return (
    <p className="needs">
      {waits > 0 ? link("/inbox", `${waits} ${waits === 1 ? "waits" : "wait"} for you`) : null}
      {waits > 0 && stopped > 0 ? " · " : null}
      {stopped > 0 ? link(withShow("/runs", "stopped"), `${stopped} stopped`) : null}
    </p>
  );
}
