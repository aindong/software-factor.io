// What a lane may reach beyond file and shell tools: the skills and the MCP servers its workflow
// names. These are the guard's rules for them; the arguments of the CLI only make the same list
// visible to the agent. A name that cannot be read is denied.
import type { Verdict } from "./guard.ts";

/** A server's name as Claude Code puts it in a tool's name: every character outside A-Za-z0-9_- is _. */
export const serverSegment = (name: string) => name.replace(/[^A-Za-z0-9_-]/g, "_");

const deny = (reason: string): Verdict => ({ allow: false, reason });
const ALLOW: Verdict = { allow: true };

/**
 * The verdict for a Skill call or an MCP tool call, or nothing for any other tool. The factory's
 * own tools are judged before this.
 */
export function judgeReach(
  tool: string,
  input: Record<string, unknown>,
  skills: string[] = [],
  servers: string[] = [],
): Verdict | undefined {
  if (tool === "Skill") {
    const name = input.skill;
    if (typeof name !== "string" || name === "")
      return deny("The guard could not read the skill's name, so it is denied.");
    if (skills.includes("*") || skills.includes(name)) return ALLOW;
    return deny(`This lane may not use the skill "${name}". It may use: ${skills.join(", ") || "none"}.`);
  }
  if (!tool.startsWith("mcp__")) return undefined;
  // mcp__<server>__<tool>: the server is what stands before the first double underscore, the tool
  // is one name after it. A tool that still holds "__" could belong to a server with "__" in its
  // name, and a lane that names "docs" must not reach that server: it is denied.
  const rest = tool.slice("mcp__".length);
  const at = rest.indexOf("__");
  const server = rest.slice(0, at);
  const name = rest.slice(at + 2);
  if (at < 1 || name === "" || name.includes("__"))
    return deny(`The guard could not read the tool "${tool}", so it is denied.`);
  // the factory's own tools were judged before this: any other tool of "factor" does not exist
  if (server === "factor") return deny(`The guard has no such tool of the factory's server: "${tool}".`);
  if (servers.includes("*") || servers.some((s) => serverSegment(s) === server)) return ALLOW;
  return deny(`This lane may not use tools of the MCP server "${server}".`);
}
