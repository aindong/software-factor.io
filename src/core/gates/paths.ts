// core/protected-paths@1: the change touches no file an agent must not change. These are the files
// that decide what the host runs and how the project is checked.
import { matches } from "./glob.ts";
import { changedFiles, type GateJob, record } from "./types.ts";

export const DEFAULT_PROTECTED = [
  ".factor/",
  ".github/",
  ".circleci/",
  ".gitlab-ci.yml",
  ".husky/",
  ".claude/",
  ".codex/",
  ".kimi-code/",
  ".agents/",
  ".mcp.json",
  "CLAUDE.md",
  "AGENTS.md",
  ".gitmodules",
  ".gitattributes",
  "**/package-lock.json",
  "**/pnpm-lock.yaml",
  "**/yarn.lock",
  "**/bun.lock",
  "**/bun.lockb",
  "**/Cargo.lock",
  "**/poetry.lock",
  "**/uv.lock",
];

export function protectedPathsGate(g: GateJob) {
  const started = Date.now();
  const added = [
    ...((g.settings.paths as string[] | undefined) ?? []),
    ...(g.ws.config.protectedPaths ?? []),
  ];
  const patterns = [...DEFAULT_PROTECTED, ...added];
  const hits = changedFiles(g).flatMap(({ path }) => {
    const by = patterns.find((p) => matches(p, path));
    return by ? [`${path}  (protected by "${by}")`] : [];
  });
  const text =
    hits.length > 0
      ? `The change touches ${hits.length} protected path${hits.length === 1 ? "" : "s"}:\n\n${hits.join("\n")}\n\nA person must make this change, or remove the path from the protected list.`
      : "The change touches no protected path.";
  return record(g, hits.length === 0, `${text}\n`, started);
}
