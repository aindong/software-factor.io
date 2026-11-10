// core/github-issues@1: the open issues with a label, read with the GitHub CLI and the login it
// already has. The factory only reads: it never comments on an issue or closes one.
import { spawnSync } from "node:child_process";
import { MINUTE_MS } from "../clock.ts";
import { oneLine } from "../text.ts";
import type { At, Collected } from "./index.ts";

const MOST = 100;

export function collectGithub(at: At, settings: { label: string; repo?: string }): Collected {
  const args = ["issue", "list", "--label", settings.label, "--state", "open", "--limit", String(MOST)];
  const r = spawnSync(
    "gh",
    [...args, "--json", "number,title,body,labels", ...(settings.repo ? ["--repo", settings.repo] : [])],
    {
      cwd: at.root,
      encoding: "utf8",
      timeout: MINUTE_MS,
    },
  );
  if (r.error) {
    const missing = (r.error as NodeJS.ErrnoException).code === "ENOENT";
    throw new Error(
      missing ? "the GitHub CLI (gh) is not installed" : `gh did not finish: ${r.error.message}`,
    );
  }
  if (r.status !== 0) throw new Error(oneLine(r.stderr || r.stdout || `gh exited ${r.status}`, 300));
  let issues: unknown;
  try {
    issues = JSON.parse(r.stdout);
  } catch {
    issues = undefined;
  }
  if (!Array.isArray(issues)) throw new Error("gh did not print a list of issues");
  const tasks = issues.flatMap(
    (issue: { number?: unknown; title?: unknown; body?: unknown; labels?: unknown }) =>
      typeof issue?.number === "number" && typeof issue.title === "string"
        ? [
            {
              key: `#${issue.number}`,
              title: issue.title,
              body: typeof issue.body === "string" ? issue.body : "",
              labels: (Array.isArray(issue.labels) ? issue.labels : []).flatMap((l: { name?: unknown }) =>
                typeof l?.name === "string" ? [l.name] : [],
              ),
            },
          ]
        : [],
  );
  return { tasks, said: issues.length === MOST ? `only the first ${MOST} issues were read` : undefined };
}
