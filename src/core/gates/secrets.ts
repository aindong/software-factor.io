// core/no-secrets@1: a lane's change may not add something shaped like a secret. Every commit of
// the change is read, not only what it leaves: a commit keeps what a later commit removes. A line
// that the base commit already holds in that file is not the lane's doing. The commits' messages
// are read too. What is found is named by its file, its line and its first characters, never in full.
import { execFileSync } from "node:child_process";
import { hostEnv } from "../exec.ts";
import { TOKEN, URL_SECRET } from "../schema/builtins.ts";
import { fileAt, type GateJob, record } from "./types.ts";

const MOST_BYTES = 256 * 1024 * 1024;
const TOKENS = new RegExp(TOKEN.source, "gi");
const URLS = new RegExp(URL_SECRET.source, "gi");
// A URL to this machine or to an example host, and a parameter whose value is one plain word, are
// what a README shows. The host must end there: git.local.acme.io is no local host. A real token
// has a digit in it, or letters of both cases.
const LOCAL =
  /^(localhost|127\.0\.0\.1|\[::1\]|[\w.-]*\.(local|test|example)|example\.(com|org|net))(?![\w.-])/i;
function harmless(match: string, after: string): boolean {
  if (match.startsWith("://")) return LOCAL.test(after);
  const value = /^[?&;][^=]*=(.*)$/.exec(match)?.[1];
  return value !== undefined && !/\d/.test(value) && !(/[a-z]/.test(value) && /[A-Z]/.test(value));
}

/** The first characters of everything in a text that looks like a secret. A token is one by its
 * own shape wherever it stands, also in a URL to this machine. */
function secretsIn(text: string): string[] {
  const hits = [...text.matchAll(TOKENS)].map((m) => m[0]);
  for (const m of text.matchAll(URLS))
    if (!harmless(m[0], text.slice(m.index + m[0].length))) hits.push(m[0]);
  return hits.map((hit) => `${hit.slice(0, 4)}...`);
}

const log = (g: GateJob, ...args: string[]) =>
  execFileSync("git", ["-c", "core.quotePath=false", "log", ...args, `${g.base}..${g.head}`], {
    cwd: g.ws.root,
    encoding: "utf8",
    env: hostEnv(),
    maxBuffer: MOST_BYTES,
    stdio: ["ignore", "pipe", "pipe"],
  });

interface Added {
  commit: string;
  path: string;
  line: number;
  text: string;
}

/** Every line a commit of base..head added. A merge is read against its first parent, and a file
 * that the repository calls binary is read as text all the same. */
function addedLines(g: GateJob): Added[] {
  // every setting of a person's git that changes the shape of a patch is named here
  // biome-ignore format: one flag a line reads worse
  const raw = log(g, "-p", "--unified=0", "--inter-hunk-context=0", "--src-prefix=a/", "--dst-prefix=b/", "-M", "--diff-merges=first-parent", "--no-ext-diff", "--no-textconv", "--text", "--no-color", "--format=%x00%h");
  const out: Added[] = [];
  let commit = "";
  let path = "";
  let line = 0;
  let left = 0; // the lines of the hunk that are still to come, so that no line of a file is read as a header
  for (const text of raw.split("\n")) {
    if (left > 0) {
      if (text.startsWith("\\")) continue;
      left -= 1;
      if (!text.startsWith("+")) continue;
      out.push({ commit, path, line, text: text.slice(1).replace(/\r$/, "") });
      line += 1;
      continue;
    }
    if (text.startsWith("\0")) commit = text.slice(1);
    // git puts a tab after a name that has a space in it
    else if (text.startsWith("+++ ")) path = text.slice(4).replace(/^b\//, "").replace(/\t$/, "");
    const hunk = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(text);
    if (hunk) {
      line = Number(hunk[2]);
      left = Number(hunk[1] ?? 1) + Number(hunk[3] ?? 1);
    }
  }
  return out;
}

export function noSecretsGate(g: GateJob) {
  const started = Date.now();
  let added: Added[];
  let messages: string[];
  try {
    added = addedLines(g);
    // no message holds a NUL, so each part is one commit: its short name, then its message
    messages = log(g, "--format=%x00%h%n%B").split("\0").slice(1);
  } catch (error) {
    // not read is not passed
    const why =
      (error as { code?: string }).code === "ENOBUFS" ? "it is too large" : (error as Error).message;
    return record(g, false, `This change could not be read for secrets: ${why}`, started);
  }
  const found = new Set<string>();
  const before = new Map<string, Set<string>>();
  const wasThere = (a: Added) => {
    if (!before.has(a.path)) before.set(a.path, new Set((fileAt(g, g.base, a.path) ?? "").split(/\r?\n/)));
    return before.get(a.path)?.has(a.text) ?? false;
  };
  for (const a of added) {
    for (const shown of secretsIn(a.text)) {
      if (wasThere(a)) break;
      found.add(`${a.path}:${a.line}: looks like a secret (${shown}), added in commit ${a.commit}`);
    }
  }
  for (const message of messages) {
    const [commit = "", ...lines] = message.split("\n");
    lines.forEach((line, i) => {
      for (const shown of secretsIn(line))
        found.add(`the message of commit ${commit}, line ${i + 1}: looks like a secret (${shown})`);
    });
  }
  const text =
    found.size === 0
      ? "No line this change added, in any of its commits or their messages, looks like a secret."
      : `${[...found].join("\n")}\n\nTake it out of the change, and out of its history: a commit keeps what a later commit removes. If it is a real secret, it must also be replaced where it is used.`;
  return record(g, found.size === 0, text, started);
}
