// The operator MCP server: every operation of the factory as a tool, for the owner's own agent
// outside a run (ADR 0008). It acts as the person at this machine: it can approve. So it never
// starts inside a run, where an agent would be deciding on its own work.
import { join } from "node:path";
import { openDb } from "./db.ts";
import { serveTools } from "./mcp-loop.ts";
import { OPERATIONS } from "./operations.ts";

export async function serveOperator(root: string): Promise<void> {
  const db = openDb(join(root, ".factor", "state.db"));
  try {
    await serveTools(
      OPERATIONS.map((o) => ({
        name: o.name,
        description: o.description,
        input: o.input,
        run: async (args: never) => JSON.stringify(await o.run({ root, db }, args)),
      })),
    );
  } finally {
    db.close();
  }
}
