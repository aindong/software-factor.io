// `softwarefactor mcp-call`, for the factory's own use: start one MCP server, call one tool, print
// the answer as one line of JSON, stop the server. The request is read from stdin.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { oneLine } from "../text.ts";

type Message = { id?: number; method?: string; result?: unknown; error?: { message?: string } };
const DRAIN_MS = 200; // after the server exits, how long its last words may still be on their way
type Out = { ok: true; result: unknown } | { ok: false; error: string };

export async function mcpCall(): Promise<number> {
  const req = JSON.parse(readFileSync(0, "utf8")) as {
    command: string;
    args: string[];
    tool: string;
    arguments: unknown;
    timeoutMs: number;
  };
  // in a group of its own: a launcher (npx, uvx, docker) starts the server as its child, and both must go
  const child = spawn(req.command, req.args, { stdio: ["pipe", "pipe", "pipe"], detached: true });
  let complaint = "";
  child.stderr.on("data", (d) => {
    complaint = (complaint + String(d)).slice(-2000);
  });
  child.stdin.on("error", () => {}); // a server that is gone is told by its exit, not by a broken pipe
  const waiting = new Map<number, (m: Message) => void>();
  createInterface({ input: child.stdout }).on("line", (line) => {
    try {
      const m = JSON.parse(line) as Message;
      // a line with a method is the server asking or telling, not its answer
      if (typeof m.id === "number" && m.method === undefined) waiting.get(m.id)?.(m);
    } catch {
      // a line that is not JSON is the server talking to itself
    }
  });
  const send = (m: object) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...m })}\n`);
  const ask = (id: number, method: string, params: unknown) =>
    new Promise<Message>((answer) => {
      waiting.set(id, answer);
      send({ id, method, params });
    });
  const gone = new Promise<Out>((say) => {
    child.on("error", (e) => say({ ok: false, error: `the server could not start: ${e.message}` }));
    child.on("exit", (code) =>
      setTimeout(
        () =>
          say({
            ok: false,
            error: `the server ended${code ? ` with exit ${code}` : ""} before it answered${complaint ? `: ${oneLine(complaint, 300)}` : ""}`,
          }),
        DRAIN_MS,
      ),
    );
  });
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<Out>((say) => {
    timer = setTimeout(() => say({ ok: false, error: "the server did not answer in time" }), req.timeoutMs);
  });
  const call = (async (): Promise<Out> => {
    const hello = await ask(1, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "softwarefactor", version: "1" },
    });
    if (hello.error)
      return { ok: false, error: `the server refused to start a session: ${hello.error.message ?? ""}` };
    send({ method: "notifications/initialized" });
    const m = await ask(2, "tools/call", { name: req.tool, arguments: req.arguments ?? {} });
    return m.error
      ? { ok: false, error: m.error.message ?? "the server answered with an error" }
      : { ok: true, result: m.result };
  })();
  const out = await Promise.race([call, gone, late]);
  clearTimeout(timer); // or the wait would hold this process open after the answer
  try {
    if (child.pid) process.kill(-child.pid, "SIGKILL"); // the whole group: a server that hangs does not listen to a polite signal
  } catch {
    // already gone
  }
  // a server that outlives its launcher would hold these pipes, and this process, open
  for (const stream of [child.stdin, child.stdout, child.stderr]) stream.destroy();
  await new Promise<void>((done) => process.stdout.write(`${JSON.stringify(out)}\n`, () => done()));
  process.exit(0);
}
