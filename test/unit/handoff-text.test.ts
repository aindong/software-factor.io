// From the correctness review of task 10: a hand-off given in the last message must be found
// whatever else the message quotes.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { handoffFromText } from "../../src/core/agents/cli.ts";

const found = (text: string) => {
  const handoffPath = join(mkdtempSync(join(tmpdir(), "sf-fence-")), "handoff.json");
  handoffFromText({ handoffPath } as never, text);
  try {
    return JSON.parse(readFileSync(handoffPath, "utf8"));
  } catch {
    return undefined;
  }
};
const handoff = '{"outcome":"fail","summary":"a is wrong"}';

describe("a hand-off in the last message", () => {
  it("is found after a fenced block in another language", () => {
    const text = [
      "The bug is here:",
      "```ts",
      "const a = 1;",
      "```",
      "My hand-off:",
      "```json",
      handoff,
      "```",
    ];
    expect(found(text.join("\n"))).toMatchObject({ outcome: "fail" });
  });

  it("is found with Windows line ends", () => {
    expect(found(["Done.", "```json", handoff, "```", ""].join("\r\n"))).toMatchObject({ outcome: "fail" });
  });

  it("is the last block that is a hand-off, not an earlier JSON block", () => {
    const text = ["```json", '{"name":"x"}', "```", "```json", handoff, "```", "```json", "[1]", "```"];
    expect(found(text.join("\n"))).toMatchObject({ summary: "a is wrong" });
  });

  it("is not made up from a message with no hand-off", () => {
    expect(found('All good.\n```json\n{"name":"x"}\n```')).toBeUndefined();
  });
});
