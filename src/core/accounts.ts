// Accounts on this machine: which agent CLI, and which profile folder holds its login. The factory
// never stores a login. The folder is the vendor's own, and this file only names it (ADR 0003).
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { nowMs } from "./clock.ts";
import { UserError } from "./errors.ts";
import { factorHome } from "./workspace.ts";

export const AGENTS = ["claude", "codex", "kimi", "command"] as const;
const HOUR_MS = 3_600_000;
export const DEFAULT_HEADROOM = 0.9;
/** How long an account is held when its CLI says the limit is reached. shortcut: a fixed hour. Read the CLI's reset time when one is seen. */
export const LIMIT_HOLD_MS = 60 * 60_000;

export const accountName = z.string().regex(/^[a-z][a-z0-9-]*$/);
const Account = z.strictObject({
  agent: z.enum(AGENTS),
  profile: z
    .string()
    .min(1)
    .optional()
    .meta({ description: "The CLI's own profile folder, with its login." }),
  bin: z.string().min(1).optional().meta({ description: "The binary to run, when it is not on the PATH." }),
  command: z.string().min(1).optional().meta({ description: "For a command account: the shell command." }),
  limits: z
    .array(z.strictObject({ hours: z.number().positive(), tokens: z.number().int().positive() }))
    .optional()
    .meta({ description: "How many tokens the account may use in a window of that many hours." }),
  headroom: z.number().gt(0).max(1).optional().meta({
    description: "The share of a limit at which lanes are held (default 0.9).",
  }),
});
export type Account = z.infer<typeof Account>;
const AccountsFile = z.strictObject({ accounts: z.record(accountName, Account) });

const accountsPath = () => join(factorHome(), "accounts.json");
const usagePath = () => join(factorHome(), "usage.jsonl");

export function readAccounts(): Record<string, Account> {
  const path = accountsPath();
  if (!existsSync(path)) return {};
  try {
    return AccountsFile.parse(JSON.parse(readFileSync(path, "utf8"))).accounts;
  } catch (error) {
    throw new UserError(
      `Cannot read the accounts at ${path}: ${(error as Error).message.slice(0, 300)}`,
      "Fix the file, or delete it and add the accounts again.",
    );
  }
}

function writeAccounts(accounts: Record<string, Account>): void {
  mkdirSync(factorHome(), { recursive: true });
  // written beside and moved into place, so a run that reads now never sees half a file
  const beside = `${accountsPath()}.${process.pid}.tmp`;
  writeFileSync(beside, `${JSON.stringify({ accounts }, null, 2)}\n`);
  renameSync(beside, accountsPath());
}

export function addAccount(name: string, account: Account): void {
  const accounts = readAccounts();
  if (Object.hasOwn(accounts, name)) {
    throw new UserError(
      `There is already an account "${name}".`,
      "Pick another name, or remove it first with `softwarefactor account remove`.",
    );
  }
  writeAccounts({ ...accounts, [name]: Account.parse(account) });
}

export function removeAccount(name: string): void {
  const { [name]: gone, ...rest } = readAccounts();
  if (!gone) throw new UserError(`There is no account "${name}".`, "See `softwarefactor account list`.");
  writeAccounts(rest);
  note({ at: nowMs(), account: name, reset: true }); // the name may be used again, for another login
}

// ---- usage and holds

interface UsageLine {
  at: number;
  account: string;
  tokens?: number;
  holdUntil?: number;
  /** The account was removed: nothing before this line counts for a new account of the same name. */
  reset?: boolean;
}

// shortcut: one line per agent start, never trimmed. Move it into a table when the cost report (task 11) needs more.
function note(line: UsageLine): void {
  mkdirSync(factorHome(), { recursive: true });
  appendFileSync(usagePath(), `${JSON.stringify(line)}\n`);
}

/** Write down what one agent start used, so the account's limit counts work from every workspace. */
export const recordUsage = (account: string, tokens: number) => note({ at: nowMs(), account, tokens });
/** Hold an account until a time: its CLI said the limit is reached. */
export const holdAccount = (account: string, until: number) =>
  note({ at: nowMs(), account, holdUntil: until });

function usageOf(account: string): UsageLine[] {
  if (!existsSync(usagePath())) return [];
  const lines: UsageLine[] = [];
  for (const text of readFileSync(usagePath(), "utf8").split("\n")) {
    try {
      const line = JSON.parse(text) as UsageLine;
      if (line.account === account && typeof line.at === "number") lines.push(line);
    } catch {
      // a line cut off by a crash
    }
  }
  return lines.slice(lines.findLastIndex((l) => l.reset) + 1);
}

/** The tokens an account has used in the last `hours` hours, since it was last added. */
export const usedIn = (name: string, hours: number): number =>
  usageOf(name)
    .filter((l) => l.tokens && l.at > nowMs() - hours * HOUR_MS)
    .reduce((sum, l) => sum + (l.tokens ?? 0), 0);

/** Until when an account must not start a lane, in milliseconds on the factory clock, or nothing. */
export function heldUntil(name: string, account: Account): number | undefined {
  const now = nowMs();
  const lines = usageOf(name);
  let until = lines.reduce((latest, l) => Math.max(latest, l.holdUntil ?? 0), 0);
  for (const limit of account.limits ?? []) {
    const windowMs = limit.hours * HOUR_MS;
    const inWindow = lines.filter((l) => l.tokens && l.at > now - windowMs).sort((a, b) => a.at - b.at);
    let used = inWindow.reduce((sum, l) => sum + (l.tokens ?? 0), 0);
    const allowed = limit.tokens * (account.headroom ?? DEFAULT_HEADROOM);
    // the hold ends when enough of the oldest usage has left the window
    for (const line of inWindow) {
      if (used < allowed) break;
      used -= line.tokens ?? 0;
      until = Math.max(until, line.at + windowMs);
    }
  }
  return until > now ? until : undefined;
}
