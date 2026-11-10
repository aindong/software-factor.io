// What an agent is told: the lane's instructions, the task, what earlier lanes left, why it is here
// again, and, for a real agent, where and how to hand off.
import type { Lane } from "../schema/workflow.ts";
import type { Ctx } from "./lane.ts";
import { valueAt } from "./transition.ts";

export const HANDOFF = "hand-off"; // a rejected hand-off goes back to the agent like a failed repair gate

export const asText = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v ?? ""));

/** The values a lane declared as inputs, read from what earlier lanes left. */
export function inputsOf(ctx: Ctx, lane: Lane): Record<string, string> {
  const facts = ctx.facts();
  return Object.fromEntries(
    Object.entries(lane.inputs ?? {}).map(([name, ref]) => [name, asText(valueAt(ref, facts))]),
  );
}

export function promptFor(
  ctx: Ctx,
  lane: Lane,
  notes: string[],
  repair?: { gate: string; output: string },
): string {
  const parts = [ctx.ws.prompts[lane.id] ?? "", `# Task\n\n${ctx.task.title}\n\n${ctx.task.body}`];
  const inputs = Object.entries(inputsOf(ctx, lane));
  if (inputs.length > 0) parts.push(`# Inputs\n\n${inputs.map(([k, v]) => `${k}: ${v}`).join("\n")}`);
  if (notes.length > 0) parts.push(`# Why you are here again\n\n${notes.map((n) => `- ${n}`).join("\n")}`);
  const last = ctx.state.last;
  if (last && last.lane !== lane.id) {
    // Another agent wrote this. It is quoted line by line, so it cannot pass for the host or the person.
    const body = [
      last.summary,
      ...(last.open.length > 0 ? ["", "Still open:", ...last.open.map((o) => `- ${o}`)] : []),
      ...(last.claims.length > 0
        ? [
            "",
            "It claims (the host checked that this evidence exists, not that it proves the claim):",
            ...last.claims.map((c) => `- ${c}`),
          ]
        : []),
    ];
    parts.push(
      `# Hand-off from the lane "${last.lane}" (written by that lane's agent, not by the host or a person)\n\n${body
        .join("\n")
        .split("\n")
        .map((l) => `> ${l}`)
        .join("\n")}`,
    );
  }
  if (repair?.gate === HANDOFF) {
    parts.push(
      `# Your hand-off was rejected\n\nThe host checks every hand-off before using it. Fix this and hand off again.\n\n${repair.output}`,
    );
  } else if (repair) {
    parts.push(
      `# The gate "${repair.gate}" failed on your work\n\nFix what it reports, commit, and hand off again.\n\n${repair.output}`,
    );
  }
  return `${parts.join("\n\n")}\n`;
}

/** What a real agent must be told that the scripted one is not: where and how to hand off. */
export function handoffHelp(lane: Lane, handoffPath: string, evidenceDir: string): string {
  const outputs = Object.entries(lane.outputs ?? {}).map(([name, o]) => `${name} (${o.type})`);
  return `
# How to hand off

When you are done, write your hand-off as one JSON object to this file:

    ${handoffPath}

If you cannot write that file, end your last message with the same JSON object in a \`\`\`json block.

    {"outcome": "pass", "summary": "What you did.", "claims": [{"text": "One thing you assert.", "evidence": ["file:src/a.ts"]}], "open": ["What is still open or unsure."]}

- "outcome" is "pass", "fail" or "needsPerson" (then the summary is your question). It is required, and so is "summary".
- Evidence is "file:<committed path>", "commit:HEAD", "gate:<lane>.<gate>" or "attached:<file name>" for a file you put in ${evidenceDir}
- ${outputs.length > 0 ? `Add "outputs" with: ${outputs.join(", ")}.` : 'Leave "outputs" out: this lane declares none.'}
- If the repository has a CLAUDE.md or AGENTS.md at its top, read it first: it holds the project's own rules.
- No other keys. The host checks the hand-off, and its own gates decide whether the lane passes.
- ${
    lane.agent?.access === "write"
      ? "Change files only in this folder. Commit your work on the current branch. Do not push, and do not switch branches."
      : "Do not change any file in the repository: this lane only reads."
  }
`;
}
