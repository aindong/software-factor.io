// `softwarefactor export`: one JSON document that holds the workflow and what it needs.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { edit } from "../helpers/collect.ts";
import { gitHost, makePlugin } from "../helpers/plugin.ts";
import { clean, exported, source } from "../helpers/sharing.ts";

it("prints the workflow with its prompt inside it, and the pins of the plugins it lists", () => {
  const repo = source();
  repo.env.FACTOR_GIT_BASE = gitHost(makePlugin(), "acme", "factor-board");
  expect(repo.sf("add", "acme/factor-board", "--yes").status).toBe(0);
  edit(repo, (w) => {
    w.plugins = { acme: "^1.0.0" };
    w.collectors.push({ id: "board", uses: "acme/board@1" });
  });
  const { doc, text, status, stderr } = exported(repo);
  expect(status, stderr).toBe(0);
  expect(doc.softwarefactorExport).toBe(1);
  expect(Object.keys(doc).sort()).toEqual(["plugins", "softwarefactorExport", "workflow"]);
  expect(doc.workflow.name).toBe("starter");
  // the prompt that was in a file is in the document, and no file is named
  const build = doc.workflow.lanes.find((l) => l.id === "build") as { agent: { prompt: unknown } };
  expect(build.agent.prompt).toBe("Build what the task asks for.\nKeep it small.\n");
  expect(text).not.toContain("prompts/build.md");
  // what the workspace must define is named with what it must do, and its own command line is not there
  expect(doc.workflow.commands).toEqual({ verify: { description: "The verify command." } });
  expect(doc.plugins).toEqual({
    acme: {
      version: "1.2.0",
      source: "acme/factor-board",
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      commit: expect.stringMatching(/^[0-9a-f]{40}$/),
    },
  });

  // --out writes the same document to a file and prints nothing of it
  const out = join(repo.home, "out.json");
  const written = repo.sf("export", "--out", out);
  expect(written.status, written.stderr).toBe(0);
  expect(written.stdout).not.toContain("softwarefactorExport");
  expect(JSON.parse(readFileSync(out, "utf8"))).toEqual(doc);

  // and the import accepts it
  const { repo: other, file } = clean(text);
  const shown = other.sf("import", file);
  expect(shown.status, shown.stderr).toBe(0);
});

it("exports a workflow by name when the workspace has more than one", () => {
  const repo = source();
  repo.write(
    ".factor/workflows/other.json",
    repo.read(".factor/workflows/starter.json").replace('"name": "starter"', '"name": "other"'),
  );
  expect(exported(repo, "other").doc.workflow.name).toBe("other");
  const none = exported(repo, "nothing");
  expect(none.status).toBe(1);
  expect(none.stderr).toContain("nothing");
});
