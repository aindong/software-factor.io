// A lane worked by a panel: several agents at once on one read-only lane, each with its own part
// of the job, joined into one verdict. Which members take part depends on what the change touches,
// so a small change gets a small review. A member is a lane in small, named "<lane>.<member>".
import { realpathSync } from "node:fs";
import { holdAccount, LIMIT_HOLD_MS } from "../accounts.ts";
import { nowMs } from "../clock.ts";
import { saveRunFile } from "../evidence.ts";
import { branchTip, gitConfigFingerprint } from "../git.ts";
import { checkHandoff, combineRisk, outputProblems, type RunRisk } from "../handoff.ts";
import { readObject } from "../safe-read.ts";
import type { Lane } from "../schema/workflow.ts";
import { servedFor } from "../served.ts";
import * as store from "../store.ts";
import { oneLine } from "../text.ts";
import { type Ctx, halted } from "./lane.ts";
import { type Started, startAgent } from "./start.ts";
import type { LaneResult } from "./state.ts";
import { holds } from "./transition.ts";
import { settleTree } from "./tree.ts";

type Member = NonNullable<Lane["panel"]>["members"][number];

export interface PanelResult {
  outcome: store.Outcome;
  note: string;
  outputs: Record<string, unknown>;
  tokens: number;
  usd: number;
  /** How many agents were started. */
  starts: number;
  stop?: LaneResult["stop"];
  hold?: number;
  /** The lane is over as it is: no gate is worth running. */
  final: boolean;
}

interface Verdict {
  id: string;
  advisory: boolean;
  outcome: store.Outcome;
  summary: string;
  open: string[];
  /** What the member claimed, with the evidence the host found. Recorded only when the panel is not cut off. */
  claims: { text: string; evidence: { ref: string }[] }[];
  risk?: Parameters<typeof combineRisk>[1];
  outputs: Record<string, unknown>;
}

/** A hand-off given as text, when it is a JSON object. */
function fromText(text: string | undefined): { text: string; value: Record<string, unknown> } | undefined {
  if (text === undefined) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? { text, value: value as Record<string, unknown> }
      : undefined;
  } catch {
    return undefined;
  }
}

/** A member's own lane: the lane's settings with the member's on top. */
export function memberLane(lane: Lane, member: Member): Lane {
  if (!lane.agent) throw new Error(`panel lane ${lane.id} has no agent settings`);
  return {
    ...lane,
    id: `${lane.id}.${member.id}`,
    panel: undefined,
    agent: {
      ...lane.agent,
      role: member.role ?? lane.agent.role,
      tier: member.tier ?? lane.agent.tier,
      effort: member.effort ?? lane.agent.effort,
    },
  };
}

/** What one member said, after the host checked its hand-off like any other. */
function verdictOf(ctx: Ctx, own: Lane, member: Member, started: Started, stem: string): Verdict {
  const { ws, db, run, state } = ctx;
  const failed = (why: string): Verdict => ({
    id: member.id,
    advisory: member.advisory === true,
    outcome: "fail",
    summary: oneLine(why),
    open: [],
    claims: [],
    outputs: {},
  });
  const { exit } = started;
  if (exit.error) return failed(`the agent reported an error: ${exit.error}`);
  if (exit.exitCode !== 0) return failed(`the agent exited ${exit.exitCode}`);
  // What the agent gave the factor server comes first: a question asked there stands. Then what it
  // said in its last message. Members share the folder their lane folders sit in, so a file in a
  // member's folder may be another member's work: it is taken only from an agent that has no
  // other way to hand off (the scripted agent, Kimi Code, a command).
  const served = servedFor(db, { run: run.id, slot: started.laneDir });
  const handoff =
    served.handoff ?? fromText(exit.said) ?? (started.server ? undefined : readObject(started.agentHandoff));
  if (!handoff) return failed("it left no hand-off");
  try {
    saveRunFile(ws, run.id, "handoffs", `${stem}.json`, handoff.text);
  } catch {
    return failed("a file was already where the host keeps this hand-off");
  }
  const checked = checkHandoff(
    {
      ws,
      runId: run.id,
      tag: stem,
      base: run.base_commit,
      head: branchTip(ws.root, run.branch),
      gates: state.gates,
      evidenceDir: started.evidenceDir,
      served: served.evidence,
    },
    own,
    handoff.value,
  );
  if (!checked.handoff) return failed(`the hand-off was rejected: ${checked.problems.join(" ")}`);
  return {
    id: member.id,
    advisory: member.advisory === true,
    outcome: checked.handoff.outcome,
    summary: oneLine(checked.handoff.summary),
    open: checked.handoff.open ?? [],
    claims: checked.claims,
    risk: checked.handoff.risk,
    outputs: checked.handoff.outputs ?? {},
  };
}

