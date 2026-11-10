// `softwarefactor import <file> --yes` writes the workflow, with a person back in front of every lane.
import { expect, it } from "vitest";
import { clean, type Export, exported, source } from "../helpers/sharing.ts";

const named = (text: string, name: string) => {
  const doc = JSON.parse(text) as Export;
  doc.workflow.name = name;
  return doc;
};
const checkpoints = (w: Export["workflow"]) =>
  w.lanes.map((l) => `${l.id}:${l.checkpoint}${l.pin ? ":pinned" : ""}`);

it("writes the workflow with every lane waiting for a person, keeps a pin, and leaves the active workflow alone", () => {
  const doc = named(exported(source()).text, "shared");
  doc.plugins = {
    acme: { version: "1.2.0", source: "acme/factor-board", sha256: "a".repeat(64), commit: "b".repeat(40) },
  };
  (doc.workflow as { plugins?: unknown }).plugins = { acme: "^1.0.0" };
  expect(checkpoints(doc.workflow)).toEqual(["build:out", "ship:out:pinned"]);
  const { repo, file } = clean(JSON.stringify(doc));
  const r = repo.sf("import", file, "--yes");
  expect(r.status, r.stderr).toBe(0);
  expect(r.stdout).toContain("imported shared");
  const written = repo.json<Export["workflow"]>(".factor/workflows/shared.json");
  expect(checkpoints(written)).toEqual(["build:in", "ship:in:pinned"]);
  expect({ ...written, lanes: written.lanes.map((l) => ({ ...l, checkpoint: "x" })) }).toEqual({
    ...doc.workflow,
    lanes: doc.workflow.lanes.map((l) => ({ ...l, checkpoint: "x" })),
  });
  expect(repo.sf("check", ".factor/workflows/shared.json").status).toBe(0);
  expect(repo.json(".factor/plugins.lock.json")).toEqual(doc.plugins);
  expect(repo.json<{ workflow: string }>(".factor/factory.json").workflow).toBe("starter");
  // nothing of the machine's approvals is written by an import
  expect(repo.read(".factor/local.json")).not.toContain("plugins");
});

it("keeps the checkpoints when asked, and makes the workflow the active one when asked", () => {
  const doc = named(exported(source()).text, "shared");
  const { repo, file } = clean(JSON.stringify(doc));
  const r = repo.sf("import", file, "--yes", "--keep-checkpoints", "--use");
  expect(r.status, r.stderr).toBe(0);
  expect(checkpoints(repo.json<Export["workflow"]>(".factor/workflows/shared.json"))).toEqual([
    "build:out",
    "ship:out:pinned",
  ]);
  expect(repo.json<{ workflow: string }>(".factor/factory.json").workflow).toBe("shared");
  expect(r.stdout).toMatch(/now runs "shared"/);
});
