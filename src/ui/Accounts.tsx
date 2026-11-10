// Accounts: the agent logins on this machine, and which one works each role of the workflow.
// A role is bound here as `softwarefactor role bind` binds it. Adding a login stays in the
// terminal, where the login itself is made.
import { useCallback, useEffect, useState } from "react";
import type { AccountsView } from "../core/views.ts";
import { op } from "./api.ts";
import "./runs.css";
import "./sections.css";

const whole = new Intl.NumberFormat("en-US");
type Role = AccountsView["roles"][number];
const EFFORTS = ["", "low", "medium", "high", "max"];

function RoleRow({
  role,
  accounts,
  onBound,
}: {
  role: Role;
  accounts: string[];
  onBound: (said: string, bad: boolean) => void;
}) {
  const bound = typeof role.works === "object" && role.works ? role.works.account : "";
  const [account, setAccount] = useState(bound);
  const [models, setModels] = useState(role.models);
  const [effort, setEffort] = useState(role.effort ?? "");
  const [busy, setBusy] = useState(false);
  const changed =
    account !== bound ||
    effort !== (role.effort ?? "") ||
    JSON.stringify(models) !== JSON.stringify(role.models);
  const bind = async () => {
    setBusy(true);
    const sizes = Object.fromEntries(Object.entries(models).filter(([, model]) => model.trim() !== ""));
    const { status, body } = await op("roles_bind", {
      role: role.role,
      account,
      ...sizes,
      ...(effort ? { effort } : {}),
    });
    setBusy(false);
    if (status === 200) onBound(`The role ${role.role} is now worked by ${account}.`, false);
    else onBound(`${body.error ?? "The binding was not taken."}${body.fix ? ` ${body.fix}` : ""}`, true);
  };
  return (
    <tr>
      <th scope="row">
        {role.role}
        <span className="quiet sub">{role.description}</span>
        {role.sameVendorAs.length > 0 ? (
          <span className="flagged">
            <span className="mark fail" aria-hidden="true" />
            Same vendor as {role.sameVendorAs.join(", ")}. Bind one of them to another vendor.
          </span>
        ) : null}
      </th>
      <td data-label="Account">
        <select
          aria-label={`Account for the role ${role.role}`}
          value={account}
          onChange={(event) => setAccount(event.target.value)}
        >
          {bound === "" ? (
            <option value="">{role.works === "scripted" ? "the scripted agent" : "not bound"}</option>
          ) : null}
          {bound !== "" && !accounts.includes(bound) ? (
            // bound to a login that was removed, or made on another machine: shown as it is
            <option value={bound}>{bound} (not on this machine)</option>
          ) : null}
          {accounts.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
      </td>
      {(["small", "medium", "large"] as const).map((size) => (
        <td key={size} data-label={`Model for ${size} lanes`}>
          <input
            aria-label={`Model for ${size} lanes of ${role.role}`}
            value={models[size] ?? ""}
            placeholder="the CLI's own"
            spellCheck={false}
            onChange={(event) => setModels({ ...models, [size]: event.target.value })}
          />
        </td>
      ))}
      <td data-label="Effort">
        <select
          aria-label={`Effort for the role ${role.role}`}
          value={effort}
          onChange={(event) => setEffort(event.target.value)}
        >
          {EFFORTS.map((e) => (
            <option key={e} value={e}>
              {e || "the CLI's own"}
            </option>
          ))}
        </select>
      </td>
      <td>
        <button
          type="button"
          className="button"
          disabled={!changed || !accounts.includes(account) || busy}
          onClick={bind}
        >
          Bind
        </button>
      </td>
    </tr>
  );
}

export function Accounts() {
  const [view, setView] = useState<AccountsView>();
  const [notice, setNotice] = useState<{ text: string; bad: boolean }>();
  const read = useCallback(() => {
    op<AccountsView>("accounts_list").then(({ status, body }) => {
      if (status === 200) setView(body);
      else
        setNotice({
          text: `${body.error ?? "The accounts could not be read."}${body.fix ? ` ${body.fix}` : ""}`,
          bad: true,
        });
    });
  }, []);
  useEffect(read, [read]);
  return (
    <main className="work">
      <div className="topbar">
        <div className="where">
          <h1>Accounts</h1>
          {view ? (
            <span>
              {view.accounts.length === 1 ? "1 login" : `${view.accounts.length} logins`} on this machine
            </span>
          ) : null}
        </div>
        <div className="group push">
          <span className={`status${notice?.bad ? " bad" : ""}`} role="status">
            {notice?.text}
          </span>
        </div>
      </div>
      <div className="page">
        {!view ? (
          <p className="quiet">{notice ? "" : "Reading the accounts."}</p>
        ) : (
          <>
            <section className="block">
              <h2>Logins</h2>
              {view.accounts.length === 0 ? (
                <p className="quiet">
                  No login yet. Until there is one, roles are worked by the scripted agent.
                </p>
              ) : (
                <div className="scroll-x">
                  <table className="table">
                    <thead>
                      <tr>
                        <th scope="col">Account</th>
                        <th scope="col">Agent</th>
                        <th scope="col">Used</th>
                        <th scope="col">On hold</th>
                      </tr>
                    </thead>
                    <tbody>
                      {view.accounts.map((a) => (
                        <tr key={a.name}>
                          <th scope="row">{a.name}</th>
                          <td>{a.agent}</td>
                          <td className="data">
                            {a.limits.length === 0
                              ? "no limit set"
                              : a.limits.map((l) => (
                                  <span key={l.hours} className="limit">
                                    {whole.format(l.used)} of {whole.format(l.tokens)} tokens in {l.hours} h
                                    {l.used >= l.tokens * a.headroom ? ", at its headroom" : ""}
                                  </span>
                                ))}
                          </td>
                          <td className="data">
                            {a.heldUntil
                              ? `until ${new Date(a.heldUntil).toLocaleTimeString()}, at its limit`
                              : "no"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="quiet">
                A login is made in a terminal, in the agent's own CLI. Then name its folder here:{" "}
                <code>softwarefactor account add work --agent claude --profile ~/.claude</code>
              </p>
            </section>
            <section className="block">
              <h2>Who works each role</h2>
              <div className="scroll-x">
                <table className="table roles">
                  <thead>
                    <tr>
                      <th scope="col">Role</th>
                      <th scope="col">Account</th>
                      <th scope="col">Model for small lanes</th>
                      <th scope="col">For medium</th>
                      <th scope="col">For large</th>
                      <th scope="col">Effort</th>
                      <td />
                    </tr>
                  </thead>
                  <tbody>
                    {view.roles.map((role) => (
                      <RoleRow
                        // a row begins again from the record whenever the record changes
                        key={JSON.stringify(role)}
                        role={role}
                        accounts={view.accounts.map((a) => a.name)}
                        onBound={(text, bad) => {
                          setNotice({ text, bad });
                          if (!bad) read();
                        }}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
