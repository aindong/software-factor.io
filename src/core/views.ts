// What the inbox, accounts, costs and plugins screens show, as data. The command line prints
// from the same functions, and the MCP server serves them (ADR 0008). Reads only.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENTS, DEFAULT_HEADROOM, heldUntil, readAccounts, usedIn } from "./accounts.ts";
import type { Db } from "./db.ts";
import { type Ahead, aheadFor } from "./inbox-ahead.ts";
import type { RunState } from "./engine/state.ts";
import { UserError } from "./errors.ts";
import { keptLimits, type Reading } from "./limits.ts";
import { type ModelChoice, modelChoices } from "./models.ts";
import { installedPlugins } from "./plugins/use.ts";
import { LIST, readPrices } from "./prices.ts";
import { BUILTINS, own } from "./schema/builtins.ts";
import { openInbox } from "./store.ts";
import { loadWorkspace, type Workspace } from "./workspace.ts";

export type Decision = "approve" | "reject" | "send-back" | "answer";
export interface InboxItem {
  id: number;
  run: string;
  task: string;
  lane: string;
  kind: "approval" | "question";
  /** What is asked: an agent may have written it. */
  body: string;
  /** What a person can answer with. Work that has not been done cannot be sent back. */
  decisions: Decision[];
  /** What the lane said of its finished work, in its own words, or "" when it has nothing to say. */
  summary: string;
  /** For an approval before a command lane: what the command does and the run's branch. */
  ahead?: Ahead;
}

export function inboxItems(db: Db, root?: string): InboxItem[] {
  return openInbox(db).map((item) => {
    const run = db.prepare("select state, workflow, branch from runs where id = ?").get(item.run_id) as
      | { state: string; workflow: string; branch: string }
      | undefined;
    let parked: RunState["parked"];
    try {
      parked = (JSON.parse(run?.state ?? "{}") as Partial<RunState>).parked;
    } catch {
      parked = undefined; // a state that does not parse: the command line will say what it takes
    }
    const decisions: Decision[] =
      item.kind === "question"
        ? ["answer"]
        : parked?.kind === "approve-after"
          ? ["approve", "reject", "send-back"]
          : ["approve", "reject"];
    const ahead = root && run ? aheadFor(root, run.workflow, { ...item, decisions }, run.branch) : undefined;
    return {
      id: item.id,
      run: item.run_id,
      task: item.title,
      lane: item.lane,
      kind: item.kind,
      body: item.body,
      decisions,
      summary: (parked?.kind === "approve-after" && parked.note) || "",
      ...(ahead ? { ahead } : {}),
    };
  });
}

export interface AccountsView {
  accounts: {
    name: string;
    agent: string;
    limits: { hours: number; tokens: number; used: number }[];
    headroom: number;
    /** Until when no lane starts on it, or null. */
    heldUntil: string | null;
    /** What a role's model is chosen from: its agent's models, newest first, then what it ran here. */
    models: ModelChoice[];
    /** What its CLI last said of its limits, with the time it said it, or null when never read. */
    reading: Reading | null;
  }[];
  roles: {
    role: string;
    description: string;
    /** The account that works the role, the scripted agent, or nothing yet. */
    works: { account: string; agent: string | null } | "scripted" | null;
    models: Record<string, string>;
    effort: string | null;
    /** Roles this one should be on another vendor than, and is not. */
    sameVendorAs: string[];
  }[];
}

/** The prices, or the built-in list when prices.json cannot be read: the page that rebinds roles must still open. */
function pricesOrList() {
  try {
    return readPrices();
  } catch (error) {
    if (error instanceof UserError) return LIST;
    throw error;
  }
}

/** The logins on this machine and who works each role. Never where a login is kept, or a command. */
export function accountsView(ws: Workspace, db: Db): AccountsView {
  const accounts = readAccounts();
  const readings = keptLimits();
  const known = Object.keys(pricesOrList());
  const ran = db.prepare(
    "select asked_model as asked, model from sessions where account = ? order by started_at desc, id desc",
  );
  const vendorOf = (role: string) => {
    const binding = own(ws.local.roles, role);
    return binding && "account" in binding ? own(accounts, binding.account)?.agent : undefined;
  };
  return {
    accounts: Object.entries(accounts).map(([name, a]) => {
      const until = heldUntil(name, a);
      return {
        name,
        agent: a.agent,
        limits: (a.limits ?? []).map((l) => ({ ...l, used: usedIn(name, l.hours) })),
        headroom: a.headroom ?? DEFAULT_HEADROOM,
        heldUntil: until === undefined ? null : new Date(until).toISOString(),
        models: modelChoices(
          a.agent,
          known,
          ran.all(name) as { asked: string | null; model: string | null }[],
        ),
        reading: own(readings, name) ?? null,
      };
    }),
    roles: Object.entries(ws.workflow.roles ?? {}).map(([role, declared]) => {
      const binding = own(ws.local.roles, role);
      const vendor = vendorOf(role);
      return {
        role,
        description: declared.description ?? "",
        works: !binding
          ? null
          : "account" in binding
            ? { account: binding.account, agent: vendor ?? null }
            : "scripted",
        models: binding && "account" in binding ? { ...binding.models } : {},
        effort: binding && "account" in binding ? (binding.effort ?? null) : null,
        sameVendorAs: (declared.differentVendorFrom ?? []).filter((o) => vendor && vendorOf(o) === vendor),
      };
    }),
  };
}

