import { execFileSync } from "node:child_process";
import { readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agentLane, background, flowRepo, jsonOf, pass, startUi, type Ui, until } from "../helpers/repo.ts";

interface Row {
  id: string;
  status: string;
  sentence: string;
  visits: { lane: string; outcome: string | null }[];
}
const repo = flowRepo({
  lanes: [agentLane("build", { name: "Build" })],
  scripts: { author: { build: [{ sleep: 6000 }, pass()] } },
});
let ui: Ui;
beforeAll(async () => {
  ui = await startUi(repo);
}, 120_000);
afterAll(() => ui?.stop());

/** Listen to the live address: every list the server sends, in order. */
function listen(): { frames: Row[][]; stop: () => void; status: Promise<number> } {
  const frames: Row[][] = [];
  const control = new AbortController();
  const status = fetch(`${ui.url}/api/live`, {
    headers: { "x-factor-token": ui.token },
    signal: control.signal,
  }).then(async (answer) => {
    const reader = answer.body?.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    const read = async () => {
      while (reader) {
        const { done, value } = await reader.read();
        if (done) return;
        pending += decoder.decode(value, { stream: true });
        for (let end = pending.indexOf("\n\n"); end >= 0; end = pending.indexOf("\n\n")) {
          const frame = pending.slice(0, end);
          pending = pending.slice(end + 2);
          const data = frame
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trim())
            .join("\n");
          if (data) frames.push((JSON.parse(data) as { runs: Row[] }).runs);
        }
      }
    };
    read().catch(() => {}); // the listener was stopped
    return answer.status;
  });
  return { frames, stop: () => control.abort(), status };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const latest = (frames: Row[][]) => frames.at(-1)?.[0];

describe("the live list", () => {
  it("is refused without the token", async () => {
    expect((await fetch(`${ui.url}/api/live`)).status).toBe(401);
  });

  it("sends the list once on connecting, then nothing while nothing changes", async () => {
    const live = listen();
    expect(await live.status).toBe(200);
    expect(await until(() => live.frames.length === 1, 3000)).toBe(true);
    expect(live.frames[0]).toEqual([]);
    await sleep(2500);
    expect(live.frames.length).toBe(1);
    live.stop();
  });

  it("follows a run from its start to its end, and reads what its agent is doing", async () => {
    const live = listen();
    await until(() => live.frames.length === 1, 3000);
    const run = background(repo, "run");
    // the run appears, with its agent at work
    expect(await until(() => latest(live.frames)?.sentence === "Build: the agent is working.", 5000)).toBe(
      true,
    );
    expect(latest(live.frames)).toMatchObject({
      status: "running",
      visits: [{ lane: "build", outcome: null }],
    });
    const settled = live.frames.length;
    await sleep(1500);
    expect(live.frames.length, "no new list while the run only goes on").toBe(settled);

    // the agent's output file, as the real Claude Code writes it
    const work = join(repo.home, "work");
    const out = join(work, readdirSync(work)[0] ?? "", `${latest(live.frames)?.id}.out`, "01-build.host");
    const said = {
      type: "assistant",
      message: { content: [{ type: "tool_use", name: "Bash", input: { command: "npm test" } }] },
    };
    writeFileSync(join(out, "stream.jsonl"), `${JSON.stringify(said)}\n`);
    expect(
      await until(() => latest(live.frames)?.sentence === "Build: the agent is running `npm test`.", 3000),
    ).toBe(true);

    // the file swapped for a pipe nobody writes to: it is not opened, and the list is not held up
    rmSync(join(out, "stream.jsonl"));
    execFileSync("mkfifo", [join(out, "stream.jsonl")]);
    expect(await until(() => latest(live.frames)?.sentence === "Build: the agent is working.", 3000)).toBe(
      true,
    );
    const asked = Date.now();
    const direct = await jsonOf<{ runs: Row[] }>(await ui.api("/api/runs"));
    expect(Date.now() - asked).toBeLessThan(2000);
    expect(direct.runs[0]?.sentence).toBe("Build: the agent is working.");

    expect(await run.exit).toBe(0);
    expect(await until(() => latest(live.frames)?.status === "done", 3000)).toBe(true);
    expect(latest(live.frames)).toMatchObject({
      sentence: "Done.",
      visits: [{ lane: "build", outcome: "pass" }],
    });
    live.stop();
  }, 40_000);

  it("closes with a listener still connected", async () => {
    const other = await startUi(repo);
    const control = new AbortController();
    const answer = await fetch(`${other.url}/api/live`, {
      headers: { "x-factor-token": other.token },
      signal: control.signal,
    });
    expect(answer.status).toBe(200);
    const asked = Date.now();
    await other.stop();
    expect(Date.now() - asked).toBeLessThan(2000);
    control.abort();
  }, 30_000);
});
