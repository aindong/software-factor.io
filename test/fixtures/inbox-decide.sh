# decide_fixture: in a scratch workspace under $work, three runs that wait for a person: two builds that
# wait for approval when done (and then wait before "Ship it", a described command), and a question.
# Source it after setting $here and $work and defining `sf` and `fail`; it leaves the shell in the workspace.
decide_fixture() {
  mkdir -p "$work/demo-shop" && cd "$work/demo-shop" || fail "no work folder"
  git init -q -b main && git config user.email t@example.com && git config user.name T
  echo "# demo" > README.md && git add -A && git commit -q -m initial
  sf init > /dev/null || fail "init"
  rm -f .factor/workflows/starter.json
  node -e '
const fs = require("fs");
const from = (id) => ({ id, uses: "core/file@1", with: { path: ".factor/" + id + ".md" } });
const workflow = {
  $schema: "https://softwarefactor.io/schema/workflow/v1.json",
  version: 1,
  name: "delivery",
  description: "Sort, build, ship or ask.",
  roles: { author: { description: "Writes." } },
  limits: { minutes: 60, tokens: 1000000 },
  commands: {
    verify: { description: "The tests." },
    ship: { description: "Pushes the run branch and opens a pull request." },
  },
  collectors: ["builds", "questions"].map(from),
  gates: { verify: { uses: "core/command@1", with: { command: "verify" }, onFail: "fail" } },
  lanes: [
    { id: "sort", name: "Sort", uses: "core/command@1", with: { run: "true" }, checkpoint: "out",
      on: { pass: [{ to: "ask", when: { ref: "task.source", in: ["questions"] } }, { to: "build" }], fail: "@stop" } },
    { id: "build", name: "Build", uses: "core/agent@1", agent: { role: "author", access: "write", prompt: "Build it." },
      gates: ["verify"], checkpoint: "in", on: { pass: "ship", fail: "@stop" } },
    { id: "ship", name: "Ship it", uses: "core/command@1", with: { command: "ship" }, checkpoint: "in", on: { pass: "@done", fail: "@stop" } },
    { id: "ask", name: "Plan", uses: "core/agent@1", agent: { role: "author", access: "read", prompt: "Plan it." },
      checkpoint: "out", on: { pass: "@done", fail: "@stop" } },
  ],
};
fs.writeFileSync(".factor/workflows/delivery.json", JSON.stringify(workflow, null, 2));
const f = JSON.parse(fs.readFileSync(".factor/factory.json"));
fs.writeFileSync(".factor/factory.json", JSON.stringify({ ...f, workflow: "delivery", commands: { verify: "true", ship: "true" }, slots: { max: 2 } }, null, 2));
fs.writeFileSync(".factor/builds.md", "- [ ] Add an export button for the monthly sales report\n- [ ] Add a search box to the order list\n");
fs.writeFileSync(".factor/questions.md", "- [ ] Pick a database\n");
const build = (file) => [{ write: { path: file, content: "export const label = 1;\n" } }, { commit: "Add " + file }, { handoff: { outcome: "pass", summary: "Added " + file + "." } }];
const roles = { author: { adapter: "fake", script: {
  build: [build("src/export.ts"), build("src/search.ts")],
  ask: [[{ handoff: { outcome: "needsPerson", summary: "Which database should the export read from?" } }]],
} } };
fs.writeFileSync(".factor/local.json", JSON.stringify({ roles }, null, 2));
'
  git add -A && git commit -q -m "set up the factory"
  sf check > "$work/check.log" 2>&1 || fail "the workflow does not pass the checker: $(cat "$work/check.log")"
  for n in 1 2 3; do
    sf run > "$work/run$n.log" 2>&1
    [ $? -eq 3 ] || fail "run $n should wait for a person: $(cat "$work/run$n.log")"
  done
}
