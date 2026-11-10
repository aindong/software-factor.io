// `softwarefactor mcp-call`, for the factory's own use: start one MCP server, call one tool, print
// the answer as one line of JSON, stop the server. The request is read from stdin.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { oneLine } from "../text.ts";

type Message = { id?: number; result?: unknown; error?: { message?: string } };
type Out = { ok: true; result: unknown } | { ok: false; error: string };

export async function mcpCall(): Promise<number> {
  const req = JSON.parse(readFileSync(0, "utf8")) as {
    command: string;
    args: string[];
    tool: string;
    arguments: unknown;
    timeoutMs: number;
  };
  const child = spawn(req.command, req.args, { stdio: ["pipe", "pipe", "pipe"] });
  let complaint = "";
  child.stderr.on("data", (d) => {
    complaint = (complaint + String(d)).slice(-2000);
  });
  child.stdin.on("error", () => {}); // a server that is gone is told by its exit, not by a broken pipe
  const waiting = new Map<number, (m: Message) => void>();
  createInterface({ input: child.stdout }).on("line", (line) => {
    try {
      const m = JSON.parse(line) as Message;
      if (typeof m.id === "number") waiting.get(m.id)?.(m);
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
      say({
        ok: false,
        error: `the server ended${code ? ` with exit ${code}` : ""} before it answered${complaint ? `: ${oneLine(complaint, 300)}` : ""}`,
      }),
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
  child.kill("SIGKILL"); // a server that does not answer may not listen to a polite signal either
  console.log(JSON.stringify(out));
  return 0;
}
