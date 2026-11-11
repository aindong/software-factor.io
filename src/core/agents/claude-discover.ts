// The servers an account's profile has, as `claude mcp list` prints them: one line for each,
// `<name>: <address or command> - <state>`, with no model call. Read once for each run.
import { spawnSync } from "node:child_process";
import { hostEnv } from "../exec.ts";

/** The names in the output of `claude mcp list`, or nothing when no line can be read. */
export function parseServers(text: string): string[] | undefined {
  const names = text
    .split("\n")
    .map((line) => /^(\S.*?): \S/.exec(line)?.[1])
    .filter((name): name is string => name !== undefined);
  return names.length > 0 ? names : undefined;
}

const read = new Map<string, string[] | undefined>();

/** Ask the account's CLI for its profile's servers. A failure, or output that cannot be read, gives nothing. */
export function discoverServers(
  bin: string,
  env: Record<string, string>,
  runId: string,
  cwd?: string,
): string[] | undefined {
  const key = JSON.stringify([runId, bin, env]);
  if (read.has(key)) return read.get(key);
  const r = spawnSync(bin, ["mcp", "list"], {
    encoding: "utf8",
    cwd,
    env: hostEnv([], env),
    timeout: 60_000,
    killSignal: "SIGKILL",
  });
  const found = r.status === 0 ? parseServers(r.stdout) : undefined;
  read.set(key, found);
  return found;
}
