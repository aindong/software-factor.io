// Skills a workflow names from a repository. They are installed into a run's worktree with
// `npx skills`, for the agent of each lane that names them. A skill is someone else's
// instructions put before an agent, fetched over the network: the person allows each one on this
// machine first, by its source and name, and is asked again when the workflow changes either.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { accountOf, rolesOf } from "../agents/index.ts";
import { MINUTE_MS } from "../clock.ts";
import { UserError } from "../errors.ts";
import { hostEnv } from "../exec.ts";
import { git } from "../git.ts";
import { own } from "../schema/builtins.ts";
import { oneLine } from "../text.ts";
import type { Workspace } from "../workspace.ts";

// the version this was written against (docs/research/agent-clis.md): a later one is a change to read first
const SKILLS = "skills@1.7.6";
// the names `npx skills` has for the agents the factory runs. The scripted agent stands in for Claude Code.
const AGENT = { claude: "claude-code", codex: "codex", kimi: "kimi-code-cli", fake: "claude-code" } as const;
// a repository on GitHub and a plain name: nothing npx could read as an option, an address or a path on this machine
const REPO = /^(?!-)(?!\.)[A-Za-z0-9_.-]+\/(?!-)(?!\.)[A-Za-z0-9_.-]+$/;
const NAME = /^(?!-)[A-Za-z0-9_.-]+$/;
// where `npx skills` puts a skill for the agents the factory runs
const SKILL_DIR = /^(\.claude|\.agents|\.kimi-code)\/skills\/[A-Za-z0-9_.-]+\//;
const TOP_FILE = /^[A-Za-z0-9_.-]+$/; // a file of its own at the top of the worktree, such as its lock

export interface Needed {
  name: string;
  source: string;
  skill?: string;
  /** The agents to install it for, by `npx skills` names. */
  agents: string[];
}
export const printOfSkill = (s: { source: string; skill?: string }) =>
  createHash("sha256")
    .update(JSON.stringify([s.source, s.skill ?? ""]))
    .digest("hex");
const shown = (s: { source: string; skill?: string }) => `${s.source}${s.skill ? `, ${s.skill}` : ""}`;

/** The skills from a repository that the workflow's lanes name, each with the agents of those lanes. */
export function skillsNeeded(ws: Workspace): Needed[] {
  const needed = new Map<string, Needed>();
  for (const lane of ws.workflow.lanes) {
    for (const name of lane.agent?.skills ?? []) {
      const skill = own(ws.workflow.skills, name);
      if (skill?.from !== "repo") continue; // one in the agent's profile is already there
      const entry = needed.get(name) ?? { name, source: skill.source, skill: skill.skill, agents: [] };
      for (const role of rolesOf(lane)) {
        const binding = own(ws.local.roles, role);
        if (!binding) continue;
        const agent = "adapter" in binding ? binding.adapter : accountOf(binding, role)?.account.agent;
        // an agent that is only a command has no place for skills
        const as = agent && Object.hasOwn(AGENT, agent) ? AGENT[agent as keyof typeof AGENT] : undefined;
        if (as && !entry.agents.includes(as)) entry.agents.push(as);
      }
      needed.set(name, entry);
    }
  }
  return [...needed.values()];
}

/** What stands in the way of a skill being installed here, or nothing. */
export function skillProblem(ws: Workspace, s: Needed): UserError | undefined {
  if (!REPO.test(s.source) || (s.skill !== undefined && !NAME.test(s.skill))) {
    return new UserError(
      `The source of the skill "${s.name}" (${shown(s)}) is not a repository.`,
      "Name it as owner/repo, and the skill by its plain name.",
    );
  }
  const allowed = own(ws.local.skills, s.name);
  if (allowed === printOfSkill(s)) return undefined;
  return new UserError(
    `The skill "${s.name}" (${shown(s)}) ${allowed ? "has changed since it was allowed" : "is not allowed on this machine"}.`,
    `It is instructions from that repository, put before the lane's agent. Allow it with: softwarefactor allow --skill ${s.name}`,
  );
}

/** Install the workflow's skills into a run's worktree, and keep them out of what the run changes. */
export function installSkills(ws: Workspace, worktree: string): void {
  for (const s of skillsNeeded(ws)) {
    const problem = skillProblem(ws, s);
    if (problem) throw problem;
    const before = new Set(untracked(worktree));
    for (const agent of s.agents) {
      const r = spawnSync(
        "npx",
        ["--yes", SKILLS, "add", s.source, ...(s.skill ? ["-s", s.skill] : []), "-a", agent, "-y", "--copy"],
        {
          cwd: worktree,
          encoding: "utf8",
          // what npx needs to reach the network from behind a proxy, and nothing else of the person's
          env: hostEnv(["HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "https_proxy", "http_proxy", "no_proxy"]),
          timeout: 5 * MINUTE_MS,
        },
      );
      if (r.status !== 0) {
        throw new Error(
          `the skill "${s.name}" could not be installed: ${oneLine(r.stderr || r.error?.message || `npx exited ${r.status}`, 300)}`,
        );
      }
    }
    // What it put there is not the run's work: git is told to leave it out, for this repository
    // (a worktree has no ignore list of its own, so the lines also hold in the main checkout).
    // Only a skill's own folder and a file of the installer's at the top are named, each exactly:
    // a line made from any other path could hide the agent's real work.
    const lines = new Set<string>();
    for (const path of untracked(worktree)) {
      if (before.has(path)) continue;
      const folder = SKILL_DIR.exec(path)?.[0];
      if (folder) lines.add(`/${folder}`);
      else if (TOP_FILE.test(path)) lines.add(`/${path}`);
    }
    if (lines.size > 0) {
      const exclude = git(worktree, "rev-parse", "--path-format=absolute", "--git-path", "info/exclude");
      mkdirSync(dirname(exclude), { recursive: true });
      const text = existsSync(exclude) ? readFileSync(exclude, "utf8") : "";
      const fresh = [...lines].filter((l) => !text.split("\n").includes(l));
      if (fresh.length > 0) {
        // after a line end: the file's last pattern must not run into the first new one
        appendFileSync(
          exclude,
          `${text === "" || text.endsWith("\n") ? "" : "\n"}# skills the factory installed for a run\n${fresh.join("\n")}\n`,
        );
      }
    }
  }
}

const untracked = (worktree: string) =>
  git(worktree, "ls-files", "--others", "--exclude-standard", "-z").split("\0").filter(Boolean);
