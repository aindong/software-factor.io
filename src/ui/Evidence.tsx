// The evidence viewer: one piece of proof behind a button, shown in place when it is opened.
// Output and hand-offs as text, the run's diff, a screenshot, a before and after side by side, a
// recording. A file comes from the server with the page's token and is shown from memory. What
// an agent attached is only ever text, a picture or a video here: never markup the page runs.
import { type ReactNode, useEffect, useState } from "react";
import { kindOf } from "../core/runs/track.ts";
import { getDiff, getFile } from "./api.ts";

const MOST_TEXT = 400_000;
const MOST_LINES = 5000;

export function Proof(props: {
  open: boolean;
  onToggle: () => void;
  label: string;
  meta?: string;
  mark?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="proof">
      <button type="button" aria-expanded={props.open} onClick={props.onToggle}>
        <svg className="caret" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M3 1.500l4 3.500-4 3.500" />
        </svg>
        {props.mark}
        <span className="what">{props.label}</span>
        {props.meta ? <span className="meta data">{props.meta}</span> : null}
      </button>
      {props.open ? <div className="shown">{props.children}</div> : null}
    </div>
  );
}

type Loaded =
  | { state: "reading" }
  | { state: "gone" }
  | { state: "large" }
  | { state: "here"; url: string; text: string };

/** A file of the run, read once: as text for text, as an address in memory for the rest. */
function useFile(runId: string, path: string, asText: boolean): Loaded {
  const [loaded, setLoaded] = useState<Loaded>({ state: "reading" });
  useEffect(() => {
    let url = "";
    let left = false;
    setLoaded({ state: "reading" });
    getFile(runId, path).then(async (blob) => {
      if (left) return;
      if (!blob) return setLoaded({ state: "gone" });
      if (blob === "too large") return setLoaded({ state: "large" });
      if (asText) return setLoaded({ state: "here", url: "", text: await blob.text() });
      url = URL.createObjectURL(blob);
      setLoaded({ state: "here", url, text: "" });
    });
    return () => {
      left = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [runId, path, asText]);
  return loaded;
}
const Waiting = ({ loaded }: { loaded: Loaded }) => (
  <p className="quiet">
    {loaded.state === "reading"
      ? "Reading."
      : loaded.state === "large"
        ? "This file is too large to show here. It is in the run's folder under .factor/runs."
        : "This file is no longer in the run's folder."}
  </p>
);
const Text = ({ text }: { text: string }) => (
  <>
    <pre className="output">{text.slice(0, MOST_TEXT) || "(empty)"}</pre>
    {text.length > MOST_TEXT ? <p className="quiet">Only the first part is shown.</p> : null}
  </>
);

export function FileView({ runId, path, name }: { runId: string; path: string; name: string }) {
  const kind = kindOf(name);
  const loaded = useFile(runId, path, kind === "text");
  if (loaded.state !== "here") return <Waiting loaded={loaded} />;
  if (kind === "text") return <Text text={loaded.text} />;
  if (kind === "image") return <img className="shot" src={loaded.url} alt={name} />;
  if (kind === "recording") {
    return (
      // biome-ignore lint/a11y/useMediaCaption: a recording of a screen has no speech to caption
      <video className="shot" src={loaded.url} controls preload="metadata" aria-label={`Recording ${name}`} />
    );
  }
  return (
    <p>
      <a href={loaded.url} download={name}>
        Save {name}
      </a>{" "}
      <span className="quiet">It is not a kind of file this page shows.</span>
    </p>
  );
}

function Side({ runId, path, name, word }: { runId: string; path: string; name: string; word: string }) {
  const loaded = useFile(runId, path, false);
  return (
    <figure>
      <figcaption className="label">{word}</figcaption>
      {loaded.state === "here" ? (
        <img className="shot" src={loaded.url} alt={`${word}: ${name}`} />
      ) : (
        <Waiting loaded={loaded} />
      )}
    </figure>
  );
}
export function PairView(props: {
  runId: string;
  before: { path: string; name: string };
  after: { path: string; name: string };
}) {
  return (
    <div className="pair-shots">
      <Side runId={props.runId} {...props.before} word="Before" />
      <Side runId={props.runId} {...props.after} word="After" />
    </div>
  );
}

const lineKind = (line: string) =>
  line.startsWith("diff --git") || line.startsWith("+++") || line.startsWith("---")
    ? "file"
    : line.startsWith("@@")
      ? "hunk"
      : line.startsWith("+")
        ? "add"
        : line.startsWith("-")
          ? "del"
          : "same";

/** The run's diff. A line taken out is struck through, not hidden: nothing disappears, it cancels. */
export function DiffView({ runId, stamp }: { runId: string; stamp: string }) {
  const [diff, setDiff] = useState<{ text: string; changed: string[]; note?: string }>();
  // biome-ignore lint/correctness/useExhaustiveDependencies: the stamp changes when the run does, and the diff is read again
  useEffect(() => {
    let left = false;
    getDiff(runId).then(({ body }) => {
      if (left) return;
      const cut = body.cut ? "The diff is long: only its first part is shown." : undefined;
      setDiff({ text: body.diff ?? "", changed: body.changed ?? [], note: body.note ?? body.error ?? cut });
    });
    return () => {
      left = true;
    };
  }, [runId, stamp]);
  if (!diff) return <p className="quiet">Reading.</p>;
  const lines = diff.text.split("\n");
  return (
    <>
      {diff.note ? <p className="quiet">{diff.note}</p> : null}
      {diff.changed.length > 0 ? (
        <ul className="changed code" aria-label="Files this run changed">
          {diff.changed.map((line) => (
            <li key={line}>{line.replace("\t", "  ")}</li>
          ))}
        </ul>
      ) : null}
      {diff.text ? (
        <pre className="output diff">
          {lines.slice(0, MOST_LINES).map((line, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: the lines of one diff never move
            <span key={i} className={lineKind(line)}>
              {line}
              {"\n"}
            </span>
          ))}
        </pre>
      ) : diff.note ? null : (
        <p className="quiet">This run changed no file.</p>
      )}
      {lines.length > MOST_LINES ? (
        <p className="quiet">Only the first {MOST_LINES} lines are shown.</p>
      ) : null}
    </>
  );
}