export async function runPanel(
  ctx: Ctx,
  lane: Lane,
  at: {
    laneRun: number;
    tag: string;
    entry: number;
    prompt: string;
    env: Record<string, string>;
    ms: number;
  },
): Promise<PanelResult> {
  const { ws, db, run, state } = ctx;
  const panel = lane.panel;
  if (!panel) throw new Error(`lane ${lane.id} has no panel`);
  // the review is sized to the change: a member with a condition joins only when it holds
  const facts = ctx.facts();
  const joined = panel.members.filter((m) => !m.when || holds(m.when, facts));
  const leftOut = panel.members.filter((m) => !joined.includes(m)).map((m) => m.id);
  ctx.log.push(
    `  ${lane.id}: panel of ${joined.map((m) => m.id).join(", ")}${leftOut.length > 0 ? `, left out: ${leftOut.join(", ")}` : ""}`,
  );

  const gitBefore = gitConfigFingerprint(ws.root);
  const before = { tip: branchTip(ws.root, run.branch), path: realpathSync(run.worktree) };
  const stemOf = (m: Member) => `${at.tag}.${m.id}`;
  // Each member's hand-off is taken and checked the moment that member ends. A member that is
  // still running could otherwise change what a finished member left.
  const settled = await Promise.allSettled(
    joined.map(async (member) => {
      const own = memberLane(lane, member);
      const part = ws.prompts[own.id];
      const started = await startAgent(ctx, own, {
        laneRun: at.laneRun,
        stem: stemOf(member),
        try: 1,
        entry: at.entry,
        prompt: at.prompt + (part ? `\n# Your part in this review\n\n${part}\n` : ""),
        env: at.env,
        ms: at.ms,
        member: true,
      });
      return { started, verdict: verdictOf(ctx, own, member, started, stemOf(member)) };
    }),
  );
  // every member has ended by now, whatever broke: none is left running when the run ends as crashed
  const broken = settled.find((r) => r.status === "rejected");
  if (broken?.status === "rejected") throw broken.reason;
  const ended = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  const starts = ended.map((e) => e.started);
  const over = (r: Partial<PanelResult>): PanelResult => ({
    outcome: "fail",
    note: "",
    outputs: {},
    tokens: starts.reduce((sum, s) => sum + (s.exit.usage?.tokens ?? 0), 0),
    usd: starts.reduce((sum, s) => sum + s.usd, 0),
    starts: starts.length,
    final: true,
    ...r,
  });

  // the same order as for one agent: what must stop the run, then the tree, then time and limits
  const tampered =
    gitConfigFingerprint(ws.root) !== gitBefore
      ? `git's configuration or hooks changed while the panel of lane "${lane.id}" worked: look at .git/config, .git/hooks and your own git configuration before you commit`
      : starts.find((s) => s.exit.tampered)?.exit.tampered;
  if (tampered) return over({ note: tampered, stop: { code: "git_config_changed", reason: tampered } });
  const halt = halted(ctx);
  if (halt) return over({ note: halt.reason, stop: halt });
  let hold: number | undefined;
  for (const s of starts) {
    if (!s.exit.limit || !s.account) continue;
    hold = nowMs() + LIMIT_HOLD_MS;
    holdAccount(s.account, hold);
  }
  if (starts.some((s) => s.account)) {
    // members only read: whatever one of them changed is dropped, and the lane fails
    const settled = settleTree(ws, run, lane, before, "", ctx.log);
    if (settled.fail) {
      const stop = settled.stop ? ({ code: "git_config_changed", reason: settled.fail } as const) : undefined;
      return over({ note: oneLine(settled.fail), stop });
    }
  }
  if (starts.some((s) => s.cutOff)) {
    return over({ note: `out of time after ${lane.limits?.minutes ?? "the run's"} minutes` });
  }
  if (hold !== undefined) return over({ note: "an account of the panel reached its limit", hold });

  const verdicts = ended.map((e) => e.verdict);
  // A member that asks a person cannot decide. Where all must pass, a failure ends it before the
  // question matters. Where any may pass, a pass ends it before the question matters.
  const deciding = verdicts.filter((v) => !v.advisory);
  const asks = deciding.find((v) => v.outcome === "needsPerson");
  const passes = (v: Verdict) => v.outcome === "pass";
  const fails = (v: Verdict) => v.outcome === "fail";
  const outcome: store.Outcome =
    panel.join === "all"
      ? deciding.some(fails)
        ? "fail"
        : asks
          ? "needsPerson"
          : "pass"
      : deciding.some(passes)
        ? "pass"
        : asks
          ? "needsPerson"
          : "fail";
  const said = verdicts.map((v) => `${v.id}${v.advisory ? " (advises)" : ""}: ${v.outcome}. ${v.summary}`);

  // Lists are joined in the order of the members. Anything else comes from one member: a deciding
  // one that agrees with the verdict before any other, so a member that lost cannot steer what follows.
  const byWeight = [
    ...deciding.filter((v) => v.outcome === outcome),
    ...deciding.filter((v) => v.outcome !== outcome),
    ...verdicts.filter((v) => v.advisory),
  ];
  const outputs: Record<string, unknown> = {};
  for (const [name, declared] of Object.entries(lane.outputs ?? {})) {
    const from = declared.type === "array" ? verdicts : byWeight;
    const given = from.filter((v) => Object.hasOwn(v.outputs, name)).map((v) => v.outputs[name]);
    if (given.length === 0) continue;
    outputs[name] = declared.type === "array" ? given.flatMap((g) => (Array.isArray(g) ? g : [])) : given[0];
  }
  // the joined value is checked like any output: two lists that each fit can be too much together
  const wrong = outputProblems(lane, outputs);
  if (wrong.length > 0) {
    if (state.last?.lane === lane.id) state.last = undefined;
    state.open = (state.open ?? []).filter((o) => o.lane !== lane.id);
    return over({ note: oneLine(`the joined outputs were rejected: ${wrong.join(" ")}`), final: false });
  }
  // the panel was not cut off: what its members claimed and the risk they stated go on the record
  for (const v of verdicts) {
    for (const claim of v.claims) store.addClaim(db, run.id, at.laneRun, claim.text, claim.evidence);
  }
  const floor = lane.oneWay || facts.tier === "sensitive";
  const stated = [
    ...verdicts.flatMap((v) => (v.risk ? [v.risk] : [])),
    ...(floor ? [{ level: "low" as const, door: "two-way" as const, why: "No lane stated a risk." }] : []),
  ];
  for (const risk of stated) {
    state.risk = combineRisk(state.risk as RunRisk | undefined, risk, {
      tier: facts.tier,
      oneWayLane: lane.oneWay === true,
    });
    store.setRunRisk(db, run.id, state.risk);
  }
  state.last = {
    lane: lane.id,
    summary: said.join("\n"),
    open: verdicts.flatMap((v) => v.open),
    claims: verdicts.flatMap((v) =>
      v.claims.map((c) => `${c.text} (${c.evidence.map((e) => e.ref).join(", ")})`),
    ),
  };
  state.open = [
    ...(state.open ?? []).filter((o) => o.lane !== lane.id),
    ...verdicts.flatMap((v) => v.open.map((text) => ({ lane: lane.id, text: `${v.id}: ${text}` }))),
  ];
  const note =
    outcome === "needsPerson" && asks ? `${asks.id} asks: ${asks.summary}` : oneLine(said.join("; "), 1000);
  return over({ outcome, note, outputs, final: false });
}
