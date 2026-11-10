// Costs: where the tokens and the money went, by lane, by task and by account, from the session
// records. A cost that is not known is said to be not known: it is never shown as nothing spent.
import { useEffect, useState } from "react";
import type { CostLine, CostsView } from "../core/views.ts";
import { op } from "./api.ts";
import { useRuns } from "./live.ts";
import "./runs.css";
import "./sections.css";

const whole = new Intl.NumberFormat("en-US");
const amount = (line: CostLine) => (line.usd === null ? "not known" : `$${line.usd.toFixed(4)}`);

function Table({
  title,
  head,
  rows,
}: {
  title: string;
  head: string;
  rows: (CostLine & { name: string })[];
}) {
  return (
    <section className="block">
      <h2>{title}</h2>
      <div className="scroll-x">
        <table className="table costs">
          <thead>
            <tr>
              <th scope="col">{head}</th>
              <th scope="col" className="num">
                Sessions
              </th>
              <th scope="col" className="num">
                Tokens
              </th>
              <th scope="col" className="num">
                Cost
              </th>
              <th scope="col">Not counted</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name}>
                <th scope="row">{row.name}</th>
                <td className="num data">{whole.format(row.sessions)}</td>
                <td className="num data">{whole.format(row.tokens)}</td>
                <td className="num data">{amount(row)}</td>
                <td className="quiet">
                  {row.unknown > 0 && row.usd !== null
                    ? `${row.unknown} ${row.unknown === 1 ? "session" : "sessions"} of unknown cost`
                    : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function Costs() {
  const { runs } = useRuns();
  const [costs, setCosts] = useState<CostsView>();
  // read again when a run has used more
  const used = (runs ?? []).reduce((sum, r) => sum + r.tokens, 0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: asked again when the runs have used more
  useEffect(() => {
    let left = false;
    op<CostsView>("costs").then(({ status, body }) => {
      if (!left && status === 200) setCosts(body);
    });
    return () => {
      left = true;
    };
  }, [used]);
  const total = costs?.total;
  return (
    <main className="work">
      <div className="topbar">
        <div className="where">
          <h1>Costs</h1>
          {total ? (
            <span>
              {whole.format(total.tokens)} tokens, {amount(total)}
              {total.unknown > 0 && total.usd !== null ? `, and ${total.unknown} of unknown cost` : ""}
            </span>
          ) : null}
        </div>
      </div>
      <div className="page">
        {!costs ? (
          <p className="quiet">Reading the session records.</p>
        ) : costs.total.sessions === 0 ? (
          <p className="quiet">No sessions yet. A session is recorded each time an agent starts on a lane.</p>
        ) : (
          <>
            <Table title="By lane" head="Lane" rows={costs.byLane.map((l) => ({ ...l, name: l.lane }))} />
            <Table
              title="By task"
              head="Task"
              rows={costs.byTask.map((t) => ({ ...t, name: `${t.task} (${t.runs.join(", ")})` }))}
            />
            <Table
              title="By account"
              head="Account"
              rows={costs.byAccount.map((a) => ({
                ...a,
                name: a.account ?? `the scripted agent (${a.agent})`,
              }))}
            />
            <p className="quiet">
              A cost is what the agent's CLI reported, or its tokens priced from the table of list prices.
              With a subscription login nothing is billed by the token: the amount is what the same use would
              cost on a key.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
