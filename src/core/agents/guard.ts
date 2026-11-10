// The guard: one decision over one tool call, made before the tool runs. It keeps an agent's
// writes in its worktree and its lane folder, and stops the few commands that cannot be undone.
// What it cannot read it denies, and a tool it has no rule for it denies. It is one wall of two
// (ADR 0004): a shell can always be spelled in a way a list of patterns misses, so the host's
// gates still judge everything that is committed.
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { FACTOR_TOOLS, mcpName } from "./factor-tools.ts";
import {
  DOWNLOAD_AS_COMMAND,
  OWNED_IN_SHELL,
  PIPE_TO_SHELL,
  SECRET_FILE,
  SECRET_GLOB,
  SECRET_IN_SHELL,
} from "./guard-patterns.ts";

export interface ToolCall {
  tool: unknown;
  input: unknown;
}
export interface Where {
  worktree: string;
  /** The lane's own folder, for its hand-off and evidence. */
  laneDir: string;
  access: "read" | "write";
  /** The branches an agent must not push to or move, besides main and master. */
  defaultBranch: string | string[];
  /** The path of the factory's own program, which an agent may not run, move or change. */
  self?: string;
}
export interface Verdict {
  allow: boolean;
  reason?: string;
}

const deny = (reason: string): Verdict => ({ allow: false, reason });
const ALLOW: Verdict = { allow: true };

/** The path with every link on the way resolved, also when its last parts do not exist yet. */
function real(path: string): string {
  let existing = path;
  const rest: string[] = [];
  for (;;) {
    let isLink = false;
    try {
      isLink = lstatSync(existing).isSymbolicLink();
    } catch {
      // does not exist
    }
    if (existsSync(existing)) break;
    if (isLink) throw new Error("a link that leads nowhere");
    if (dirname(existing) === existing) break;
    rest.unshift(basename(existing));
    existing = dirname(existing);
  }
  return join(realpathSync(existing), ...rest);
}
const within = (dir: string, path: string) => path === dir || path.startsWith(`${dir}${sep}`);
/** A path's parts below the worktree, in small letters: where case is ignored, .GIT is .git. */
const partsIn = (worktree: string, path: string) => relative(worktree, path).toLowerCase().split(sep);

const PATH_KEY: Record<string, string> = {
  Write: "file_path",
  Edit: "file_path",
  MultiEdit: "file_path",
  NotebookEdit: "notebook_path",
};
const READS = new Set(["Read", "Grep", "Glob"]);
// Folders and files an agent CLI reads its own settings, hooks and servers from.
const CLI_OWNED = new Set([".claude", ".codex", ".kimi-code", ".agents", ".mcp.json"]);

// Words that only start another command: what follows them is judged as the command.
const WRAPPERS = new Set([
  ...["command", "exec", "env", "time", "nohup", "nice", "then", "do", "else", "{", "(", "!"],
  ...["bash", "sh", "zsh", "dash", "eval", "xargs", "-c", "-lc"],
]);
// Commands whose other words are text, such as a commit message: "sudo" there is only a word.
const TEXT_ONLY = new Set(["git", "echo", "printf", "grep", "rg"]);
const SUPERUSER = new Set(["sudo", "doas"]);
const FACTORY = "softwarefactor";
const FACTORY_COMMANDS = new Set([
  ...["init", "collect", "run", "stop", "approve", "reject", "send-back", "answer"],
  ...[
    "account",
    "role",
    "memory",
    "mcp",
    "guard",
    "ui",
    "allow",
    "mcp-call",
    "add",
    "import",
    "export",
    "ladder",
    "escape",
    "retro",
    "eval",
  ],
]);
// What an agent may do on GitHub with the person's login: read, and open its own pull request.
// It is a list of what is allowed, not of what is not: a list of forbidden words is passed by
// the next spelling (an alias, an extension, an option's value before the subcommand).
const GH_MAY: Record<string, Set<string>> = {
  issue: new Set(["view", "list", "status"]),
  pr: new Set(["view", "list", "status", "diff", "checks", "create"]),
  run: new Set(["view", "list", "watch"]),
  repo: new Set(["view", "list"]),
  release: new Set(["view", "list"]),
  workflow: new Set(["view", "list"]),
  label: new Set(["list"]),
  search: new Set(["issues", "prs", "repos", "code", "commits"]),
};
const GH_ALONE = new Set(["status", "help", "version"]);
// gh takes its subcommand from anywhere after the group, so one of these as a later word may be the real one
const GH_WRITES = new Set([
  ...[
    "merge",
    "close",
    "reopen",
    "edit",
    "delete",
    "comment",
    "review",
    "ready",
    "lock",
    "unlock",
    "transfer",
  ],
  ...["pin", "unpin", "develop", "rename", "archive", "unarchive", "sync", "fork", "upload", "run", "rerun"],
  ...[
    "cancel",
    "enable",
    "disable",
    "set",
    "install",
    "remove",
    "upgrade",
    "login",
    "logout",
    "token",
    "refresh",
  ],
]);
const GH_API_WRITES = /^(-f|-F|--field|--raw-field|--input)(=|$)|^-[fF]./;

