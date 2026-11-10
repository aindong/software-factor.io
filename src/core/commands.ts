// The `account` and `role` commands: which agent logins this machine has, and which of them works
// each role of a workspace's workflow.
import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  type Account,
  AGENTS,
  accountName,
  addAccount,
  heldUntil,
  readAccounts,
  removeAccount,
} from "./accounts.ts";
import { LocalConfig } from "./config.ts";
import type { Db } from "./db.ts";
import { UserError } from "./errors.ts";
import { own } from "./schema/builtins.ts";
import { getRun, type Session, sessionsOf } from "./store.ts";
import type { Workspace } from "./workspace.ts";

type Flags = Record<string, string | boolean | string[] | undefined>;
const text = (flags: Flags, name: string) => (typeof flags[name] === "string" ? flags[name] : undefined);

export function accountCommand(args: string[], flags: Flags, say: (line: string) => void): number {
  const [action, name] = args;
  if (action === "list") {
    const accounts = Object.entries(readAccounts());
    if (accounts.length === 0) say("No accounts yet. Add one with `softwarefactor account add`.");
    for (const [n, a] of accounts) {
      const until = heldUntil(n, a);
      const held = until === undefined ? "" : `  held until ${new Date(until).toISOString()}`;
      say(`${n.padEnd(16)} ${a.agent.padEnd(8)} ${a.profile ?? a.command ?? ""}${held}`);
    }
    return 0;
  }
  if (action === "remove" && name) {
    removeAccount(name);
    say(`removed the account "${name}"`);
    return 0;
  }
  if (action !== "add" || !name) {
    throw new UserError(
      '"account" needs add <name>, list, or remove <name>.',
      "For example: softwarefactor account add work --agent claude --profile ~/.claude",
    );
  }
  if (!accountName.safeParse(name).success) {
    throw new UserError(
      `"${name}" cannot be an account name.`,
      "Start with a small letter and use small letters, digits and -.",
    );
  }
  const agent = AGENTS.find((a) => a === text(flags, "agent"));
  if (!agent) {
    throw new UserError(
      `"account add" needs --agent, and "${text(flags, "agent") ?? ""}" is not one this version knows.`,
      `Use one of: ${AGENTS.join(", ")}.`,
    );
  }
  const account: Account = { agent };
  if (agent === "command") {
    const command = text(flags, "command");
    if (!command) {
      throw new UserError(
        "A command account needs --command.",
        'For example: --command "my-agent --prompt-file $FACTOR_PROMPT_FILE".',
      );
    }
    account.command = command;
  } else {
    const profile = text(flags, "profile");
    if (!profile) {
      throw new UserError(
        `A ${agent} account needs --profile.`,
        "Name the CLI's profile folder, the one that holds its login.",
      );
    }
    account.profile = resolve(profile);
    if (!existsSync(account.profile)) {
      throw new UserError(
        `The profile folder ${account.profile} does not exist.`,
        "Sign in with that CLI first, then name the folder it uses.",
      );
    }
    const bin = text(flags, "bin");
    if (bin) account.bin = resolve(bin);
  }
  const limits = ((flags.limit as string[] | undefined) ?? []).map((limit) => {
    const m = /^(\d+(?:\.\d+)?)h=(\d+)$/.exec(limit);
    if (!m || Number(m[1]) <= 0 || Number(m[2]) <= 0) {
      throw new UserError(
        `--limit "${limit}" is not a window and a number of tokens.`,
        "Write it as hours and tokens, such as --limit 5h=2000000.",
      );
    }
    return { hours: Number(m[1]), tokens: Number(m[2]) };
  });
  if (limits.length > 0) account.limits = limits;
  const headroom = text(flags, "headroom");
  if (headroom !== undefined) {
    account.headroom = Number(headroom);
    if (!(account.headroom > 0 && account.headroom <= 1)) {
      throw new UserError(
        `--headroom "${headroom}" is not a share of the limit.`,
        "Use a number such as 0.9.",
      );
    }
  }
  addAccount(name, account);
  say(`added the account "${name}" (${agent})`);
  return 0;
}

