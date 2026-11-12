// The logins on this machine, each with the limit windows its CLI reports and, apart from them, the
// factory's own count. A login on hold or near the end of a window says so in words, after a diamond.
import { useEffect, useState } from "react";
import type { Window } from "../core/limits.ts";
import type { AccountsView } from "../core/views.ts";
import { ago } from "./words.ts";
import "./accounts.css";

type Login = AccountsView["accounts"][number];
const whole = new Intl.NumberFormat("en-US");
/** 90% of a window: the share at which a login is near its limit. */
const NEAR = 90;
export const AGENT_WORDS: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  kimi: "Kimi",
  command: "a command",
};

export const isNear = (a: Login) =>
  (a.reading?.windows ?? []).some((w) => (w.percent ?? 0) >= NEAR) ||
  a.limits.some((l) => l.used >= (l.tokens * NEAR) / 100);

const Flag = ({ children }: { children: React.ReactNode }) => (
  <span className="flag">
    <span className="mark fail" aria-hidden="true" />
    {children}
  </span>
);

function WindowRow({ w, login }: { w: Window; login: string }) {
  if (w.percent === null) {
    return (
      <li className="window">
        <span className="name">{w.name}</span>
        <span className="said quiet">not reported</span>
      </li>
    );
  }
  return (
    <li className="window">
      <span className="name">{w.name}</span>
      <meter
        min={0}
        max={100}
        value={w.percent}
        aria-label={`${w.name} of ${login}`}
        aria-valuetext={`${w.percent}% used`}
      />
      <span className="said data">
        {w.percent >= NEAR ? <span className="mark fail" aria-hidden="true" /> : null}
        <strong>{w.percent}% used</strong>
        {w.resets ? ` · resets ${w.resets}` : ""}
      </span>
    </li>
  );
}

/** What its CLI says: the windows, how old the reading is, or why there is none. */
function Reported({ a, now }: { a: Login; now: number }) {
  const r = a.reading;
  if (!r) return <p className="quiet">Not read yet.</p>;
  return (
    <>
      {r.failed ? (
        <p className="said">
          <Flag>The limits could not be read: {r.failed}</Flag>
        </p>
      ) : null}
      {r.none ? <p className="quiet">{r.none}</p> : null}
      {r.windows.length > 0 ? (
        <ul className="windows">
          {r.windows.map((w) => (
            <WindowRow key={w.name} w={w} login={a.name} />
          ))}
        </ul>
      ) : null}
      {r.none ? null : (
        <p className="quiet age">
          Read <time dateTime={r.at}>{ago(r.at, now)}</time>
        </p>
      )}
    </>
  );
}

export function Logins({ accounts }: { accounts: AccountsView["accounts"] }) {
  // the age of a reading is said against now, so it is said again each minute; nothing is read
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(tick);
  }, []);
  return (
    <div className="logins">
      {accounts.map((a) => (
        <article key={a.name} className="login" aria-labelledby={`login-${a.name}`}>
          <header className="head">
            <h3 id={`login-${a.name}`}>
              {a.name} <span className="agent quiet">{AGENT_WORDS[a.agent] ?? a.agent}</span>
            </h3>
            {a.heldUntil ? (
              <Flag>
                On hold until{" "}
                {new Date(a.heldUntil).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              </Flag>
            ) : null}
            {isNear(a) ? <Flag>Near a limit</Flag> : null}
          </header>
          <div className="parts">
            <section>
              <h4 className="label">What its CLI reports</h4>
              <Reported a={a} now={now} />
            </section>
            <section>
              <h4 className="label">The factory's own count</h4>
              {a.limits.length === 0 ? (
                <p className="quiet">
                  None set. It is set with <code>--limit</code> when the login is added.
                </p>
              ) : (
                a.limits.map((l) => (
                  <p key={l.hours} className="data">
                    {whole.format(l.used)} of {whole.format(l.tokens)} tokens in {l.hours} h
                  </p>
                ))
              )}
            </section>
          </div>
        </article>
      ))}
    </div>
  );
}
