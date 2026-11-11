// The record of one start of an agent: who worked, on which model, what it used and what that
// cost, with the CLI's own output kept as a transcript. The numbers are the CLI's, stored as it
// printed them, so any later report can be checked against these rows to the token.
import { recordUsage } from "../accounts.ts";
import type { Bound } from "../agents/index.ts";
import type { AgentExit } from "../agents/types.ts";
import { saveRunFile } from "../evidence.ts";
import { priceOf } from "../prices.ts";
import { readTail } from "../safe-read.ts";
import * as store from "../store.ts";
import { oneLine } from "../text.ts";
import type { Ctx } from "./lane.ts";

const MAX_TRANSCRIPT = Number(process.env.FACTOR_TRANSCRIPT_MAX_BYTES) || 50_000_000;

/** Record the session. Returns the cost to count against the run's budget: 0 when it is unknown. */
export function recordSession(
  ctx: Ctx,
  at: { lane: string; laneRun: number; stem: string; try: number; startedMs: number },
  bound: Pick<Bound, "agent" | "account" | "model">,
  exit: AgentExit,
): number {
  const { ws, db, run } = ctx;
  const used = exit.usage;
  const tokens = used?.tokens ?? 0;
  // an agent that gives no kinds (the scripted one) has all its tokens counted as input
  const counts = {
    input: used?.input ?? tokens,
    output: used?.output ?? 0,
    cacheRead: used?.cacheRead ?? 0,
    cacheWrite: used?.cacheWrite ?? 0,
  };
  // the scripted agent names its own cost, and none named is none: it runs no model
  const reported = used !== undefined && used.costReported !== false;
  // with no usage at all there is nothing to price: the cost is unknown, not zero
  let priced: number | undefined;
  try {
    priced = reported || used === undefined ? undefined : priceOf(exit.model, counts);
  } catch (error) {
    // the price file broke while the agent worked: the session is still recorded, at an unknown cost
    ctx.log.push(`  ${at.lane}: ${(error as Error).message}`);
  }
  const usd = reported ? used.usd : (priced ?? null);
  const limit = ws.workflow.limits.usd;
  if (usd === null && limit !== undefined) {
    ctx.log.push(
      `  ${at.lane}: the cost of this session is unknown, so it is not counted against the limit of ${limit} dollars`,
    );
  }

  // the CLI's output sits in a folder the agent can reach: it is read without following a link
  let transcript: { path: string; sha256: string } | undefined;
  const raw = exit.streamPath ? readTail(exit.streamPath, MAX_TRANSCRIPT) : undefined;
  if (raw) {
    // a transcript over the cap keeps its end, where the result is, from the first whole line
    const whole = raw.cut ? raw.data.subarray(raw.data.indexOf(10) + 1) : raw.data;
    const mark = `${JSON.stringify({ type: "factor.cut", bytes: raw.size, kept: whole.length })}\n`;
    try {
      transcript = saveRunFile(
        ws,
        run.id,
        "sessions",
        `${at.stem}.jsonl`,
        raw.cut ? Buffer.concat([Buffer.from(mark), whole]) : whole,
      );
    } catch {
      // something is already where the transcript goes: the host did not put it there, and keeps none
      ctx.log.push(`  ${at.lane}: the transcript could not be kept: a file was already in its place`);
    }
  }
  if (bound.account) recordUsage(bound.account, tokens); // counted for the account, whatever came of the lane
  store.addEvent(db, run.id, "lane.session", {
    lane: at.lane,
    account: bound.account ?? null,
    agent: bound.agent,
    sessionId: exit.sessionId ?? null,
    ...(exit.notice ? { notice: exit.notice } : {}),
  });
  if (exit.notice) ctx.log.push(`  ${at.lane}: ${exit.notice}`);
  store.addSession(db, {
    run_id: run.id,
    lane_run_id: at.laneRun,
    lane: at.lane,
    try: at.try,
    account: bound.account ?? null,
    agent: bound.agent,
    asked_model: bound.model ?? null,
    // both are the CLI's words: kept on one line, so they cannot forge a line of a report
    model: exit.model === undefined ? null : oneLine(exit.model, 100),
    session_id: exit.sessionId === undefined ? null : oneLine(exit.sessionId, 100),
    input_tokens: counts.input,
    output_tokens: counts.output,
    cache_read_tokens: counts.cacheRead,
    cache_write_tokens: counts.cacheWrite,
    tokens,
    usd,
    usd_source: reported ? "reported" : priced === undefined ? "unknown" : "priced",
    transcript_path: transcript?.path ?? null,
    transcript_sha256: transcript?.sha256 ?? null,
    started_at: new Date(at.startedMs).toISOString(),
    duration_ms: Date.now() - at.startedMs,
  });
  return usd ?? 0;
}
