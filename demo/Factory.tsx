import { type Act, Stage } from "./.stageshow/kit";
import "./factory.css";

// One task, "Say hello", goes down the five lanes of the starter workflow. It is drawn with the product's own
// class names and style sheets (src/ui), so a change of the design shows here. What it says is in STEPS.

type S = { n: number; g: number; go: boolean };
const LANES = [
  { id: "plan", name: "Plan", sub: "author", capsule: true },
  { id: "build", name: "Build", sub: "author" },
  { id: "review", name: "Review", sub: "reviewer" },
  { id: "test", name: "Test", sub: "tester" },
  { id: "ship", name: "Ship", sub: "command", capsule: true },
] as const;
const GATES = ["protected", "tests kept", "verify"];
const X = (i: number) => i * 124; // the product's spacing between stations
const DONE = 5;
const PARK = { x: 770, y: 332 }; // the pointer rests in the empty corner

type Step = {
  /** The lane the train is at, none once the run is done. */
  at?: number;
  asks?: boolean;
  passed: number; // lanes behind the run
  lit: number; // lines the run has taken
  word: "Working" | "Waits for you" | "Done";
  /** The run's sentence, as src/core/runs/sentence.ts writes it. "Done." is left out, as the product leaves it out. */
  sentence?: string;
};
const gatesRunning = (done: number) =>
  `Build: the agent has finished and its gates are running (${done} of 3 done).`;
const STEPS: Step[] = [
  { at: 0, passed: 0, lit: 0, word: "Working", sentence: "Plan: the agent is working." },
  {
    at: 0,
    asks: true,
    passed: 1,
    lit: 0,
    word: "Waits for you",
    sentence: "Plan has finished and waits for your approval.",
  },
  { at: 1, passed: 1, lit: 1, word: "Working", sentence: "Build: the agent is working." },
  { at: 1, passed: 1, lit: 1, word: "Working" }, // the gates run (S.g counts them); the sentence follows
  { at: 2, passed: 2, lit: 2, word: "Working", sentence: "Review: the agent is working." },
  { at: 3, passed: 3, lit: 3, word: "Working", sentence: "Test: the agent is working." },
  {
    at: 4,
    asks: true,
    passed: 4,
    lit: 4,
    word: "Waits for you",
    sentence: "Ship waits for your approval before it runs.",
  },
  { at: 4, passed: 4, lit: 4, word: "Working", sentence: "Ship: its command is running." },
  { passed: 5, lit: 5, word: "Done" },
];
const LAST = STEPS.length - 1;
const sentenceOf = (s: S) => (s.n === 3 ? gatesRunning(Math.floor(s.g / 2)) : STEPS[s.n]?.sentence);
const SENTENCES = [
  ...new Set([...STEPS.flatMap((t) => (t.sentence ? [t.sentence] : [])), ...[0, 1, 2, 3].map(gatesRunning)]),
];

let cycles = 0;
const script = async (a: Act<S>) => {
  a.mark(`cycle${++cycles}`); // film.mjs cuts one loop between two of these
  a.put({ n: 0, g: 0, go: false });
  await a.wait(500);
  a.put({ go: true }); // the task enters the line
  await a.wait(1600);
  a.put({ n: 1 }); // Plan passed, the run waits for a person
  await a.wait(700);
  await a.move("approve", { duration: 700 });
  await a.click("approve");
  a.put({ n: 2 });
  a.move(PARK, { duration: 800 });
  await a.wait(400);
  a.put({ n: 3 });
  for (let g = 1; g <= 6; g++) {
    await a.wait(450);
    a.put({ g }); // the host runs each gate: working, then passed
  }
  await a.wait(450);
  a.put({ n: 4 });
  await a.wait(900);
  a.put({ n: 5 });
  await a.wait(900);
  a.put({ n: 6 });
  await a.wait(600);
  await a.move("approve", { duration: 700 });
  await a.click("approve");
  a.put({ n: 7 });
  a.move(PARK, { duration: 800 });
  await a.wait(1100);
  a.put({ n: LAST }); // merged: the payoff holds
  await a.wait(1800);
  a.put({ n: 0, g: 0, go: false }); // the next task is about to enter
  await a.wait(300);
};

