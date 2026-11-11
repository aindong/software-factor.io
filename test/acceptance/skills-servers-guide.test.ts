// The guide on skills and servers is there, says what a lane gets by default, what * means, what
// is not held and what was not tried, and the README's honest list names it among the stand-ins.
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const guide = readFileSync("docs/skills-and-servers.md", "utf8");
const readme = readFileSync("README.md", "utf8");

it("says what a lane gets by default", () => {
  expect(guide).toMatch(/names no skill and no server/i);
  expect(guide).toMatch(/sealed|only the factory's own server/i);
});

it("says how to name skills and servers, and what * means", () => {
  expect(guide).toContain('"from": "profile"');
  expect(guide).toContain('"servers"');
  expect(guide).toContain('"skills"');
  expect(guide).toMatch(/`\*`.*(every|any)/i);
  expect(guide).toContain("softwarefactor allow");
});

it("says what is not held", () => {
  expect(guide).toMatch(/outside the worktree/);
  expect(guide).toMatch(/gates do not see/);
  expect(guide).toMatch(/\.mcp\.json/);
});

it("says what was not tried with a real agent", () => {
  expect(guide).toMatch(/not tried with a real agent/i);
  expect(guide).toMatch(/Codex/);
});

it("is linked, and its place in the honest list is among the stand-ins", () => {
  expect(readme).toContain("(docs/skills-and-servers.md)");
  const list = readme.slice(
    readme.indexOf("Only on the scripted agent or a stand-in:"),
    readme.indexOf("## Develop"),
  );
  expect(list).toContain("docs/skills-and-servers.md");
});

it("says what else is not held, and what a list that cannot be read costs", () => {
  expect(guide).toMatch(/starts every server of the profile/i);
  expect(guide).toMatch(/may read files in that folder/i);
  expect(guide).toMatch(/2\.1\.311/);
  expect(guide).toMatch(/loading every project server/i);
  expect(guide).toMatch(/project's own skills/i);
  expect(guide).toMatch(/cannot be listed.*(does not start|only starts)/is);
});
