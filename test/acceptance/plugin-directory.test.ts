// The directory is a static index: a JSON file somewhere. A bare name is looked up in it.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { lock, makePlugin } from "../helpers/plugin.ts";
import { commandLane, flowRepo } from "../helpers/repo.ts";

it("lists what the index holds, and adds a plugin by its name", () => {
  const repo = flowRepo({ lanes: [commandLane("build", "true")] });
  const plugin = makePlugin();
  const index = join(repo.home, "index.json");
  writeFileSync(
    index,
    JSON.stringify({
      version: 1,
      plugins: [
        { name: "acme", description: "A board, a gate and a lane.", source: plugin.dir },
        { name: "other", description: "Something else.", source: "someone/other" },
      ],
    }),
  );
  repo.env.FACTOR_DIRECTORY = index;
  const listed = repo.sf("plugins", "--available");
  expect(listed.status, listed.stderr).toBe(0);
  expect(listed.stdout).toMatch(/acme\s+A board, a gate and a lane\./);
  expect(listed.stdout).toMatch(/other\s+Something else\./);
  expect(listed.stdout).toContain("softwarefactor add <name>");

  const r = repo.sf("add", "acme", "--yes");
  expect(r.status, r.stderr).toBe(0);
  expect(lock(repo).acme).toMatchObject({ version: "1.2.0", source: plugin.dir });

  const missing = repo.sf("add", "nothing-like-it", "--yes");
  expect(missing.status).toBe(1);
  expect(missing.stderr).toContain("nothing-like-it");
  expect(missing.stderr).toContain(index);
});

it("says so when the index cannot be read or is not an index", () => {
  const repo = flowRepo({ lanes: [commandLane("build", "true")] });
  repo.env.FACTOR_DIRECTORY = join(repo.home, "no-index.json");
  expect(repo.sf("plugins", "--available").status).toBe(1);
  writeFileSync(join(repo.home, "bad.json"), JSON.stringify({ plugins: "many" }));
  repo.env.FACTOR_DIRECTORY = join(repo.home, "bad.json");
  const r = repo.sf("add", "acme", "--yes");
  expect(r.status).toBe(1);
  expect(r.stderr).toMatch(/index/);
});
