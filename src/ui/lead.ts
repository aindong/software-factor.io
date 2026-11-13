// Which lane an inbox item shows first: the one its decision is about, so the proof comes before the
// decision. An approval after a lane (work that can be sent back) and a question are about the lane
// that was asked about, in its latest round; an approval before a lane is about the last lane that ran.
interface Asked {
  kind: string;
  lane: string;
  decisions: string[];
}

export function leadLane<L extends { lane: string }>(lanes: L[], item: Asked): L | undefined {
  const own = item.kind === "question" || item.decisions.includes("send-back");
  return (own ? lanes.findLast((l) => l.lane === item.lane) : undefined) ?? lanes.at(-1);
}

/** What the first lane's block says it is. */
export const LEAD_HEAD = (item: Asked) =>
  item.kind === "question"
    ? "The lane that asked"
    : item.decisions.includes("send-back")
      ? "What you are approving"
      : "What ran before this approval";
