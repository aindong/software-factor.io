// One row of the inbox's list: the item's mark, its task, its kind and the sentence under them.
import type { KeyboardEvent as ReactKey, Ref } from "react";
import type { InboxItem } from "../core/views.ts";
import type { RunRow } from "./api.ts";
import { lead } from "./words.ts";

export function InboxRow({
  item,
  run,
  node,
  selected,
  stop,
  onFocus,
  onClick,
  onKeyDown,
}: {
  item: InboxItem;
  run: RunRow | undefined;
  node: Ref<HTMLDivElement>;
  selected: boolean;
  stop: boolean;
  onFocus: () => void;
  onClick: () => void;
  onKeyDown: (event: ReactKey) => void;
}) {
  return (
    <div
      ref={node}
      role="option"
      className="run"
      aria-selected={selected}
      tabIndex={stop ? 0 : -1}
      onFocus={onFocus}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      <span
        className="mark asked"
        role="img"
        aria-label={item.kind === "question" ? "A question" : "An approval"}
      />
      <span className="task" title={item.task}>
        {run ? <span className="number data">{run.taskId}</span> : null} {item.task}
      </span>
      <span className="when data">{item.kind === "question" ? "question" : "approval"}</span>
      <span className="sentence">
        {item.kind === "question" ? item.body : (run?.sentence ?? item.body)}
        {item.summary ? ` ${lead(item.summary).head}` : ""}
      </span>
    </div>
  );
}
