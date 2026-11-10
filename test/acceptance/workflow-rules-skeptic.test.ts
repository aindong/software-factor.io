import { bounded, describeRejects, guarded, lane, type Reject } from "./rules-helpers.ts";

// Rules added after a skeptic wrote real processes as workflows and probed the checker twice.
const rejects: Reject[] = [
  // found by the skeptic's second pass over the schema
  [
    "a one-way lane that restarts after a crash",
    (w) => {
      lane(w, "open-pr").oneWay = true;
      lane(w, "open-pr").retry = { max: 1 };
    },
    /^lanes\[1\]\.retry$/,
    /retry/,
  ],
  [
    "a loop back into a one-way lane",
    (w) => {
      lane(w, "fix").oneWay = true;
      lane(w, "fix").checkpoint = "in";
      lane(w, "fix").retry = { max: 0 };
      lane(w, "open-pr").on.fail = bounded;
    },
    /^lanes\[1\]\.on\.fail\[0\]$/,
    /once/,
  ],
  [
    "a condition with nothing to compare against",
    (w) => {
      lane(w, "fix").on.pass = [{ to: "open-pr", when: { ref: "change.tier" } }, { to: "@stop" }];
    },
    /^lanes\[0\]\.on\.pass\[0\]\.when$/,
    /"in"/,
  ],
  [
    "a condition on a value that cannot occur",
    (w) => {
      lane(w, "fix").on.pass = [
        { to: "open-pr", when: { ref: "change.tier", in: ["eazy"] } },
        { to: "@stop" },
      ];
    },
    /^lanes\[0\]\.on\.pass\[0\]\.when\.in$/,
    /refactor/,
  ],
  [
    "a gate result that cannot occur",
    (w) => {
      lane(w, "open-pr").on.pass = [
        { to: "@done", when: { ref: "fix.gates.verify", in: ["passed"] } },
        { to: "@stop" },
      ];
    },
    /^lanes\[1\]\.on\.pass\[0\]\.when\.in$/,
    /pass, fail/,
  ],
  [
    "a value that is not one a condition may read",
    (w) => {
      lane(w, "fix").on.pass = [
        { to: "open-pr", when: { ref: "task.priority", in: ["p1"] } },
        { to: "@stop" },
      ];
    },
    /^lanes\[0\]\.on\.pass\[0\]\.when\.ref$/,
    /task\.labels/,
  ],
  [
    "a lane that continues its own session",
    (w) => {
      lane(w, "fix").agent.session = { continue: "fix" };
    },
    /^lanes\[0\]\.agent\.session$/,
    /earlier agent lane/,
  ],
  [
    "a repair gate on a lane with no agent",
    (w) => {
      lane(w, "open-pr").gates = ["verify"];
    },
    /^lanes\[1\]\.gates$/,
    /repair/,
  ],
  [
    "a panel that can change files",
    (w) => {
      lane(w, "fix").panel = { join: "all", members: [{ id: "a" }, { id: "b" }] };
    },
    /^lanes\[0\]\.panel$/,
    /"read"/,
  ],
  [
    "a panel where nobody decides",
    (w) => {
      lane(w, "fix").agent.access = "read";
      lane(w, "fix").gates = [];
      lane(w, "fix").panel = {
        join: "all",
        members: [
          { id: "a", advisory: true },
          { id: "b", advisory: true },
        ],
      };
    },
    /^lanes\[0\]\.panel\.members$/,
    /advisory/,
  ],
  [
    "a panel member with a role that is not declared",
    (w) => {
      lane(w, "fix").agent.access = "read";
      lane(w, "fix").gates = [];
      lane(w, "fix").panel = { join: "all", members: [{ id: "a" }, { id: "b", role: "ghost" }] };
    },
    /^lanes\[0\]\.panel\.members\[1\]\.role$/,
    /ghost/,
  ],
  [
    "a misspelt setting on a collector",
    (w) => {
      w.collectors[0].with.pth = 1;
    },
    /^collectors\[0\]\.with$/,
    /pth/,
  ],
  [
    "a schedule with no time",
    (w) => {
      w.collectors[0] = { id: "s", uses: "core/schedule@1", with: { title: "t", body: "b" } };
    },
    /^collectors\[0\]\.with\.cron$/,
    /cron/,
  ],
  [
    "a gate with two commands",
    (w) => {
      w.gates.verify.with = { run: "true", command: "verify" };
    },
    /^gates\.verify\.with$/,
    /exactly one/,
  ],
  [
    "a secret pasted into a setting",
    (w) => {
      w.collectors[0].with.label = `ghp_${"a1B2".repeat(9)}`;
    },
    /^collectors\[0\]\.with\.label$/,
    /environment variable/,
  ],
  [
    "a prompt file outside the workflow's folder",
    (w) => {
      lane(w, "fix").agent.prompt = { file: "/etc/passwd" };
    },
    /^lanes\[0\]\.agent\.prompt\.file$/,
    /relative/,
  ],
  [
    "a lane budget in dollars when the run has none",
    (w) => {
      lane(w, "fix").limits.usd = 5;
    },
    /^lanes\[0\]\.limits\.usd$/,
    /run's/,
  ],
  [
    "a vendor preference naming an unknown role",
    (w) => {
      w.roles.author.differentVendorFrom = ["ghost"];
    },
    /^roles\.author\.differentVendorFrom$/,
    /declared/,
  ],
  [
    "a transition written as a bare object",
    (w) => {
      lane(w, "fix").on.pass = { to: "open-pr" };
    },
    /^lanes\[0\]\.on\.pass$/,
    /list/,
  ],
  [
    "a version written as text",
    (w) => {
      w.version = "1";
    },
    /^version$/,
    /number/,
  ],
  [
    "a lane id with capitals",
    (w) => {
      lane(w, "open-pr").id = "Open_PR";
    },
    /^lanes\[1\]\.id$/,
    /lowercase/,
  ],

  // found by the skeptic's third pass
  [
    "a loop that would pass through a one-way lane again",
    (w) => {
      Object.assign(lane(w, "open-pr"), { oneWay: true });
      lane(w, "open-pr").on = { pass: "smoke", fail: "@stop", needsPerson: "@stop" };
      w.lanes.push({
        id: "smoke",
        uses: "core/command@1",
        with: { run: "true" },
        checkpoint: "out",
        on: { pass: "@done", fail: bounded },
      });
    },
    /^lanes\[2\]\.on\.fail\[0\]$/,
    /once/,
  ],
  [
    "a one-way lane that waits in the inbox and runs again",
    (w) => {
      lane(w, "open-pr").oneWay = true;
      lane(w, "open-pr").on = { pass: "@done", fail: "@inbox", needsPerson: "@stop" };
    },
    /^lanes\[1\]\.on\.fail$/,
    /@stop/,
  ],
  [
    "a one-way lane that leaves needsPerson to its default",
    (w) => {
      lane(w, "open-pr").oneWay = true;
    },
    /^lanes\[1\]\.on$/,
    /needsPerson/,
  ],
  [
    "a one-way lane with a repair gate",
    (w) => {
      Object.assign(lane(w, "fix"), { oneWay: true, checkpoint: "in" });
      lane(w, "fix").on.needsPerson = "@stop";
    },
    /^lanes\[0\]\.gates$/,
    /one-way/,
  ],
  [
    "a panel where every deciding member is conditional",
    (w) => {
      lane(w, "fix").agent.access = "read";
      lane(w, "fix").gates = [];
      lane(w, "fix").panel = {
        join: "all",
        members: [
          { id: "a", when: { ref: "task.source", in: ["bugs"] } },
          { id: "b", advisory: true },
        ],
      };
    },
    /^lanes\[0\]\.panel\.members$/,
    /"when"/,
  ],
  [
    "a repair gate on a panel lane",
    (w) => {
      lane(w, "fix").agent.access = "read";
      lane(w, "fix").panel = { join: "all", members: [{ id: "a" }, { id: "b" }] };
    },
    /^lanes\[0\]\.gates$/,
    /panel/,
  ],
  [
    "a session continued from a later lane",
    (w) => {
      lane(w, "fix").agent.session = { continue: "later" };
      lane(w, "open-pr").on.pass = "later";
      w.lanes.push({
        id: "later",
        uses: "core/agent@1",
        agent: { role: "author", access: "read", prompt: "Summarise." },
        checkpoint: "out",
        on: { pass: "@done", fail: "@stop" },
      });
    },
    /^lanes\[0\]\.agent\.session$/,
    /earlier/,
  ],
  [
    "a session continued from a panel",
    (w) => {
      lane(w, "fix").agent.access = "read";
      lane(w, "fix").gates = [];
      lane(w, "fix").panel = { join: "all", members: [{ id: "a" }, { id: "b" }] };
      lane(w, "open-pr").on.pass = "second";
      w.lanes.push({
        id: "second",
        uses: "core/agent@1",
        agent: { role: "author", access: "read", prompt: "Summarise.", session: { continue: "fix" } },
        checkpoint: "out",
        on: { pass: "@done", fail: "@stop" },
      });
    },
    /^lanes\[2\]\.agent\.session$/,
    /panel/,
  ],
  [
    "a condition on a collector that does not exist",
    (w) => {
      lane(w, "fix").on.pass = [
        { to: "open-pr", when: { ref: "task.source", in: ["nowhere"] } },
        { to: "@stop" },
      ];
    },
    /^lanes\[0\]\.on\.pass\[0\]\.when\.in$/,
    /bugs/,
  ],
  [
    "a condition on the change when no lane can write",
    (w) => {
      lane(w, "fix").agent.access = "read";
      lane(w, "fix").gates = [];
      lane(w, "fix").on.pass = guarded;
    },
    /^lanes\[0\]\.on\.pass\[0\]\.when\.ref$/,
    /"write"/,
  ],
  [
    "a yes-or-no output compared with text",
    (w) => {
      lane(w, "fix").outputs.flaky = { type: "boolean" };
      lane(w, "open-pr").on.pass = [
        { to: "@done", when: { ref: "fix.outputs.flaky", in: ["yes"] } },
        { to: "@stop" },
      ];
    },
    /^lanes\[1\]\.on\.pass\[0\]\.when\.in$/,
    /true/,
  ],
  [
    "an output name that cannot be an environment variable",
    (w) => {
      lane(w, "fix").outputs["my-plan"] = { type: "string" };
    },
    /^lanes\[0\]\.outputs/,
    /planPath/,
  ],
  [
    "two outputs that differ only by capitals",
    (w) => {
      lane(w, "fix").outputs.planA = { type: "string" };
      lane(w, "fix").outputs.plana = { type: "string" };
    },
    /^lanes\[0\]\.outputs$/,
    /FACTOR_OUTPUT_/,
  ],
  [
    "a payment key pasted into a prompt",
    (w) => {
      lane(w, "fix").agent.prompt = `Use sk_live_${"a1B2".repeat(6)} to test.`;
    },
    /^lanes\[0\]\.agent\.prompt$/,
    /environment variable/,
  ],
  [
    "a key in a URL",
    (w) => {
      w.mcp = { docs: { from: "url", url: "https://example.com/mcp?api_key=abcdef123456" } };
    },
    /^mcp\.docs\.url$/,
    /environment variable/,
  ],
  [
    "a value under a key named password",
    (w) => {
      lane(w, "fix").meta = { password: "hunter2hunter2" };
    },
    /^lanes\[0\]\.meta\.password$/,
    /environment variable/,
  ],
  [
    "a fixed wait with polling settings",
    (w) => {
      lane(w, "open-pr").on.pass = "pause";
      w.lanes.push({
        id: "pause",
        uses: "core/wait@1",
        with: { minutes: 5, everyMinutes: 1 },
        checkpoint: "out",
        on: { pass: "@done", fail: "@stop" },
      });
    },
    /^lanes\[2\]\.with$/,
    /everyMinutes/,
  ],
  [
    "a wait with no end",
    (w) => {
      lane(w, "open-pr").on.pass = "pause";
      w.lanes.push({
        id: "pause",
        uses: "core/wait@1",
        with: { minutes: 999999999 },
        checkpoint: "out",
        on: { pass: "@done", fail: "@stop" },
      });
    },
    /^lanes\[2\]\.with\.minutes$/,
    /one week/,
  ],
  [
    "a prompt file on a Windows drive",
    (w) => {
      lane(w, "fix").agent.prompt = { file: "C:\\Users\\me\\prompt.md" };
    },
    /^lanes\[0\]\.agent\.prompt\.file$/,
    /relative/,
  ],
  [
    "a workspace command that is not declared",
    (w) => {
      delete w.commands.verify;
    },
    /^gates\.verify\.with\.command$/,
    /"commands"/,
  ],
];

describeRejects("rules found by the skeptic", rejects);
