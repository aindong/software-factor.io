// How a lane's gates are laid out for a person: in a lane that ended in a failure the gate that failed
// comes first, and the rounds the lane ran come latest first; a lane that passed keeps its time order.
import type { RunDetail } from "./api.ts";

type Lane = Pick<RunDetail["lanes"][number], "outcome" | "gates">;
type Gate = Lane["gates"][number];
export interface Round {
  round: number;
  gates: Gate[];
}

export function gateRounds(lane: Lane): Round[] {
  if (lane.outcome !== "fail") return lane.gates.length ? [{ round: 1, gates: lane.gates }] : [];
  const rounds = new Map<number, Gate[]>();
  for (const gate of lane.gates) rounds.set(gate.attempt, [...(rounds.get(gate.attempt) ?? []), gate]);
  return [...rounds]
    .sort(([a], [b]) => b - a)
    .map(([round, gates]) => ({
      round,
      // a stable sort: the failed ones first, each group in the order it ran
      gates: [...gates.filter((g) => g.status !== "pass"), ...gates.filter((g) => g.status === "pass")],
    }));
}

/** The gate a failed lane failed on, in its latest round: the one whose record is read first. */
export function failingGate(lane: Lane): Gate | undefined {
  const first = gateRounds(lane)[0]?.gates[0];
  return lane.outcome === "fail" && first?.status !== "pass" ? first : undefined;
}

/** What a gate checks, in the workflow's own words: the gate's `description`, when it has one. */
export function gateWhat(workflow: unknown, id: string): string | undefined {
  const gates = (workflow as { gates?: Record<string, { description?: unknown }> } | null)?.gates;
  const said = gates?.[id]?.description;
  return typeof said === "string" && said.trim() ? said.trim() : undefined;
}
