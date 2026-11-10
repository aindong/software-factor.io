import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { agentLane, flowRepo, runRow, trail } from "../helpers/repo.ts";

const MINUTE = 60_000;
const wait = (settings: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  id: "pause",
  uses: "core/wait@1",
  with: settings,
  checkpoint: "out",
  on: { pass: "@done", fail: "@stop" },
  ...extra,
});

describe("a wait lane", () => {
  it("parks the run until its time, without using the run's minutes", () => {
    const repo = flowRepo({
      lanes: [agentLane("build", { on: { pass: "pause", fail: "@stop" } }), wait({ minutes: 5 })],
    });
    expect(repo.sf("run").status).toBe(3);
    expect(runRow(repo)).toMatchObject({ status: "waiting", stop_code: "waiting" });
    expect(runRow(repo)?.wake_at).toBeTruthy();

    repo.env.FACTOR_CLOCK_OFFSET_MS = String(2 * MINUTE); // test hook: two minutes later
    repo.sf("run");
    expect(runRow(repo)?.status).toBe("waiting");

    repo.env.FACTOR_CLOCK_OFFSET_MS = String(6 * MINUTE);
    expect(repo.sf("run").status).toBe(0);
    expect(runRow(repo)).toMatchObject({ status: "done", stop_code: "done" });
    expect(trail(repo)).toEqual(["build:pass", "pause:pass"]);
    expect(JSON.parse(runRow(repo)?.state ?? "{}").spent.ms).toBeLessThan(MINUTE);
  });

  it("checks its command on each wake and hands its outputs on", () => {
    const repo = flowRepo({
      commands: { verify: "true", shipped: "true" },
      lanes: [
        wait(
          {
            until: { run: 'test -f "$HOME_FLAG" && echo \'{"state":"approved"}\' > "$FACTOR_OUTPUTS"' },
            everyMinutes: 1,
            timeoutHours: 1,
          },
          {
            outputs: { state: { type: "string", enum: ["approved", "changes"] } },
            on: {
              pass: [{ to: "ship", when: { ref: "pause.outputs.state", in: ["approved"] } }, { to: "@stop" }],
              fail: "@stop",
            },
          },
        ),
        {
          id: "ship",
          uses: "core/command@1",
          with: { command: "shipped" },
          checkpoint: "out",
          on: { pass: "@done", fail: "@stop" },
        },
      ],
    });
    const factory = repo.json<{ gateEnv?: string[] }>(".factor/factory.json");
    factory.gateEnv = ["HOME_FLAG"];
    repo.write(".factor/factory.json", JSON.stringify(factory));
    repo.git("commit", "-qam", "let the wait see the flag");
    repo.env.HOME_FLAG = join(repo.home, "ready");

    expect(repo.sf("run").status).toBe(3);
    repo.env.FACTOR_CLOCK_OFFSET_MS = String(2 * MINUTE);
    repo.sf("run");
    expect(runRow(repo)?.status).toBe("waiting");

    writeFileSync(repo.env.HOME_FLAG, "");
    repo.env.FACTOR_CLOCK_OFFSET_MS = String(4 * MINUTE);
    expect(repo.sf("run").status).toBe(0);
    expect(trail(repo)).toEqual(["pause:pass", "ship:pass"]);
  });

  it("asks a person when its command never succeeds in time", () => {
    const repo = flowRepo({ lanes: [wait({ until: { run: "false" }, everyMinutes: 1, timeoutHours: 1 })] });
    repo.sf("run");
    repo.env.FACTOR_CLOCK_OFFSET_MS = String(61 * MINUTE);
    expect(repo.sf("run").status).toBe(3);
    expect(trail(repo)).toEqual(["pause:needsPerson"]);
    expect(runRow(repo)).toMatchObject({ status: "waiting", stop_code: "needs_person" });
    expect(repo.rows("select kind, status from inbox")).toEqual([{ kind: "question", status: "open" }]);
  });
});
