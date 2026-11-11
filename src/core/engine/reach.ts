// What a lane may reach beyond files and the shell: the skills and the profile servers its
// workflow names. The guard holds the lane to these (agents/reach.ts); this works out the names
// as the agent's CLI knows them, and the approval a machine gives for the servers.
import { createHash } from "node:crypto";
import { UserError } from "../errors.ts";
import { own } from "../schema/builtins.ts";
import type { Lane, Workflow } from "../schema/workflow.ts";
import type { Workspace } from "../workspace.ts";

/**
 * The names the Skill tool and the servers go by. A skill from a profile goes by its key. One from
 * a repository goes by its `skill` name; with none (all the skills of the source) the names are
 * not known, so the lane gets none of them. A server goes by the profile's name, else its key.
 */
export function reachOf(w: Workflow, lane: Lane): { skills: string[]; servers: string[] } {
  const skills = (lane.agent?.skills ?? []).flatMap((key) => {
    if (key === "*") return ["*"];
    const decl = own(w.skills, key);
    if (!decl) return [];
    return decl.from === "repo" ? (decl.skill ? [decl.skill] : []) : [key];
  });
  const servers = (lane.agent?.servers ?? []).flatMap((key) => {
    if (key === "*") return ["*"];
    const decl = own(w.mcp, key);
    return decl?.from === "profile" ? [decl.name ?? key] : [];
  });
  return { skills, servers };
}

/** The lines of a prompt that say what the lane may use. Empty for a lane that has none. */
export function reachSection(w: Workflow, lane: Lane): string {
  const { skills, servers } = reachOf(w, lane);
  const lines = [
    ...(skills.length === 0
      ? []
      : [
          skills.includes("*")
            ? "You may use any skill with the Skill tool."
            : `You may use these skills with the Skill tool, and no others: ${skills.join(", ")}.`,
        ]),
    ...(servers.length === 0
      ? []
      : [
          servers.includes("*")
            ? "You may use the tools of any MCP server you are given."
            : `You may use the tools of these MCP servers, and no others: ${servers.join(", ")}.`,
        ]),
  ];
  return lines.length === 0 ? "" : `# What you may use\n\n${lines.join("\n")}`;
}

/** What a machine approves for a profile server: its name in the profile. A change asks again. */
export const printOfProfile = (name: string) =>
  createHash("sha256")
    .update(JSON.stringify(["profile", name]))
    .digest("hex");

/** The profile servers the lanes name, by the workflow's key (or "*"), each with the name to approve. */
export function serversNeeded(ws: Workspace): Map<string, string> {
  const needed = new Map<string, string>();
  for (const lane of ws.workflow.lanes) {
    for (const key of lane.agent?.servers ?? []) {
      const decl = own(ws.workflow.mcp, key);
      if (key === "*") needed.set(key, "*");
      else if (decl?.from === "profile") needed.set(key, decl.name ?? key);
    }
  }
  return needed;
}

/** What stands in the way of a lane using a profile server on this machine, or nothing. */
export function serverProblem(ws: Workspace, key: string, name: string): UserError | undefined {
  const allowed = own(ws.local.servers, key);
  if (allowed === printOfProfile(name)) return undefined;
  const what = key === "*" ? "every server of the account" : `the profile server "${name}"`;
  return new UserError(
    `The server "${key}" (${what}) ${allowed ? "has changed since it was allowed" : "is not allowed on this machine"}.`,
    `A server reaches outside the worktree, and the gates do not see what it does. Allow it with: softwarefactor allow ${key === "*" ? "'*'" : key}`,
  );
}
