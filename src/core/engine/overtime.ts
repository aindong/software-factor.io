// A start whose time ran out after its agent had already handed off is judged by the hand-off.
import { readObject } from "../safe-read.ts";
import { servedFor } from "../served.ts";
import type { Ctx } from "./lane.ts";

/** Added to the record of a lane whose agent's process had to be ended by the host. */
export const ENDED_BY_HOST =
  " The agent's process did not end by itself after it handed off: the host ended it when the lane's time ran out.";

/**
 * Whether a hand-off is there: what the agent gave the server, or the file in its folder. The host has
 * already ended the process and what it started, so nothing can write to either any more. Whether
 * it is a valid hand-off is decided afterwards, by the same check as for any other.
 */
export function handedOff(ctx: Ctx, laneDir: string, file?: string): boolean {
  const served = servedFor(ctx.db, { run: ctx.run.id, slot: laneDir });
  return served.handoff !== undefined || (file !== undefined && readObject(file) !== undefined);
}
