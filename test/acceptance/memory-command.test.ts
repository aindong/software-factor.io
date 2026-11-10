import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { agentLane, callTool, flowRepo, promptsByRun } from "../helpers/repo.ts";

describe("softwarefactor memory", () => {
  const repo = flowRepo({
    lanes: [agentLane("build")],
    tasks: "- [ ] First task\n- [ ] Second task\n",
    files: {
      ".factor/memory/lessons/tests.md":
        "# Run the tests with NODE_ENV=test\n\nThe suite reads a test database.\n",
    },
  });
  const lane = { run: "r1", lane: "build", account: "claude-a" };
  callTool(repo, lane, "memory_note", {
    title: "The deploy script builds twice",
    body: "Once is enough: see scripts/deploy.sh.",
  });
  callTool(repo, lane, "memory_note", { title: "A wrong idea", body: "The tests are flaky." });
  const ids = repo.rows<{ id: number }>("select id from memory_notes order by id").map((n) => String(n.id));

  it("lists what is kept and what agents have proposed", () => {
    const list = repo.sf("memory", "list");
    expect(list.status, list.stderr).toBe(0);
    expect(list.stdout).toMatch(/kept\s+lessons\/tests\.md\s+Run the tests with NODE_ENV=test/);
    expect(list.stdout).toMatch(
      new RegExp(`proposed\\s+${ids[0]}\\s+The deploy script builds twice.*r1.*build.*claude-a`),
    );
  });

  it("keeps a note as a file every later run sees, and says who wrote it", () => {
    const kept = repo.sf("memory", "keep", ids[0] ?? "");
    expect(kept.status, kept.stderr).toBe(0);
    const file = join(repo.dir, ".factor/memory/notes/the-deploy-script-builds-twice.md");
    expect(existsSync(file)).toBe(true);
    expect(repo.read(".factor/memory/notes/the-deploy-script-builds-twice.md")).toMatch(
      /^# The deploy script builds twice\n\nOnce is enough: see scripts\/deploy\.sh\.\n\n.*run r1.*build.*claude-a/s,
    );
    expect(repo.sf("memory", "list").stdout).toMatch(/kept\s+notes\/the-deploy-script-builds-twice\.md/);
    repo.sf("run");
    const prompt = promptsByRun(repo, "build")[0]?.[0] ?? "";
    expect(prompt).toMatch(/# What this project remembers[\s\S]*The deploy script builds twice/);
  });

  it("drops a note, which is then shown to nobody", () => {
    expect(repo.sf("memory", "drop", ids[1] ?? "").status).toBe(0);
    expect(repo.sf("memory", "list").stdout).not.toContain("A wrong idea");
    const text = callTool(repo, lane, "memory_read").result?.content[0]?.text;
    expect(text).not.toContain("A wrong idea");
  });

  it("refuses a note that does not exist, or that was already kept or dropped", () => {
    for (const id of ["999", ids[0] ?? "", ids[1] ?? ""]) {
      const r = repo.sf("memory", "keep", id);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/fix:/);
    }
  });
});
