# one_lane: in an initialised workspace, give it the workflow that `init` used to write (one agent lane
# at "in", the verify gate) with a scripted author, for checks that need some small workflow and are
# not about the starter. Source it after setting $here.
one_lane() {
  cp "$here/test/fixtures/workflows/one-lane.json" .factor/workflows/starter.json
  node -e '
const fs = require("fs");
const f = JSON.parse(fs.readFileSync(".factor/factory.json"));
delete f.commands.ship;
fs.writeFileSync(".factor/factory.json", JSON.stringify(f, null, 2) + "\n");
const script = [
  { write: { path: "FACTOR-HELLO.md", content: "Hello from the scripted agent.\n" } },
  { commit: "Say hello from the factory" },
  { handoff: { outcome: "pass", summary: "Added FACTOR-HELLO.md." } },
];
const roles = { author: { adapter: "fake", script: { "*": script } } };
fs.writeFileSync(".factor/local.json", JSON.stringify({ roles }, null, 2) + "\n");
'
}
