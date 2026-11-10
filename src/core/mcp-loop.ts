// The line loop of an MCP server over stdio: JSON-RPC, one message a line, for a list of tools.
// The factor server of a lane and the operator server both speak through it.
import { z } from "zod";
import { UserError } from "./errors.ts";

export interface Tool {
  name: string;
  description: string;
  input: z.ZodType;
  /** What the tool answers, as text. A refusal is thrown. */
  run: (args: never) => string | Promise<string>;
}
type Answer = { result: unknown } | { error: { code: number; message: string } };
const MAX_LINE = 20_000_000;

async function answer(tools: Tool[], method: string, given: unknown): Promise<Answer> {
  const params = typeof given === "object" && given !== null ? (given as Record<string, unknown>) : undefined;
  if (method === "initialize") {
    return {
      result: {
        // the version the client asked for: the few methods served here are the same in all of them
        protocolVersion: typeof params?.protocolVersion === "string" ? params.protocolVersion : "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "factor", version: "1" },
      },
    };
  }
  if (method === "ping") return { result: {} };
  if (method === "tools/list") {
    return {
      result: {
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: z.toJSONSchema(t.input),
        })),
      },
    };
  }
  if (method === "tools/call") {
    const tool = tools.find((t) => t.name === params?.name);
    if (!tool) return { error: { code: -32602, message: "There is no tool of that name." } };
    const said = (words: string, isError = false) => ({
      result: { content: [{ type: "text", text: words }], ...(isError ? { isError: true } : {}) },
    });
    const args = tool.input.safeParse(params?.arguments ?? {});
    if (!args.success) {
      const first = args.error.issues[0];
      return said(
        `The arguments are wrong at "${first?.path.join(".") || "(top)"}": ${first?.message}`,
        true,
      );
    }
    try {
      return said(await tool.run(args.data as never));
    } catch (error) {
      const fix = error instanceof UserError && error.fix ? `\n  fix: ${error.fix}` : "";
      return said(`${(error as Error).message}${fix}`, true);
    }
  }
  return { error: { code: -32601, message: "This server has no such method." } };
}

/** Serve the tools until the client closes the stream. Messages are answered in the order they came. */
export async function serveTools(tools: Tool[]): Promise<void> {
  const say = (message: unknown) => process.stdout.write(`${JSON.stringify(message)}\n`);
  const handle = async (line: string) => {
    if (line.trim() === "") return;
    let message: { id?: unknown; method?: unknown; params?: unknown };
    try {
      message = JSON.parse(line);
      if (typeof message !== "object" || message === null) throw new Error("not an object");
    } catch {
      say({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "That line is not a JSON object." } });
      return;
    }
    const { id, method } = message;
    if (id === undefined || id === null) return; // a notification: no answer
    const idOk = typeof id === "string" || typeof id === "number";
    if (!idOk || typeof method !== "string") {
      const error = {
        code: -32600,
        message: "A request needs a method that is text and an id that is text or a number.",
      };
      say({ jsonrpc: "2.0", id: idOk ? id : null, error });
      return;
    }
    try {
      say({ jsonrpc: "2.0", id, ...(await answer(tools, method, message.params)) });
    } catch (error) {
      // whatever a message does, the server stays up for the next one
      say({ jsonrpc: "2.0", id, error: { code: -32603, message: (error as Error).message } });
    }
  };
  // Messages end at a line feed and nowhere else. Node's line reader also splits at U+2028 and
  // U+2029, which are legal inside a JSON string, so the stream is split here by hand.
  let pending = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    pending += chunk;
    for (let end = pending.indexOf("\n"); end >= 0; end = pending.indexOf("\n")) {
      await handle(pending.slice(0, end));
      pending = pending.slice(end + 1);
    }
    if (pending.length > MAX_LINE) pending = ""; // a line with no end is not a message
  }
  await handle(pending);
}
