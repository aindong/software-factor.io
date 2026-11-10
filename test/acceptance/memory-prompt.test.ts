import { symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { agentLane, flowRepo, promptsOf } from "../helpers/repo.ts";

const files = {
  ".factor/memory/lessons/tests.md":
    "# Run the tests with NODE_ENV=test\n\nThe suite reads a test database.\n",
  ".factor/memory/facts/owner.md": "# The owner wants short commits\n\nOne change per commit.\n",
  ".factor/memory/README.txt": "not a memory file\n",
};

describe("the project's memory in a lane's prompt", () => {
  it("is every memory file, under a heading that says the project wrote it", () => {
    const repo = flowRepo({ lanes: [agentLane("build")], files });
    expect(repo.sf("run").status).toBe(0);
    const [prompt] = promptsOf(repo, "build");
    expect(prompt).toMatch(/# What this project remembers\n\n.*kept by the people of this project/s);
    expect(prompt).toContain("Run the tests with NODE_ENV=test");
    expect(prompt).toContain("The suite reads a test database.");
    expect(prompt).toContain("The owner wants short commits");
    expect(prompt).toMatch(/lessons\/tests\.md/); // where it comes from
    expect(prompt).not.toContain("not a memory file");
  });

  it("is left out when there is none", () => {
    const repo = flowRepo({ lanes: [agentLane("build")] });
    repo.sf("run");
    expect(promptsOf(repo, "build")[0]).not.toContain("What this project remembers");
  });

  it("holds the titles only past the cap, and says how to read the rest", () => {
    const many = Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [
        `.factor/memory/facts/fact-${String(i).padStart(2, "0")}.md`,
        `# Fact number ${i}\n\n${`body-${i} `.repeat(120)}\n`,
      ]),
    );
    const repo = flowRepo({ lanes: [agentLane("build")], files: many });
    repo.sf("run");
    const prompt = promptsOf(repo, "build")[0] ?? "";
    for (let i = 0; i < 30; i++) expect(prompt).toContain(`Fact number ${i}`);
    expect(prompt).toContain("body-0 ");
    expect(prompt).not.toContain("body-29 ");
    expect(prompt).toMatch(/memory_read/);
    expect(prompt.length).toBeLessThan(14_000);
  });

  it("does not follow a link out of the memory folder", () => {
    const repo = flowRepo({ lanes: [agentLane("build")], files });
    const outside = join(repo.home, "outside.md");
    writeFileSync(outside, "# OUTSIDE-FILE\n");
    symlinkSync(outside, join(repo.dir, ".factor/memory/facts/link.md"));
    repo.sf("run");
    expect(promptsOf(repo, "build")[0]).not.toContain("OUTSIDE-FILE");
  });
});
