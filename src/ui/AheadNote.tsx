// Under the decision bar of an approval before a command lane: what the command does, from the
// workflow, and the branch it works on. The approval is one key and cannot be undone.
import type { InboxItem } from "../core/views.ts";

export function AheadNote({ ahead }: { ahead: NonNullable<InboxItem["ahead"]> }) {
  return (
    <div className="ahead">
      <p>
        {ahead.lane} runs <code className="code">{ahead.command}</code>
        {ahead.description ? `: ${ahead.description}` : ", which has no description in the workflow."}
      </p>
      <p>
        On the branch <code className="code">{ahead.branch}</code>
      </p>
    </div>
  );
}
