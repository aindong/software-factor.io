// core/no-secrets@1: a lane's change may not add something shaped like a secret. Every commit of
// the change is read, not only what it leaves: a commit keeps what a later commit removes. A line
// that the base commit already holds in that file is not the lane's doing. What is found is named
// by its file, its line and its first characters, never in full.
import { execFileSync } from "node:child_process";
import { hostEnv } from "../exec.ts";
import { SECRET } from "../schema/builtins.ts";
import { fileAt, type GateJob, record } from "./types.ts";

const MOST_BYTES = 256 * 1024 * 1024;
const SHAPES = new RegExp(SECRET.source, "gi");
// A URL to this machine or to an example host, and a parameter whose value is one plain word, are
// what a README shows. A real token has a digit in it, or letters of both cases.
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\]|[\w.-]*\.(local|test|example)|example\.(com|org|net))\b/i;
function harmless(match: string, after: string): boolean {
  if (match.startsWith("://")) return LOCAL.test(after);
  const value = /^[?&;][^=]*=(.*)$/.exec(match)?.[1];
  return value !== undefined && !/\d/.test(value) && !(/[a-z]/.test(value) && /[A-Z]/.test(value));
}

interface Added {
  commit: string;
  path: string;
  line: number;
  text: string;
}

/** Every line a commit of base..head added. A merge is read against its first parent, and a file
 * that the repository calls binary is read as text all the same. */
function addedLines(g: GateJob): Added[] {
  const raw = execFileSync(
    "git",
    // biome-ignore format: one flag a line reads worse
    ["-c", "core.quotePath=false", "log", "-p", "--unified=0", "-M", "--diff-merges=first-parent", "--no-ext-diff", "--no-textconv", "--text", "--no-color", "--format=%x00%h", `${g.base}..${g.head}`],
    {
      cwd: g.ws.root,
      encoding: "utf8",
      env: hostEnv(),
      maxBuffer: MOST_BYTES,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
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
    else if (text.startsWith("+++ ")) path = text.slice(4).replace(/^b\//, "");
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
  try {
    added = addedLines(g);
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
    for (const match of a.text.matchAll(SHAPES)) {
      if (harmless(match[0], a.text.slice(match.index + match[0].length)) || wasThere(a)) continue;
      found.add(
        `${a.path}:${a.line}: looks like a secret (${match[0].slice(0, 4)}...), added in commit ${a.commit}`,
      );
    }
  }
  const text =
    found.size === 0
      ? "No line this change added, in any of its commits, looks like a secret."
      : `${[...found].join("\n")}\n\nTake it out of the change, and out of its history: a commit keeps what a later commit removes. If it is a real secret, it must also be replaced where it is used.`;
  return record(g, found.size === 0, text, started);
}