/** The words after `gh`, with quoted text already taken out. */
function judgeGh(words: string[]): Verdict | undefined {
  const plain = words.filter((w) => !w.startsWith("-"));
  const [group, verb = ""] = plain;
  if (group === undefined || (GH_ALONE.has(group) && plain.length === 1)) return undefined;
  if (group === "auth") return deny("The GitHub login may not be read or changed by an agent.");
  if (group === "api") {
    // a method other than GET, a field (which makes the call a POST), or the GraphQL endpoint is a write
    const method = words.flatMap((w, i) =>
      /^(-X|--method)$/.test(w)
        ? [words[i + 1] ?? ""]
        : /^(-X.|--method=)/.test(w)
          ? [w.replace(/^(-X|--method=)/, "")]
          : [],
    );
    const writes =
      method.some((m) => m.toUpperCase() !== "GET") ||
      words.some((w) => GH_API_WRITES.test(w)) ||
      plain.includes("graphql");
    return writes ? deny("An agent may read the GitHub API with gh, not write to it.") : undefined;
  }
  const may = Object.hasOwn(GH_MAY, group) && GH_MAY[group]?.has(verb);
  if (may && !plain.slice(2).some((w) => GH_WRITES.has(w))) return undefined;
  return deny(
    `An agent may read GitHub with gh and open its own pull request, nothing else: "gh ${plain.slice(0, 3).join(" ")}" is for a person.`,
  );
}

