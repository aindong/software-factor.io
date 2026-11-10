// What the inbox, accounts, costs and plugins screens show, as data. The command line prints
// from the same functions, and the MCP server serves them (ADR 0008). Reads only.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENTS, DEFAULT_HEADROOM, heldUntil, readAccounts, usedIn } from "./accounts.ts";
import type { Db } from "./db.ts";
import type { RunState } from "./engine/state.ts";
import { BUILTINS, own } from "./schema/builtins.ts";
import { openInbox } from "./store.ts";
import type { Workspace } from "./workspace.ts";

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
}

export function inboxItems(db: Db): InboxItem[] {
  return openInbox(db).map((item) => {
    const run = db.prepare("select state from runs where id = ?").get(item.run_id) as
      | { state: string }
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
    return {
      id: item.id,
      run: item.run_id,
      task: item.title,
      lane: item.lane,
      kind: item.kind,
      body: item.body,
      decisions,
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

/** The logins on this machine and who works each role. Never where a login is kept, or a command. */
export function accountsView(ws: Workspace): AccountsView {
  const accounts = readAccounts();
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

/** Tokens and cost by lane, by task and by account: each line the sum of its sessions. */
export function costsView(db: Db): CostsView {
  // every session counts, also one whose run or task is no longer in the record
  const rows = db
    .prepare(
      `select s.lane, s.account, s.agent, s.tokens, s.usd, s.run_id, r.task_id, t.title from sessions s
       left join runs r on r.id = s.run_id left join tasks t on t.id = r.task_id order by s.id`,
    )
    .all() as unknown as SessionRow[];
  const line = (list: SessionRow[]): CostLine => {
    const known = list.filter((s) => s.usd !== null);
    return {
      sessions: list.length,
      tokens: list.reduce((sum, s) => sum + s.tokens, 0),
      // to a millionth: sums of amounts such as 0.1 and 0.2 are not exact in floating point
      usd: known.length > 0 ? Math.round(known.reduce((sum, s) => sum + (s.usd ?? 0), 0) * 1e6) / 1e6 : null,
      unknown: list.length - known.length,
    };
  };
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
  installing: string;
}

/** What this version has built in to assemble a factory from, by the names a workflow uses. */
export function pluginsView(): PluginsView {
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
    installing: "Installing more from a directory is not built yet. It comes with `softwarefactor add`.",
  };
}