export function roleCommand(
  ws: Workspace,
  args: string[],
  flags: Flags,
  say: (line: string) => void,
): number {
  const [action, role] = args;
  const roles = ws.workflow.roles ?? {};
  const accounts = readAccounts();
  /** The vendor behind a role, when it is bound to an account. */
  const vendorOf = (r: string) => {
    const binding = own(ws.local.roles, r);
    return binding && "account" in binding ? own(accounts, binding.account)?.agent : undefined;
  };
  if (action === "list") {
    for (const [name, declared] of Object.entries(roles)) {
      const binding = own(ws.local.roles, name);
      const bound = !binding
        ? "not bound"
        : "account" in binding
          ? `${binding.account} (${vendorOf(name) ?? "an account that is not on this machine"})`
          : "the scripted agent (fake)";
      const vendor = vendorOf(name);
      const clash = (declared.differentVendorFrom ?? []).filter((o) => vendor && vendorOf(o) === vendor);
      const flag = clash.length > 0 ? `  same vendor as ${clash.join(", ")}: bind one to another vendor` : "";
      say(`${name.padEnd(16)} ${bound}${flag}`);
    }
    return 0;
  }
  const account = text(flags, "account");
  if (action !== "bind" || !role || !account) {
    throw new UserError(
      '"role" needs bind <role> --account <name>, or list.',
      "See the accounts with `softwarefactor account list`.",
    );
  }
  if (!own(roles, role)) {
    throw new UserError(
      `The workflow "${ws.workflow.name}" has no role "${role}".`,
      `Its roles are: ${Object.keys(roles).join(", ")}.`,
    );
  }
  if (!own(accounts, account)) {
    throw new UserError(
      `There is no account "${account}" on this machine.`,
      "Add it with `softwarefactor account add`, or see `softwarefactor account list`.",
    );
  }
  const models = Object.fromEntries(
    ["small", "medium", "large"].flatMap((tier) => (text(flags, tier) ? [[tier, text(flags, tier)]] : [])),
  );
  const effort = text(flags, "effort");
  const binding = {
    account,
    ...(Object.keys(models).length > 0 ? { models } : {}),
    ...(effort ? { effort } : {}),
  };
  const local = LocalConfig.safeParse({ roles: { ...ws.local.roles, [role]: binding } });
  if (!local.success) {
    throw new UserError(
      `That binding is not valid: ${local.error.issues[0]?.message}`,
      "Use --effort low, medium, high or max, and a model name for --small, --medium and --large.",
    );
  }
  writeFileSync(join(ws.factorDir, "local.json"), `${JSON.stringify(local.data, null, 2)}\n`);
  say(`the role "${role}" is now worked by the account "${account}"`);
  return 0;
}

const money = (usd: number) => `$${usd.toFixed(4)}`;
const num = (n: number) => String(n).padStart(13);

/** `sessions [run]`: every start of an agent with what it used and cost, a total per run and per account. */
export function sessionsCommand(db: Db, runId: string | undefined, say: (line: string) => void): number {
  if (runId !== undefined && !getRun(db, runId)) {
    throw new UserError(`There is no run "${runId}".`, "See the run ids with `softwarefactor status`.");
  }
  const sessions = sessionsOf(db, runId);
  if (sessions.length === 0) {
    say("No sessions yet. A session is recorded each time an agent starts on a lane.");
    return 0;
  }
  /** The known cost of some sessions, and how many of them have none. */
  const cost = (list: Session[]) => ({
    usd: list.reduce((sum, s) => sum + (s.usd ?? 0), 0),
    unknown: list.filter((s) => s.usd === null).length,
  });
  const sum = (
    list: Session[],
    key: "input_tokens" | "output_tokens" | "cache_read_tokens" | "cache_write_tokens" | "tokens",
  ) => list.reduce((total, s) => total + s[key], 0);
  const head = `${"lane".padEnd(14)} ${"try".padEnd(4)} ${"account".padEnd(14)} ${"model".padEnd(22)}`;
  for (const id of new Set(sessions.map((s) => s.run_id))) {
    const mine = sessions.filter((s) => s.run_id === id);
    say(`Run ${id}  ${mine[0]?.title ?? ""}`);
    say(
      `  ${head}${["input", "output", "cache read", "cache write"].map((h) => h.padStart(13)).join("")}  cost`,
    );
    for (const s of mine) {
      const who = `${s.lane.padEnd(14)} ${String(s.try).padEnd(4)} ${(s.account ?? "-").padEnd(14)} ${(s.model ?? "-").padEnd(22)}`;
      const used =
        num(s.input_tokens) + num(s.output_tokens) + num(s.cache_read_tokens) + num(s.cache_write_tokens);
      say(
        `  ${who}${used}  ${s.usd === null ? "unknown" : money(s.usd)}${s.usd_source === "priced" ? " (priced from the table)" : ""}`,
      );
    }
    const { usd, unknown } = cost(mine);
    const used =
      num(sum(mine, "input_tokens")) +
      num(sum(mine, "output_tokens")) +
      num(sum(mine, "cache_read_tokens")) +
      num(sum(mine, "cache_write_tokens"));
    const known = unknown === mine.length ? "unknown" : money(usd);
    say(`  ${"total".padEnd(head.length)}${used}  ${known}  (${sum(mine, "tokens")} tokens)`);
    if (unknown > 0) {
      say(
        `  ${unknown} session${unknown === 1 ? "" : "s"} of unknown cost ${unknown === 1 ? "is" : "are"} not in the total`,
      );
    }
    say("");
  }
  say("By account");
  for (const account of new Set(sessions.map((s) => s.account))) {
    const mine = sessions.filter((s) => s.account === account);
    const { usd, unknown } = cost(mine);
    const known =
      unknown === mine.length
        ? "unknown"
        : money(usd) + (unknown > 0 ? ` (${unknown} of unknown cost not counted)` : "");
    say(
      `  ${(account ?? "(the scripted agent)").padEnd(22)} ${mine.length} session${mine.length === 1 ? "" : "s"}  ${sum(mine, "tokens")} tokens  ${known}`,
    );
  }
  return 0;
}
