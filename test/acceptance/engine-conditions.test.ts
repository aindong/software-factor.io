import { describe, expect, it } from "vitest";
import { agentLane, commitFile, flowRepo, pass, trail } from "../helpers/repo.ts";

describe("transitions that depend on a value", () => {
  const triage = (size: string) =>
    flowRepo({
      lanes: [
        agentLane("triage", {
          outputs: { size: { type: "string", enum: ["easy", "hard"] } },
          on: {
            pass: [{ to: "small", when: { ref: "triage.outputs.size", in: ["easy"] } }, { to: "large" }],
            fail: "@stop",
          },
        }),
        agentLane("small"),
        agentLane("large"),
      ],
      scripts: { author: { triage: [pass({ outputs: { size } })] } },
    });

  it("follow a lane's output", () => {
    const easy = triage("easy");
    easy.sf("run");
    expect(trail(easy)).toEqual(["triage:pass", "small:pass"]);
    const hard = triage("hard");
    hard.sf("run");
    expect(trail(hard)).toEqual(["triage:pass", "large:pass"]);
  });

  it("follow a gate's result", () => {
    const repo = flowRepo({
      commands: { verify: "true", flaky: "false" },
      gates: { flaky: { uses: "core/command@1", with: { command: "flaky" }, onFail: "inform" } },
      lanes: [
        agentLane("probe", {
          gates: ["flaky"],
          on: {
            pass: [{ to: "fixit", when: { ref: "probe.gates.flaky", in: ["fail"] } }, { to: "@done" }],
            fail: "@stop",
          },
        }),
        agentLane("fixit"),
      ],
    });
    repo.sf("run");
    expect(trail(repo)).toEqual(["probe:pass", "fixit:pass"]);
  });

  it("follow which collector found the task", () => {
    const repo = flowRepo({
      lanes: [
        agentLane("sort", {
          on: {
            pass: [{ to: "local", when: { ref: "task.source", notIn: ["tasks"] } }, { to: "@done" }],
            fail: "@stop",
          },
        }),
        agentLane("local"),
      ],
    });
    repo.sf("run");
    expect(trail(repo)).toEqual(["sort:pass"]);
  });

  const tiered = (file: string) =>
    flowRepo({
      lanes: [
        agentLane("build", {
          agent: { access: "write" },
          gates: ["verify"],
          on: {
            pass: [{ to: "look", when: { ref: "change.tier", in: ["ui"] } }, { to: "@done" }],
            fail: "@stop",
          },
        }),
        agentLane("look"),
      ],
      scripts: { author: { build: [...commitFile(file), pass()] } },
    });

  it("follow how risky the change is", () => {
    const ui = tiered("src/components/Button.tsx");
    ui.sf("run");
    expect(trail(ui)).toEqual(["build:pass", "look:pass"]);
    const docs = tiered("docs/notes.md");
    docs.sf("run");
    expect(trail(docs)).toEqual(["build:pass"]);
  });
});