function LineMap({ s }: { s: S }) {
  const step = STEPS[s.n] as Step;
  const station = (i: number) => {
    const ran = i < step.passed ? "pass" : step.asks && step.at === i ? "asked" : "none";
    return ran;
  };
  return (
    <svg
      className="map overlaid"
      width="800"
      height="152"
      viewBox="-70 -76 760 160"
      role="img"
      aria-label="The run on the workflow"
    >
      <title>The run on the workflow</title>
      {/* the lines the run has not taken step back */}
      {[0, 1, 2, 3, 4].map((i) => {
        const lit = i < step.lit;
        const flowing = s.go && lit && i === step.lit - 1 && !step.asks && step.word === "Working";
        const d = `M${X(i)} 0H${X(i + 1)}`;
        return (
          <g key={i}>
            <path className={`line pass${lit ? " lit" : ""}`} d={d} />
            {flowing && <path className="flow" d={d} />}
            <path className="head" d={`M${X(i + 1) - 21} -3L${X(i + 1) - 26} -5.500V5.500Z`} />
          </g>
        );
      })}
      {GATES.map((g, k) => (
        <rect key={g} className="gate" x={X(1) + 30 + k * 7} y={-9} width={3} height={18} rx={1.5} />
      ))}
      {LANES.map((l, i) => {
        const ran = station(i);
        const working = s.go && step.at === i && !step.asks && step.word === "Working";
        const capsule = "capsule" in l;
        return (
          <g
            key={l.id}
            className={`station lane${ran !== "none" ? ` ran-${ran}` : ""}${working ? " working" : ""}`}
            transform={`translate(${X(i)} 0)`}
          >
            {working &&
              (capsule ? (
                <rect className="pulse" x="-31" y="-22" width="62" height="44" rx="22" />
              ) : (
                <circle className="pulse" r="22" />
              ))}
            {capsule ? (
              <rect className="body" x="-20" y="-11" width="40" height="22" rx="11" />
            ) : (
              <circle className="body" r="11" />
            )}
            {ran === "pass" && <path className="mark" d="M-4.500 0l3 3 6-6" />}
            {ran === "asked" && <path className="mark" d="M0-4.500v5M0 4v.01" />}
            <text className="name" x="0" y="-36" textAnchor="middle">
              {l.name}
            </text>
            <text className="sub" x="0" y="-21" textAnchor="middle">
              {l.sub}
            </text>
            {s.go && step.at === i && (
              <g
                className={`train${step.asks ? " asks" : ""}${working ? " working" : ""}`}
                transform="translate(0 30)"
              >
                <rect x="-17" y="-9" width="34" height="18" rx="9" />
                <text y="4" textAnchor="middle">
                  1
                </text>
              </g>
            )}
          </g>
        );
      })}
      <g
        className={`station end done${step.passed === DONE ? " ran-pass" : " far"}`}
        transform={`translate(${X(DONE)} 0)`}
      >
        <circle className="body" r="11" />
        <path className="mark" d="M-4.500 0l3 3 6-6" />
        <text className="name" x="0" y="-36" textAnchor="middle">
          Done
        </text>
      </g>
    </svg>
  );
}

function Gates({ s }: { s: S }) {
  return (
    <div className="fx-gates">
      <span className="label">Gates run on the host</span>
      {GATES.map((g, k) => {
        const mark = s.n > 3 || s.g >= 2 * k + 2 ? "pass" : s.g === 2 * k + 1 ? "working" : "none";
        return (
          <span key={g} className="fx-gate" data-on={mark !== "none" || undefined}>
            <i className={`mark ${mark}`} />
            {g}
          </span>
        );
      })}
    </div>
  );
}

export default function Factory() {
  return (
    <Stage<S>
      width={800}
      height={352}
      initial={{ n: 0, g: 0, go: false }}
      poster={{ n: LAST, g: 6, go: true }}
      script={script}
      cursor={{ at: PARK, style: "arrow", ripple: true, idle: 1200 }}
      className="fx"
    >
      {(s) => {
        const step = STEPS[s.n] as Step;
        const mark = step.word === "Working" ? "working" : step.word === "Done" ? "pass" : "asked";
        return (
          <>
            <header className="fx-head">
              <div className="fx-task">
                <span className="fx-num">1</span>
                <b className="fx-title">Say hello</b>
              </div>
              <p className="state" data-on={s.go || undefined}>
                <span className={`mark ${mark}`} aria-hidden="true" />
                <b>{step.word}</b>
                <span className="fx-sentences">
                  {SENTENCES.map((t) => (
                    <span
                      key={t}
                      className="fx-sentence"
                      data-on={(s.go && t === sentenceOf(s)) || undefined}
                    >
                      {t}
                    </span>
                  ))}
                </span>
              </p>
              <button
                type="button"
                className="button approve fx-approve"
                data-target="approve"
                data-on={step.asks || undefined}
              >
                Approve <kbd>a</kbd>
              </button>
            </header>
            <div className="fx-map">
              <LineMap s={s} />
            </div>
            <div className="fx-cols">
              {LANES.map((l, i) => (
                <div key={l.id} className="fx-col" style={{ left: 74 + X(i) * 1.053 }}>
                  {i === 1 ? <Gates s={s} /> : null}
                  {i !== 1 ? (
                    <span className="fx-pass" data-on={i < step.passed || undefined}>
                      <i className={`mark${i < step.passed ? " pass" : ""}`} />
                      <span className="fx-word">passed</span>
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          </>
        );
      }}
    </Stage>
  );
}
