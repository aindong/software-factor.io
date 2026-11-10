// The guard: one decision over one tool call, made before the tool runs. It keeps an agent's
// writes in its worktree and its lane folder, and stops the few commands that cannot be undone.
// What it cannot read it denies. It is one wall of two (ADR 0004): a shell can always be spelled
// in a way a list of patterns misses, so the host's gates still judge everything that is committed.
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

export interface ToolCall {
  tool: unknown;
  input: unknown;
}
export interface Where {
  worktree: string;
  /** The lane's own folder, for its hand-off and evidence. */
  laneDir: string;
  access: "read" | "write";
  defaultBranch: string;
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

const PATH_KEY: Record<string, string> = {
  Write: "file_path",
  Edit: "file_path",
  MultiEdit: "file_path",
  NotebookEdit: "notebook_path",
};

// Files that hold logins and keys. An example file (.env.example) is not one.
const SECRET_FILE =
  /(^|\/)(\.env(\.(?!(example|sample|template)$)[^/]*)?|\.netrc|\.npmrc|\.pypirc|id_(rsa|dsa|ecdsa|ed25519)[^/]*|[^/]*\.(pem|key|p12|pfx)|\.credentials\.json)$|(^|\/)(\.ssh|\.aws|\.gnupg)\/|\.codex\/auth\.json$|\.kimi-code\/credentials(\/|$)/;
const SECRET_IN_SHELL = [
  /(^|[\s"'=<(/])\.env(\.(?!(example|sample|template)\b)[\w.-]+)?(?=$|[\s"';|&<>)])/,
  /\.ssh\/|\.aws\/|\.gnupg\/|\.codex\/auth\.json|\.credentials\.json|\.netrc\b|\.kimi-code\/credentials/,
  /\bsecurity\s+(find-(generic|internet)-password|dump-keychain|export)\b/,
];
const PIPE_TO_SHELL = /\b(curl|wget)\b[^;&\n]*\|\s*(sudo\s+)?(env\s+)?(ba|z|da|k)?sh\b/;
const WRAPPERS = new Set(["command", "exec", "env", "time", "nohup", "then", "do", "else", "{", "(", "!"]);
const READS_CONFIG = new Set(["--get", "--get-all", "--get-regexp", "--list", "-l"]);

function judgeWrite(path: unknown, where: Where): Verdict {
  if (typeof path !== "string" || path === "") return deny("This write names no file, so it is denied.");
  const worktree = real(where.worktree);
  const target = real(resolve(worktree, path));
  if (within(real(where.laneDir), target)) return ALLOW;
  if (!within(worktree, target)) {
    return deny(`"${path}" is outside the worktree. Write only inside ${worktree} or the lane's folder.`);
  }
  if (where.access !== "write") {
    return deny("This lane may only read the repository. Write only the hand-off and evidence.");
  }
  const parts = relative(worktree, target).split(sep);
  if (parts.includes(".git")) return deny("Files under .git belong to git. Use git commands instead.");
  if (parts[0] === ".factor") {
    return deny("The .factor folder holds the factory's own process. An agent may not change it.");
  }
  return ALLOW;
}

function judgePush(args: string[], where: Where): Verdict | undefined {
  const forced = args.some(
    (a) =>
      a === "-f" ||
      a.startsWith("--force") ||
      a === "--mirror" ||
      a === "--all" ||
      a === "--delete" ||
      a === "-d" ||
      a.startsWith("+"),
  );
  if (forced) return deny("A forced push, or a push that deletes or sends every branch, is not allowed.");
  const protectedNames = new Set(["main", "master", where.defaultBranch]);
  for (const ref of args.filter((a) => !a.startsWith("-")).slice(1)) {
    const to = (ref.includes(":") ? ref.slice(ref.indexOf(":") + 1) : ref).replace(/^refs\/heads\//, "");
    if (protectedNames.has(to)) {
      return deny(`A push to the default branch ("${to}") is not allowed. Push the run's own branch.`);
    }
  }
  return undefined;
}

function judgeDelete(args: string[], where: Where): Verdict | undefined {
  const recursive = args.some((a) => a === "--recursive" || (/^-[^-]/.test(a) && /[rR]/.test(a)));
  if (!recursive) return undefined;
  const worktree = real(where.worktree);
  for (const target of args.filter((a) => !a.startsWith("-"))) {
    if (/[$`~*]/.test(target.slice(0, 1)) || /[$`]/.test(target)) {
      return deny(
        `A recursive delete of "${target}" cannot be checked, so it is denied. Name a path in the worktree.`,
      );
    }
    const path = resolve(worktree, target);
    const inside = path !== worktree && (within(worktree, path) || within(real(where.laneDir), path));
    if (!inside) return deny(`A recursive delete outside the worktree ("${target}") is not allowed.`);
  }
  return undefined;
}

function judgeShell(command: unknown, where: Where): Verdict {
  if (typeof command !== "string") return deny("This shell command is not text, so it is denied.");
  if (PIPE_TO_SHELL.test(command)) {
    return deny("A download piped into a shell is not allowed. Save the file and read it first.");
  }
  if (/\.git\/(hooks|config)\b/.test(command)) {
    return deny("Git's hooks and configuration may not be changed by an agent.");
  }
  if (SECRET_IN_SHELL.some((p) => p.test(command))) {
    return deny("This command names a file or a store that holds secrets. An agent may not read those.");
  }
  // Quotes are not parsed: a word in a quoted text counts as a word of the command. That denies
  // too much now and then, never too little.
  for (const part of command.split(/\|\||&&|[;|&\n]/)) {
    const words = part
      .trim()
      .split(/\s+/)
      .map((w) => w.replace(/^["'(]+|["')]+$/g, ""))
      .filter(Boolean);
    if (words.some((w) => w === "sudo" || w === "doas")) {
      return deny("sudo is not allowed. An agent works with the rights of its own user.");
    }
    while (words[0] !== undefined && (WRAPPERS.has(words[0]) || /^\w+=/.test(words[0]))) words.shift();
    const [first, ...rest] = words;
    if (first === "rm") {
      const verdict = judgeDelete(rest, where);
      if (verdict) return verdict;
    }
    if (first !== "git") continue;
    // skip git's own options, such as -C <dir> and -c <setting>, to find the subcommand
    let at = 0;
    while (rest[at]?.startsWith("-")) at += rest[at] === "-C" || rest[at] === "-c" ? 2 : 1;
    const args = rest.slice(at + 1);
    if (rest[at] === "push") {
      const verdict = judgePush(args, where);
      if (verdict) return verdict;
    }
    if (rest[at] === "config" && !args.some((a) => READS_CONFIG.has(a))) {
      return deny("Changing git's configuration is not allowed. It decides what git runs later.");
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
    if (tool === "Read" && typeof values.file_path === "string" && SECRET_FILE.test(values.file_path)) {
      return deny(`"${values.file_path}" may hold a secret. An agent may not read it.`);
    }
    return ALLOW;
  } catch (error) {
    return deny(`The guard could not check this tool call, so it is denied: ${(error as Error).message}`);
  }
}
