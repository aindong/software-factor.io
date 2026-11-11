// The arguments Claude Code is started with for one lane, as a pure function so that a test needs
// no CLI. A lane that names no skill and no server gets the sealed set: file and shell tools, the
// factory's own server, nothing from the profile.
import { type Choice, quote } from "./cli.ts";
import { FACTOR_TOOLS, mcpName } from "./factor-tools.ts";
import { serverSegment } from "./reach.ts";
import type { AgentJob } from "./types.ts";

// A lane that only reads has no tool that writes files: it gives its hand-off in its last message.
const READ_TOOLS = ["Read", "Glob", "Grep", "Bash"];
const WRITE_TOOLS = ["Write", "Edit", "NotebookEdit"];

/**
 * `self` is the program that runs the guard, up to and including "guard". `others` are the names
 * of the profile's servers (`claude mcp list`), or nothing when they could not be read.
 */
export function claudeArgs(
  job: AgentJob,
  choice: Choice,
  self: string[],
  others: string[] | undefined,
  /** The account's profile folder, which the guard keeps the agent out of. */
  profile?: string,
): string[] {
  const canWrite = job.lane.agent?.access === "write";
  const skills = job.skills ?? [];
  const servers = job.servers ?? [];
  // The hook runs this same program, so the guard is the one the tests cover. The lane is on
  // its command line, where the agent cannot change it. A CLI lets a call through when its hook
  // breaks (any exit code but 2), so every failure of the guard to run is turned into a denial.
  const lane = [
    ...["--worktree", job.cwd, "--lane-dir", job.laneDir],
    ...["--access", canWrite ? "write" : "read"],
    ...(job.protect ?? []).flatMap((branch) => ["--protect", branch]),
    ...skills.flatMap((name) => ["--skill", name]),
    ...servers.flatMap((name) => ["--server", name]),
    ...(servers.length > 0 && profile ? ["--profile", profile] : []),
  ];
  const guard = `${[...self, ...lane].map(quote).join(" ")} || exit 2`;
  const hooks = { PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: guard }] }] };
  const tools = [
    ...READ_TOOLS,
    ...(canWrite ? WRITE_TOOLS : []),
    ...(skills.length > 0 ? ["Skill"] : []),
  ].join(",");
  // A named server is allowed by its name, so that none needs an approval nobody can give. Every
  // other server of the profile is shut out by name; the factory's own is never one of them.
  const all = servers.includes("*");
  const named = new Set(servers.filter((s) => s !== "*").map(serverSegment));
  // two names with one tool prefix cannot be told apart by the guard: the run is refused
  const listed = servers.length > 0 ? servers.filter((s) => s !== "*") : [];
  // a name that ends in _ or holds __ cannot be told from the tool part of a tool name
  for (const name of [...listed, ...(servers.length > 0 ? (others ?? []) : [])]) {
    const segment = serverSegment(name);
    if (segment.endsWith("_") || segment.includes("__")) {
      throw new Error(
        `the server "${name}" would be called "${segment}" in tool names, which ends in _ or holds __: its tools cannot be told from another server's. Rename it in the profile`,
      );
    }
  }
  if (servers.length > 0 && others === undefined) {
    // without the list a clash cannot be seen: only a name that is its own segment is safe
    const odd = servers.find((s) => s === "*" || serverSegment(s) !== s);
    if (odd !== undefined) {
      throw new Error(
        `the servers of the profile could not be listed ("claude mcp list"), so the lane may only name servers whose names hold letters, digits, - and _ (not "${odd}")`,
      );
    }
  }
  if ((others ?? []).some((name) => serverSegment(name) === "factor")) {
    throw new Error(
      'the profile lists a server called "factor", the name of the factory\'s own: rename or remove it there',
    );
  }
  const raw = new Map(servers.map((s) => [serverSegment(s), s]));
  for (const name of [...servers, ...(others ?? [])]) {
    const other = raw.get(serverSegment(name));
    if (other !== undefined && other !== name) {
      throw new Error(
        `the servers "${other}" and "${name}" both become "mcp__${serverSegment(name)}__" in tool names`,
      );
    }
  }
  if (named.has("factor"))
    throw new Error('a profile server called "factor" would stand in for the factory\'s own');
  const inProfile = (others ?? []).map((name) => serverSegment(name));
  const allowed = [...named, ...(all ? inProfile.filter((s) => !named.has(s)) : [])];
  const shut = all || servers.length === 0 ? [] : [...new Set(inProfile.filter((s) => !named.has(s)))];
  const server = job.server ?? [];
  return [
    ...["-p", "--output-format", "stream-json", "--verbose"],
    ...(choice.model ? ["--model", choice.model] : []),
    ...(choice.effort ? ["--effort", choice.effort] : []),
    ...["--add-dir", job.laneDir],
    ...["--settings", JSON.stringify({ hooks })],
    // the worktree is the agent's to write: its settings, hooks and MCP servers are not loaded
    ...["--setting-sources", "user"],
    // the profile's servers load only for a lane that names one; the factory's own is given in both cases
    ...(servers.length > 0 ? [] : ["--strict-mcp-config"]),
    ...[
      "--mcp-config",
      JSON.stringify({ mcpServers: { factor: { command: server[0], args: server.slice(1) } } }),
    ],
    ...["--tools", tools], // the only built-in tools there are for this run
    // and they need no approval: nobody is there to give one
    ...[
      "--allowedTools",
      [tools, ...FACTOR_TOOLS.map(mcpName), ...allowed.map((s) => `mcp__${s}`)].join(","),
    ],
    ...(shut.length > 0 ? ["--disallowedTools", shut.map((s) => `mcp__${s}`).join(",")] : []),
  ]; // never --bare: it skips hooks, so the guard would not run. And no permission mode that skips checks.
}
