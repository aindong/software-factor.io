import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { agentLane, commandLane, flowRepo, pass, promptsOf, runRow, trail } from "../helpers/repo.ts";

describe("values passed between lanes", () => {
  it("reach an agent's prompt, a command's environment and a gate's environment", () => {
    const repo = flowRepo({
      commands: { verify: "true" },
      gates: {
        "has-plan": {
          uses: "core/command@1",
          with: { run: 'test "$FACTOR_OUTPUT_PLANPATH" = "docs/plan.md"' },
          onFail: "fail",
        },
      },
      lanes: [
        agentLane("plan", {
          outputs: { planPath: { type: "string", required: true } },
          gates: ["has-plan"],
          on: { pass: "build", fail: "@stop" },
        }),
        agentLane("build", {
          inputs: { plan: "plan.outputs.planPath" },
          on: { pass: "stamp", fail: "@stop" },
        }),
        commandLane(
          "stamp",
          'echo "$FACTOR_INPUT_PLAN" > "$STAMP" && echo \'{"stamped":true}\' > "$FACTOR_OUTPUTS"',
          {
            inputs: { plan: "plan.outputs.planPath" },
            outputs: { stamped: { type: "boolean" } },
            on: {
              pass: [{ to: "@done", when: { ref: "stamp.outputs.stamped", in: [true] } }, { to: "@stop" }],
              fail: "@stop",
            },
          },
        ),
      ],
      scripts: { author: { plan: [pass({ outputs: { planPath: "docs/plan.md" } })], build: [pass()] } },
    });
    const factory = repo.json<{ gateEnv?: string[] }>(".factor/factory.json");
    factory.gateEnv = ["STAMP"];
    repo.write(".factor/factory.json", JSON.stringify(factory));
    repo.git("commit", "-qam", "let the command see where to stamp");
    repo.env.STAMP = join(repo.home, "stamp.txt");

    const run = repo.sf("run");
    expect(run.status, run.stdout + run.stderr).toBe(0);
    expect(trail(repo)).toEqual(["plan:pass", "build:pass", "stamp:pass"]);
    expect(promptsOf(repo, "build")[0]).toMatch(/plan: docs\/plan\.md/);
    expect(readFileSync(repo.env.STAMP, "utf8").trim()).toBe("docs/plan.md");
    expect(runRow(repo)?.status).toBe("done");
  });
});
