// What `softwarefactor` with no command, or with --help, prints.
export const HELP = `softwarefactor: a software factory you assemble yourself

Usage: softwarefactor <command>

  init                     Set up a factory in this repository (.factor/)
  check [files]            Check workflow files: each problem with its place and fix
  collect                  Ask the workflow's collectors for new tasks
  allow <server>           Show what an MCP server of the workflow runs, and let collectors start it
  allow --skill <name>     Show where a skill of the workflow comes from, and let runs install it
  add <source> [--yes]     Show what a plugin holds and would run, and install it on a yes
                           (a folder, owner/repo, or a name from \`plugins --available\`)
  ladder [accept <lane>]   Each lane's record and the step it has earned, or take that step
  escape <run> --lane <lane> --note "..."
                           Report a defect that got through a lane: the lane steps back
  retro [draft|keep|drop <id>]
                           What got through or happened again: draft a retro, keep its lesson
  eval [--list] [--break <gate>] [--save <file>] [--compare <file>]
                           Run the seeded cases: does the factory still catch what it must?
  export [workflow]        Print a workflow as one file to share: no secret, no account, no path
  import <file> [--yes]    Show what a shared workflow would run, and write it on a yes
  run [--all] [--parallel N] [--task <key or words>]
                           Pick up runs a crash left, wake waits that are due, then take the next
                           queued task through the workflow. With --all, keep going until the queue
                           is empty, several runs at once. With --task, take that queued task first
  stop <run>               Stop a run that is working or waiting
  requeue <run>            Put the task of a stopped or dropped run back in the queue
  resume <run>             Carry a run on that stopped on its budget, once the workflow allows more
  status                   Show tasks, runs, lanes, gates and where the evidence is
  runs [run] [--diff]      Show every run with one sentence on what is happening, or one run lane by
                           lane, or what it changed
  cost [--check] [--json] Show tokens and cost by task, lane, account and model, the cache hit
                           rate, the cost per landed task and the runs that cost most and did
                           not land. --check proves it against the session records;
                           --json prints the report as JSON (not with --check)
  plugins                  Show what is built in: lane types, gate types, collectors, agents, workflows
  ui [--port N]            Open the interface in a browser: the factory floor, on this machine only
  memory list | keep <id> | drop <id>
                           Show what the project remembers and what agents have proposed, and keep
                           or drop a proposed note
  sessions [run]           Show each start of an agent: account, model, tokens by kind and cost,
                           with a total per run and per account
  inbox                    Show what waits for a person
  version                  Print the version (also --version)
  approve <run>            Approve a waiting lane. With --item <n> on any decision: only if the run
                           still waits on that inbox item
  reject <run> [--note]    Reject it: the lane's fail transition is taken
  send-back <run> --note   Run the lane again with your note
  answer <run> --note      Answer a lane's question and run it again
  account add <name> --agent claude|codex|kimi|command --profile <folder>
          [--limit 5h=2000000] [--headroom 0.9] [--bin <path>] [--command "<shell command>"]
                           Name an agent login on this machine. The login stays in the CLI's own
                           profile folder: the factory stores only where it is
  account list | remove <name>
  role bind <role> --account <name> [--small <model>] [--medium <model>] [--large <model>] [--effort <level>]
                           Say which account works a role of the workflow, in this workspace
  role list                Show each role, its account, and any role that should be on another vendor
  mcp --operator --workspace <folder>
                           Serve every operation of the factory to your own agent as an MCP server
                           (docs/operations.md). Not for an agent inside a run

Exit codes for run and for a decision: 0 the task is done or dropped, 1 it stopped, 3 it waits.
`;
