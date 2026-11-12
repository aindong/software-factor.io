// What a login's CLI says of its limits, read without a model call: `claude -p /usage` prints one
// line for each window, such as "Current week (all models): 73% used · resets Nov 15 at 6:59am".
// The last reading of each login is kept in limits.json, with its time. No login's file is read.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Account, readAccounts } from "./accounts.ts";
import { profileEnv } from "./agents/cli.ts";
import { nowIso } from "./clock.ts";
import { hostEnv } from "./exec.ts";
import { factorHome } from "./workspace.ts";

/** One limit window as the CLI words it. A window it did not print has `percent` and `resets` null. */
export interface Window {
  name: string;
  percent: number | null;
  resets: string | null;
}
export interface Reading {
  at: string;
  windows: Window[];
  /** Why the CLI could not be read, in its own words. */
  failed: string | null;
  /** Why this kind of login reports no limits at all. */
  none: string | null;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: colour codes are control sequences
const ANSI =/\u001b\[[0-9;?]*[A-Za-z]/g;
const LINE = /^(Current (?:session|week \([^)]+\))):\s*(\d+(?:\.\d+)?)% used\s*·\s*resets\s+(.+?)\s*$/;
const READ_MS = 20_000;
const NONE: Record<Account["agent"], string | null> = {
  claude: null,
  codex: "Codex does not report its limits without a model call, so none are shown.",
  kimi: "Kimi Code does not report its limits without a model call, so none are shown.",
  command: "A command account has no CLI to report its limits.",
};

/** The windows in the usage text, with every window Claude Code is expected to print and did not as not reported. */
export function parseUsage(text: string): Window[] {
  const printed: Window[] = [];
  for (const line of text.replace(ANSI, "").split("\n")) {
    const m = LINE.exec(line.trim());
    if (m?.[1] && !printed.some((w) => w.name === m[1])) {
      printed.push({ name: m[1], percent: Number(m[2]), resets: m[3] ?? null });
    }
  }
  const missing = (name: string) => ({ name, percent: null, resets: null });
  const named = printed.filter(
    (w) => w.name.startsWith("Current week (") && w.name !== "Current week (all models)",
  );
  return [
    printed.find((w) => w.name === "Current session") ?? missing("Current session"),
    printed.find((w) => w.name === "Current week (all models)") ?? missing("Current week (all models)"),
    ...(named.length > 0 ? named : [missing("Current week (one model)")]),
  ];
}

/** Read one login's limits from its CLI. Nothing is kept. */
export function readAccountLimits(account: Pick<Account, "agent" | "profile" | "bin">): Promise<Reading> {
  const reading = (windows: Window[], failed: string | null, none: string | null = null): Reading => ({
    at: nowIso(),
    windows,
    failed,
    none,
  });
  const none = NONE[account.agent];
  if (none !== null) return Promise.resolve(reading([], null, none));
  const bin = account.bin ?? "claude";
  // the CLI's words, without where the login is kept
  const plain = (text: string) =>
    [bin, account.profile ?? ""]
      .reduce((t: string, path) => (path ? t.split(path).join("…") : t), text.trim())
      .slice(0, 300);
  return new Promise((done) => {
    const child = execFile(
      bin,
      ["-p", "/usage"],
      {
        cwd: tmpdir(),
        env: hostEnv([], profileEnv("CLAUDE_CONFIG_DIR", account.profile, ".claude")),
        timeout: READ_MS,
        killSignal: "SIGKILL",
        encoding: "utf8",
        maxBuffer: 1_000_000,
      },
      (error, stdout, stderr) => {
        if (!error) return done(reading(parseUsage(stdout), null));
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT" || code === "EACCES") return done(reading([], "the CLI could not be started"));
        if (error.killed) return done(reading([], `the CLI did not answer in ${READ_MS / 1000} s`));
        const said = plain(stderr || stdout) || "it said nothing";
        done(reading([], `${said} (exit ${typeof code === "number" ? code : "?"})`));
      },
    );
    child.stdin?.end();
  });
}

const limitsPath = () => join(factorHome(), "limits.json");

/** The last reading of each login, or nothing for one never read. */
export function keptLimits(): Record<string, Reading> {
  if (!existsSync(limitsPath())) return {};
  try {
    return JSON.parse(readFileSync(limitsPath(), "utf8")) as Record<string, Reading>;
  } catch {
    return {}; // a file cut off by a crash: the next reading writes it again
  }
}

/** Read every login's limits at once, and keep them. */
export async function readLimits(): Promise<Record<string, Reading>> {
  const accounts = Object.entries(readAccounts());
  const read = await Promise.all(
    accounts.map(async ([name, a]) => [name, await readAccountLimits(a)] as const),
  );
  const readings = Object.fromEntries(read);
  mkdirSync(factorHome(), { recursive: true });
  // written beside and moved into place, as accounts.json is
  const beside = `${limitsPath()}.${process.pid}.tmp`;
  writeFileSync(beside, `${JSON.stringify(readings, null, 2)}\n`);
  renameSync(beside, limitsPath());
  return readings;
}