export interface CostLine {
  sessions: number;
  tokens: number;
  /** The known cost. Null when no session of the line has one: that is not "nothing spent". */
  usd: number | null;
  /** Sessions with no known cost, which the amount leaves out. */
  unknown: number;
}
export interface CostsView {
  byLane: (CostLine & { lane: string })[];
  byTask: (CostLine & { task: string; runs: string[] })[];
  byAccount: (CostLine & { account: string | null; agent: string })[];
  total: CostLine;
}
type SessionRow = {
  lane: string;
  account: string | null;
  agent: string;
  tokens: number;
  usd: number | null;
  run_id: string;
  task_id: number | null;
  title: string | null;
};

/** To a millionth: sums of amounts such as 0.1 and 0.2 are not exact in floating point. */
export const millionth = (usd: number) => Math.round(usd * 1e6) / 1e6;

/** The line of some sessions: how many, their tokens, and the cost that is known. */
export function costLine(list: { tokens: number; usd: number | null }[]): CostLine {
  const known = list.filter((s) => s.usd !== null);
  return {
    sessions: list.length,
    tokens: list.reduce((sum, s) => sum + s.tokens, 0),
    usd: known.length > 0 ? millionth(known.reduce((sum, s) => sum + (s.usd ?? 0), 0)) : null,
    unknown: list.length - known.length,
  };
}

/** Tokens and cost by lane, by task and by account: each line the sum of its sessions. */
export function costsView(db: Db): CostsView {
  // every session counts, also one whose run or task is no longer in the record
  const rows = db
    .prepare(
      `select s.lane, s.account, s.agent, s.tokens, s.usd, s.run_id, r.task_id, t.title from sessions s
       left join runs r on r.id = s.run_id left join tasks t on t.id = r.task_id order by s.id`,
    )
    .all() as unknown as SessionRow[];
  const line = costLine;
  const groups = (key: (s: SessionRow) => string) => {
    const by = new Map<string, SessionRow[]>();
    for (const s of rows) by.set(key(s), [...(by.get(key(s)) ?? []), s]);
    return [...by.values()];
  };
  return {
    byLane: groups((s) => s.lane).map((list) => ({ lane: list[0]?.lane ?? "", ...line(list) })),
    byTask: groups((s) => String(s.task_id ?? `run ${s.run_id}`)).map((list) => ({
      task: list[0]?.title ?? "(a task that is no longer in the record)",
      runs: [...new Set(list.map((s) => s.run_id))],
      ...line(list),
    })),
    byAccount: groups((s) => `${s.account ?? ""}|${s.agent}`).map((list) => ({
      account: list[0]?.account ?? null,
      agent: list[0]?.agent ?? "",
      ...line(list),
    })),
    total: line(rows),
  };
}

export interface PluginsView {
  lanes: string[];
  gates: string[];
  collectors: string[];
  agents: string[];
  workflows: { name: string; description: string }[];
  /** The plugins installed and allowed in this workspace, each with what it adds. */
  installed: { name: string; version: string; adds: string[] }[];
  installing: string;
}

/** What this version has built in to assemble a factory from, by the names a workflow uses. */
export function pluginsView(root: string): PluginsView {
  let installed: PluginsView["installed"] = [];
  try {
    installed = installedPlugins(loadWorkspace(root));
  } catch {
    // a workspace that cannot be read has no plugins to show
  }
  // the workflows that come with the package, beside the code in the source tree and in the build
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "workflows");
  let workflows: PluginsView["workflows"] = [];
  try {
    workflows = readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => {
        const doc = JSON.parse(readFileSync(join(dir, f), "utf8")) as { description?: unknown };
        return {
          name: f.slice(0, -5),
          description: typeof doc.description === "string" ? doc.description : "",
        };
      });
  } catch {
    // the package came without its workflows folder
  }
  return {
    lanes: Object.keys(BUILTINS.lane),
    gates: Object.keys(BUILTINS.gate),
    collectors: Object.keys(BUILTINS.collector),
    agents: [...AGENTS, "fake"],
    workflows,
    installed,
    installing: `${
      installed.length > 0
        ? `Installed here: ${installed.map((p) => `${p.name} ${p.version}`).join(", ")}.`
        : "No plugin is installed here."
    } Add one from your terminal with \`softwarefactor add <folder, owner/repo or name>\`: it is shown first, and installed on a yes. \`softwarefactor plugins --available\` lists the directory.`,
  };
}
