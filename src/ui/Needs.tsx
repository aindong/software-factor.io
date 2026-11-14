// One quiet line in the Floor's top bar: how many runs of the whole workspace wait for the person and
// how many stopped, each a link to where they are. A count of none is left out, and with both none there is no line.
import { withShow } from "./filter.ts";
import { useRuns } from "./live.ts";
import { go } from "./route.ts";
import { standing } from "./words.ts";

export function Needs() {
  const live = useRuns();
  const { runs = [], queued } = live;
  const waits = runs.filter((r) => standing(r).mark === "asked").length;
  const stopped = runs.filter((r) => r.status === "stopped").length;
  const link = (to: string, text: string, asked = false) => (
    <a
      key={text}
      href={to}
      onClick={(event) => {
        event.preventDefault();
        go(to);
      }}
    >
      {asked ? <span className="mark asked" aria-hidden="true" /> : null}
      {text}
    </a>
  );
  const working = runs.some((r) => r.status === "running");
  // nothing queued, waiting, working or stopped: say so where the counts are, so that an empty bar is not a bar that did not load
  if (waits + stopped + queued.length === 0)
    return working || !live.runs ? null : <p className="needs idle">Nothing queued, nothing waiting.</p>;
  const parts = [
    waits > 0 ? link("/inbox", `${waits} ${waits === 1 ? "waits" : "wait"} for you`, true) : null,
    stopped > 0 ? link(withShow("/runs", "stopped"), `${stopped} stopped`) : null,
    // not a link: the strip under the map lists them
    queued.length > 0 ? `${queued.length} queued` : null,
  ].filter((part) => part !== null);
  return (
    <p className="needs">
      {parts.map((part, i) => (
        <span key={typeof part === "string" ? part : part.key}>
          {i > 0 ? " · " : null}
          {part}
        </span>
      ))}
    </p>
  );
}
