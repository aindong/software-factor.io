// What failed, for a run that stopped on a gate: the lane, the gate in plain words, and the gate's output,
// directly under the head. The output is the lane's own gate row (the same open state), shown here first.
import type { RunDetail } from "./api.ts";
import { FileView, Proof } from "./Evidence.tsx";
import type { ProofProps } from "./LaneVisit.tsx";
import { span } from "./words.ts";

export function Failed(props: {
  lane: string;
  gate: RunDetail["lanes"][number]["gates"][number];
  what?: string;
  runId: string;
  proof: (key: string) => ProofProps;
}) {
  const { gate } = props;
  // not the lane's row: that one registers itself for "bring into view"; this is a second view of the same state
  const proof = { ...props.proof(gate.output), at: undefined };
  return (
    <div className="block failed">
      <h3>What failed</h3>
      <p className="says">
        {props.lane} stopped the run at the gate <b>{gate.gate}</b>
        {props.what ? `, which checks: ${props.what.replace(/\.$/, "")}` : ""}.
      </p>
      <Proof
        {...proof}
        mark={<span className="mark fail" aria-hidden="true" />}
        label={`Output of gate ${gate.gate}`}
        meta={[gate.exitCode === null ? "" : `exit ${gate.exitCode}`, span(gate.durationMs)]
          .filter(Boolean)
          .join(", ")}
      >
        <FileView runId={props.runId} path={gate.output} name="output.log" />
      </Proof>
    </div>
  );
}
