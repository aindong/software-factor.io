// Plugins: what this version has built in to assemble a factory from, by the names a workflow
// uses. Installing more from a directory is not built yet, and the screen says so.
import { useEffect, useState } from "react";
import type { PluginsView } from "../core/views.ts";
import { op } from "./api.ts";
import { coded } from "./words.ts";
import "./runs.css";
import "./sections.css";

const KINDS: [keyof Pick<PluginsView, "lanes" | "gates" | "collectors" | "agents">, string, string][] = [
  ["lanes", "Lane types", "What a lane can be: `uses` in a lane."],
  ["gates", "Gate types", "Checks the host runs on a lane's work: `uses` in a gate."],
  ["collectors", "Collectors", "Where tasks come from: `uses` in a collector."],
  ["agents", "Agents", "The CLIs an account can be a login of. `fake` is the scripted agent."],
];

const Coded = ({ sentence }: { sentence: string }) =>
  coded(sentence).map((part) => (part.code ? <code key={part.text}>{part.text}</code> : part.text));

export function Plugins() {
  const [built, setBuilt] = useState<PluginsView>();
  useEffect(() => {
    op<PluginsView>("plugins_list").then(({ status, body }) => {
      if (status === 200) setBuilt(body);
    });
  }, []);
  return (
    <main className="work">
      <div className="topbar">
        <div className="where">
          <h1>Plugins</h1>
          <span>what is built in</span>
        </div>
      </div>
      <div className="page">
        {!built ? (
          <p className="quiet">Reading what is built in.</p>
        ) : (
          <>
            {KINDS.map(([key, title, what]) => (
              <section key={key} className="block">
                <h2>{title}</h2>
                <p className="quiet">
                  <Coded sentence={what} />
                </p>
                <ul className="names">
                  {built[key].map((name) => (
                    <li key={name} className="code">
                      {name}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            <section className="block">
              <h2>Workflows</h2>
              <p className="quiet">The workflows that come with this version, to start from.</p>
              <div className="scroll-x">
                <table className="table stack">
                  <tbody>
                    {built.workflows.map((w) => (
                      <tr key={w.name}>
                        <th scope="row" className="code">
                          {w.name}
                        </th>
                        <td>{w.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            <p className="quiet">
              <Coded sentence={built.installing} />
            </p>
          </>
        )}
      </div>
    </main>
  );
}
