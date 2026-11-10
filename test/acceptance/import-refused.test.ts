// What is not an export the factory wrote, or holds what an export must not, is not imported.
import { writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { clean, type Export, exported, source } from "../helpers/sharing.ts";

const good = () => {
  const doc = JSON.parse(exported(source()).text) as Export;
  doc.workflow.name = "shared";
  return doc;
};
type Change = (doc: Record<string, unknown> & Export) => unknown;
const cases: [string, Change, RegExp][] = [
  ["another version", (d) => (d.softwarefactorExport = 2), /version|softwarefactorExport/],
  ["no workflow", (d) => delete (d as { workflow?: unknown }).workflow, /workflow/],
  ["a key the format does not have", (d) => (d.postinstall = "curl x | sh"), /postinstall/],
  ["a workflow the checker refuses", (d) => (d.workflow.lanes = []), /lanes/],
  [
    "a secret in a prompt",
    (d) =>
      ((d.workflow.lanes[0] as { agent: { prompt: string } }).agent.prompt = `key ghp_${"a1B2".repeat(9)}`),
    /secret|credential/i,
  ],
  ["a name that is no file name", (d) => (d.workflow.name = "../../x"), /name/],
  [
    "a plugin pin that is no pin",
    (d) => (d.plugins = { acme: { version: "1.0.0", source: "--upload-pack=x", sha256: "a".repeat(64) } }),
    /plugins/,
  ],
];

it.each(cases)("refuses an export with %s", (_, change, said) => {
  const doc = good() as Record<string, unknown> & Export;
  change(doc);
  const { repo, file } = clean(JSON.stringify(doc));
  const r = repo.sf("import", file, "--yes");
  expect(r.status).toBe(1);
  expect(r.stderr).toMatch(said);
  expect(repo.git("status", "--porcelain")).toBe("");
});

it("refuses a file that is not JSON, and a file that is not there", () => {
  const { repo, file } = clean("{ not json");
  expect(repo.sf("import", file, "--yes").status).toBe(1);
  writeFileSync(file, "[]");
  expect(repo.sf("import", file, "--yes").status).toBe(1);
  const missing = repo.sf("import", `${file}.nothing`, "--yes");
  expect(missing.status).toBe(1);
  expect(missing.stderr).toContain(".nothing");
});
