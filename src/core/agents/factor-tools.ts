// The tools of the factor MCP server, by name. Kept apart from the server so the guard, which is
// started before every tool call, can know them without loading the database.
export const FACTOR_TOOLS = [
  "memory_read",
  "memory_note",
  "handoff_write",
  "ask_question",
  "evidence_attach",
] as const;
export type FactorTool = (typeof FACTOR_TOOLS)[number];
/** A tool's name as an agent CLI shows it. */
export const mcpName = (tool: string) => `mcp__factor__${tool}`;