const READS_CONFIG = new Set(["--get", "--get-all", "--get-regexp", "--list", "-l"]);
const GIT_VALUE_OPTIONS = new Set(["-C", "-c", "--exec-path"]);
const GIT_ELSEWHERE = /^--(git-dir|work-tree|namespace|config-env)(=|$)/;
const GIT_DENIED = new Set(["update-ref", "filter-branch", "credential", "replace"]);
const MOVES_BRANCH = /^(-[a-zA-Z]*[fBCMDdm][a-zA-Z]*|--force|--delete|--move)$/;
const FACTOR_PATH = /(^|\/)\.factor(\/|$)/;
const MAX_COMMAND = 64_000; // a hook that runs too long is skipped by the CLI
/** A command by its name, however its path was spelled. */
const nameOf = (word: string) => word.slice(word.lastIndexOf("/") + 1);
/** A branch as git will read it: with or without refs/ and heads/ in front. */
const branchOf = (ref: string) => ref.replace(/^refs\//, "").replace(/^heads\//, "");
const protectedNames = (where: Where) => new Set(["main", "master", ...[where.defaultBranch].flat()]);

function judgeWrite(path: unknown, where: Where): Verdict {
  if (typeof path !== "string" || path === "") return deny("This write names no file, so it is denied.");
  const worktree = real(where.worktree);
  const target = real(resolve(worktree, path));
  if (within(real(where.laneDir), target)) return ALLOW;
  if (!within(worktree, target)) {
    return deny(`"${path}" is outside the worktree. Write only inside ${worktree} or the lane's folder.`);
  }
  if (where.access !== "write") {
    return deny("This lane may only read the repository. Give the hand-off in your last message.");
  }
  const parts = partsIn(worktree, target);
  if (parts.includes(".git")) return deny("Files under .git belong to git. Use git commands instead.");
  if (parts[0] === ".factor") {
    return deny("The .factor folder holds the factory's own process. An agent may not change it.");
  }
  if (CLI_OWNED.has(parts[0] ?? "")) {
    return deny(`"${parts[0]}" holds an agent CLI's own settings. An agent may not change them.`);
  }
  return ALLOW;
}

function judgeRead(tool: string, values: Record<string, unknown>, where: Where): Verdict {
  for (const key of ["file_path", "path"]) {
    const path = values[key];
    if (typeof path !== "string") continue;
    // by its name, and by where it leads: a link with a harmless name can point at a key
    if (SECRET_FILE.test(path) || SECRET_FILE.test(real(resolve(real(where.worktree), path)))) {
      return deny(`"${path}" may hold a secret. An agent may not read it.`);
    }
  }
  const globs = [values.glob, tool === "Glob" ? values.pattern : undefined];
  if (globs.some((g) => typeof g === "string" && SECRET_GLOB.test(g))) {
    return deny("This search names files that may hold secrets. An agent may not read them.");
  }
  return ALLOW;
}

function judgePush(args: string[], where: Where): Verdict | undefined {
  const forced = args.some(
    (a) =>
      /^-[a-zA-Z]*[fd][a-zA-Z]*$/.test(a) || // -f and -d, also inside a group such as -uf
      a.startsWith("--force") ||
      a === "--mirror" ||
      a === "--all" ||
      a === "--delete" ||
      a.startsWith("+"),
  );
  if (forced) return deny("A forced push, or a push that deletes or sends every branch, is not allowed.");
  const names = protectedNames(where);
  for (const ref of args.filter((a) => !a.startsWith("-")).slice(1)) {
    const to = branchOf(ref.includes(":") ? ref.slice(ref.indexOf(":") + 1) : ref);
    if (names.has(to)) {
      return deny(`A push to the default branch ("${to}") is not allowed. Push the run's own branch.`);
    }
  }
  return undefined;
}

/** Why a path may not be deleted with everything below it, if it may not. */
function deleteProblem(target: string, where: Where, moved: boolean, itself: boolean): string | undefined {
  const unknown = moved && !target.startsWith("/"); // after a cd, a relative path is somewhere else
  if (unknown || /^[~*]/.test(target) || /[$`]/.test(target)) {
    return `A delete of "${target}" cannot be checked, so it is denied. Name a path in the worktree.`;
  }
  const worktree = real(where.worktree);
  const path = real(resolve(worktree, target)); // through links: rm follows them
  const inside = within(worktree, path) || within(real(where.laneDir), path);
  if (!inside || (itself && path === worktree)) {
    return `A delete outside the worktree ("${target}") is not allowed.`;
  }
  const parts = partsIn(worktree, path);
  if (parts.includes(".git") || parts[0] === ".factor") {
    return `"${target}" belongs to git or to the factory. An agent may not delete it.`;
  }
  return undefined;
}

function judgeDelete(first: string, args: string[], where: Where, moved: boolean): Verdict | undefined {
  let targets: string[];
  if (first === "rm") {
    const recursive = args.some((a) => a === "--recursive" || (/^-[^-]/.test(a) && /[rR]/.test(a)));
    if (!recursive) return undefined;
    targets = args.filter((a) => !a.startsWith("-"));
    if (targets.length === 0) return deny("A recursive delete that names no path cannot be checked.");
  } else {
    if (!args.some((a) => /^-(delete|exec|execdir|ok)$/.test(a))) return undefined;
    const flagAt = args.findIndex((a) => /^[-(!]/.test(a));
    targets = args.slice(0, flagAt < 0 ? args.length : flagAt);
    if (targets.length === 0) targets = ["."];
  }
  for (const target of targets) {
    // rm deletes the path itself, find deletes below it: the worktree is a fine place for find to start
    const problem = deleteProblem(target, where, moved, first === "rm");
    if (problem) return deny(problem);
  }
  return undefined;
}

function judgeGit(rest: string[], where: Where): Verdict | undefined {
  // git's own options come first, such as -C <dir>: skip them to find the subcommand
  let at = 0;
  while (rest[at]?.startsWith("-")) {
    const option = rest[at] ?? "";
    if (GIT_ELSEWHERE.test(option)) {
      return deny("Pointing git at another folder or configuration is not allowed.");
    }
    if (option === "-c" && !/^user\.(name|email)=/.test(rest[at + 1] ?? "")) {
      return deny(
        "Setting git's configuration for one command is not allowed, except user.name and user.email.",
      );
    }
    at += GIT_VALUE_OPTIONS.has(option) ? 2 : 1;
  }
  const sub = rest[at] ?? "";
  const args = rest.slice(at + 1);
  const plain = args.filter((a) => !a.startsWith("-"));
  if (sub === "push") return judgePush(args, where);
  if (sub === "config" && !args.some((a) => READS_CONFIG.has(a))) {
    return deny("Changing git's configuration is not allowed. It decides what git runs later.");
  }
  if (GIT_DENIED.has(sub) || sub.startsWith("credential-")) {
    return deny(`"git ${sub}" is not allowed: it rewrites what git keeps, or reads a stored login.`);
  }
  if (sub === "symbolic-ref" && plain.length > 1) return deny("Moving HEAD by hand is not allowed.");
  if (sub === "worktree" && plain[0] !== "list") {
    return deny("Adding or changing worktrees is the host's job, not an agent's.");
  }
  const names = protectedNames(where);
  const touchesProtected = plain.some((a) => names.has(branchOf(a)));
  if ((sub === "checkout" || sub === "switch") && touchesProtected) {
    return deny("Leave the default branch alone: work stays on the run's own branch.");
  }
  if (sub === "branch" && touchesProtected && args.some((a) => MOVES_BRANCH.test(a))) {
    return deny("Moving, renaming or deleting the default branch is not allowed.");
  }
  return undefined;
}

function judgeShell(command: unknown, where: Where): Verdict {
  if (typeof command !== "string") return deny("This shell command is not text, so it is denied.");
  if (command.length > MAX_COMMAND) {
    return deny("This shell command is too long to check in time, so it is denied. Put it in a script file.");
  }
  if (PIPE_TO_SHELL.test(command) || DOWNLOAD_AS_COMMAND.test(command)) {
    return deny("A download piped into a shell is not allowed. Save the file and read it first.");
  }
  if (OWNED_IN_SHELL.some((p) => p.test(command))) {
    return deny(
      "This command names something that git, the factory or an agent CLI owns, such as .git or CLI settings. Use git commands, and leave the rest alone.",
    );
  }
  if (where.self && command.includes(where.self)) {
    return deny("The factory's own program may not be run, moved or changed by an agent.");
  }
  if (SECRET_IN_SHELL.some((p) => p.test(command))) {
    return deny("This command names a file or a store that holds secrets. An agent may not read those.");
  }
  // Quotes are not parsed: they are dropped, and a word in a quoted text counts as a word of the
  // command. That denies too much now and then, never too little.
  let moved = false;
  const laneDir = real(where.laneDir);
  const worktree = real(where.worktree);
  for (const part of command.split(/\|\||&&|[;|&\n]/)) {
    const words = part
      .trim()
      .split(/\s+/)
      .map((w) => w.replace(/["'\\]/g, "").replace(/^(\d*[<>]+&?|\()+|\)+$/g, ""))
      .filter(Boolean);
    for (const word of words) {
      if (/^GIT_[A-Z_0-9]+=/.test(word)) return deny("Setting git's environment is not allowed.");
      // The factory's folders are off limits. The worktree and the lane's folder are under the
      // factor home themselves, so a path into them is fine, but not the worktree's own .factor.
      if (FACTOR_PATH.test(word)) {
        const path = /^~|\$/.test(word) ? undefined : real(resolve(worktree, word));
        const own =
          path !== undefined &&
          (within(laneDir, path) || (within(worktree, path) && partsIn(worktree, path)[0] !== ".factor"));
        if (!own) return deny("The factory's own folders may not be read or changed from the shell.");
      }
    }
    while (words[0] !== undefined && (WRAPPERS.has(nameOf(words[0])) || /^\w+=/.test(words[0]))) {
      words.shift();
    }
    const first = nameOf(words[0] ?? "");
    const rest = words.slice(1);
    if (SUPERUSER.has(first) || (!TEXT_ONLY.has(first) && rest.some((w) => SUPERUSER.has(nameOf(w))))) {
      return deny("sudo is not allowed. An agent works with the rights of its own user.");
    }
    // The factory's command is for people: an agent that runs it could approve or keep its own
    // work. Only the command counts, not the word: as the command itself, or before one of its
    // own subcommands. Quoted text is left out, so a test's name with the word in it is fine.
    const bare = part
      .replace(/"[^"]*"|'[^']*'/g, " ")
      .trim()
      .split(/\s+/);
    // the login's token, taken inside another command: $(gh auth token)
    if (/(\$\(|`)\s*(\S*\/)?gh\s+auth\b/.test(part)) {
      return deny("The GitHub login may not be read or changed by an agent.");
    }
    // Right before one of its commands, in whatever is not quoted text. And, where its name
    // stands as a word of the command (not inside a quoted text, such as a test's name), any of
    // its commands after it, with quotes and backslashes dropped: options may stand between the
    // two, and "retro" is retro.
    const named = bare.some((w) => nameOf(w) === FACTORY) || /["'][^"'\s]*softwarefactor["']/.test(part);
    const runsFactory =
      bare.some((w, i) => nameOf(w) === FACTORY && FACTORY_COMMANDS.has(bare[i + 1] ?? "")) ||
      (named &&
        !TEXT_ONLY.has(first) &&
        words.some(
          (w, i) => nameOf(w) === FACTORY && words.slice(i + 1).some((c) => FACTORY_COMMANDS.has(c)),
        ));
    if (first === FACTORY || runsFactory) {
      return deny("The softwarefactor command is for people. Use the tools of the factor server.");
    }
    if (first === "cd" || first === "pushd") moved = true;
    const verdict =
      first === "rm" || first === "find"
        ? judgeDelete(first, rest, where, moved)
        : first === "git"
          ? judgeGit(rest, where)
          : undefined;
    if (verdict) return verdict;
    // gh, wherever it stands in the command: after a wrapper this guard does not know, or as what find runs
    for (const [i, word] of bare.entries()) {
      const refused = nameOf(word) === "gh" ? judgeGh(bare.slice(i + 1)) : undefined;
      if (refused) return refused;
    }
  }
  return ALLOW;
}

/** Decide one tool call. Anything that cannot be read, or that makes the check itself fail, is denied. */
export function judge(call: ToolCall, where: Where): Verdict {
  try {
    const { tool, input } = call;
    if (typeof tool !== "string" || tool === "" || typeof input !== "object" || input === null) {
      return deny("The guard could not read this tool call, so it is denied.");
    }
    const values = input as Record<string, unknown>;
    const pathKey = Object.hasOwn(PATH_KEY, tool) ? PATH_KEY[tool] : undefined;
    if (pathKey) return judgeWrite(values[pathKey], where);
    if (tool === "Bash") return judgeShell(values.command, where);
    if (READS.has(tool)) return judgeRead(tool, values, where);
    // the factory's own server: its tools check their own input, and it has none that changes the rules
    if (FACTOR_TOOLS.some((name) => mcpName(name) === tool)) return ALLOW;
    return deny(`The guard has no rule for the tool "${tool}", so it is denied.`);
  } catch (error) {
    return deny(`The guard could not check this tool call, so it is denied: ${(error as Error).message}`);
  }
}
