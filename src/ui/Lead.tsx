// The first thing in an inbox item's detail: the lane the decision is about, with its proof open, so
// it is read before the map and before the other lanes. The same components as the run's page uses.
import { groupEvidence } from "../core/runs/track.ts";
import type { RunDetail } from "./api.ts";
import { FileView, PairView, Proof } from "./Evidence.tsx";
import { failingGate } from "./gates.ts";
import { LaneVisit, type ProofProps } from "./LaneVisit.tsx";
import { LEAD_HEAD } from "./lead.ts";

type Lane = RunDetail["lanes"][number];
type Item = Parameters<typeof LEAD_HEAD>[0];

/** The pictures and recordings this lane attached: not the output of its gates and commands. */
export function leadFiles(detail: RunDetail, lane: Lane) {
  const outputs = new Set(
    detail.lanes.flatMap((l) => [
      l.output,
      ...l.gates.flatMap((g) => [g.output, g.output.replace(/\.log$/, ".base.log")]),
    ]),
  );
  const g = groupEvidence(detail.files.filter((f) => f.visit === lane.id && !outputs.has(f.path)));
  return { pairs: g.pairs, others: [...g.recordings, ...g.images] };
}

/** The proofs that are open on arrival: the lane's evidence and the pictures it attached. */
export function leadKeys(detail: RunDetail, lane: Lane): string[] {
  const { pairs, others } = leadFiles(detail, lane);
  return [
    `lane:${lane.id}`,
    ...(failingGate(lane) ? [failingGate(lane)?.output ?? ""] : []),
    ...pairs.map((p) => p.before.path),
    ...others.map((f) => f.path),
  ];
}

export function Lead(props: {
  item: Item;
  detail: RunDetail;
  lane: Lane | undefined;
  name: string;
  round?: number;
  runId: string;
  proof: (key: string) => ProofProps;
  show: (path: string) => void;
  what?: (gate: string) => string | undefined;
}) {
  const { detail, lane, runId, proof } = props;
  if (!lane) {
    return (
      <div className="block lead">
        <h3>{LEAD_HEAD(props.item)}</h3>
        <p className="quiet">No lane has run yet, so there is no work to read before you decide.</p>
      </div>
    );
  }
  const { pairs, others } = leadFiles(detail, lane);
  return (
    <div className="block lead">
      <h3>{LEAD_HEAD(props.item)}</h3>
      <LaneVisit
        lane={lane}
        name={props.name}
        round={props.round}
        runId={runId}
        files={detail.files}
        proof={proof}
        show={props.show}
        what={props.what}
      />
      {pairs.map((pair) => (
        <Proof
          key={pair.before.path}
          {...proof(pair.before.path)}
          label={`Before and after${pair.name ? `: ${pair.name}` : ""}`}
        >
          <PairView runId={runId} before={pair.before} after={pair.after} />
        </Proof>
      ))}
      {others.map((f) => (
        <Proof key={f.path} {...proof(f.path)} label={`${f.name}`}>
          <FileView runId={runId} path={f.path} name={f.name} />
        </Proof>
      ))}
    </div>
  );
}
