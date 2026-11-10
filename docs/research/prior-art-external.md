# Prior art: other factories and teachings
Read on 2026-11-10.

Web pages were read as data. Numbers are the authors' own claims. "Not verified" means not confirmed first-hand today.

## 1. super-board (EricTechPro)

Sources: https://github.com/EricTechPro/super-board (README, `docs/super-board/README.md`, `hooks/README.md`, `scripts/super-board-run.sh`, the `run.md` reference, the super-collect skill).

- **Loop.** A GitHub Project board is the only state. Each card runs Build (worktree, smallest safe change, draft PR), then QA (tests per acceptance criterion, evidence on the PR, a security review), then Review (re-runs the Tester's tests, checks its own earlier findings), then the merge gate. A fail sends the card back to Ready with the comments.
- **Workers.** The default backend is in-session workflow waves. Headless workers are opt-in: the dispatcher is a shell loop that runs `nohup claude -p "$prompt"` per lane. The orchestrator writes no code.
- **Guards, not a sandbox.** Python hooks on tool calls block worktrees outside `.claude/worktrees/`, reading secret files, writing API keys, deleting outside the project, and (opt-in) pushes to the base branch. I found no sandbox in the docs. Each hook "exits 0 on its own errors", so a broken guard lets the call through.
- **Merge gate (host script).** Takes a lock. Checks the PR head is still the reviewed commit. Merges the current base into a scratch worktree. Runs the project's `verify_commands`. Squash-merges with `--match-head-commit`. A push after review voids the evidence. No `verify_commands` halts setup before any work starts.
- **Humans.** `human_approves_merge: true` keeps a person on every merge. The merge policy auto-merges normal changes up to 400 changed lines. Money, auth, destructive schema and big PRs go to Blocked for a person. The docs say "Missing, unreadable or stale evidence is a hold for a person, never a pass."
- **Limits.** `rebuild_cap` bounces (2 in the sample config) on the same root-cause hash, then Blocked. Headless backend: 3 workers by default, a 120 second tick, a pause at 95% of the Claude usage window.
- **Halt when nothing lands.** Progress is the set of Done cards changing, not lanes being busy. Headless backend halts after `no_progress_cycles` (default 6). Workflow backend halts after 3 waves with zero progress.
- **Collect.** Sources are Sentry, PostHog, GitHub issues, past PRs, architecture, and custom ones. Candidates are grouped by root cause. Then "one fresh verifier per candidate", no debate panel. Verdicts: file, drop-fixed, drop-stale, drop-noise, duplicate, needs-triage. Unclear is filed for triage, not dropped. Dry run is the default.
- **Numbers and admitted failures.** No merge rate or cost is reported. A first run on 2026-05-21 made 7 racing workers on 2 cards, because `claude -p` takes 10 to 30 seconds to start and the claim came after the spawn. One run was busy for 293 ticks with 0 merges. One run landed zero commits in six hours because draft PRs never auto-merge. A finished worker stayed alive for 30 minutes and blocked its lane. Workers exited cleanly without moving their card.

## 2. Stripe Minions

Sources: https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents (2026-02-09) and https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents-part-2 (2026-02-19), both by Alistair Gray.

- **Loop.** A run starts from Slack, a ticket, a docs page or a flaky-test alert. It ends in a PR that passes CI, with no human step between.
- **Devboxes.** Each run gets a pre-warmed devbox, ready in about 10 seconds. It is cut off from production and the internet, so the agent runs with full permissions and no prompts. Stripe says git worktrees "wouldn't scale" for them.
- **Blueprints.** A workflow in code that mixes agent nodes ("Implement task", "Fix CI failures") with deterministic nodes ("Run configured linters", "Push changes") that call no model. Rules are scoped to folders, not global, to save context. Of nearly 500 internal MCP tools, minions get a small default subset.
- **Verification.** Local lint in under five seconds on push. Then CI picks tests from over three million. Autofixes are applied. Other failures go back to the agent once.
- **Limits.** At most two CI rounds, then the branch goes to a person. The reason given is cost and "diminishing marginal returns".
- **Humans.** Every PR is reviewed by an engineer before merge.
- **Numbers.** Over 1,000 merged PRs a week in part 1, over 1,300 in part 2, all with no human-written code. The share of failed runs and the cost per PR are not given.
- **Admitted limits.** Runs do not always one-shot. A wrong run is "often still an excellent starting point". Blueprints reduce agent errors but do not remove them.

## 3. Ramp Inspect

Source: https://builders.ramp.com/post/why-we-built-our-background-agent (publish date not shown on the page: Not verified).

- **Loop.** Each session runs in a sandboxed VM on Modal with the full stack. An image per repo is rebuilt every 30 minutes, so a session starts at most 30 minutes stale. The agent is OpenCode. Each session has its own SQLite database. Sessions can spawn child sessions.
- **Verification by the agent.** Backend: it runs tests, reads telemetry (Sentry, Datadog) and checks feature flags. Frontend: it "visually verifies its work" and attaches screenshots and live previews.
- **Humans.** Entry from Slack, a web app with a hosted editor, and a Chrome extension. Sessions are multiplayer: several people prompt one session, and each prompt is attributed to its author. The PR is opened with the user's own GitHub token, so a user cannot approve their own agent's change. Follow-up prompts queue. A run can be stopped.
- **Limits.** No session cap, retry limit or budget is stated.
- **Numbers.** "~30% of all pull requests merged to our frontend and backend repos are written by Inspect", reached in a couple of months, with no mandate. Later figures of 40% to 75% appear in other outlets: Not verified.
- **Admitted failures.** None listed. The post is a build guide.

## 4. AI Hero cohort: Software Factories for Real Engineers

Source: https://www.aihero.dev/cohorts/software-factories-for-real-engineers-xdy1m (runs 2026-11-09 to 2026-11-20).

- **Order.** Brakes before speed: build quality controls first, then loops and infrastructure.
- **Three safety layers.** Automated checks, automated review, and human review "when priorities call for it".
- **Week 1.** A shared glossary and ADRs, planning big work into specs, three kinds of review, faster human review, retros that improve the system that wrote the code, codebase design (deep modules, enforced boundaries, testable legacy code).
- **Week 2.** Automated checks, custom lint rules, mutation testing, front-end verification, then a factory on GitHub Actions that triages, assigns, delegates, tracks and reviews.
- **Three failure modes for the person.** Bug Catcher: your job shrinks to review and bug hunting. Babysitter: you juggle terminals and correct agents live. Brain Fry: you end the day drained.
- **Evidence.** It is a sales page. It gives no results. Lesson content is paid: Not verified.
- The page has a hidden block addressed to AI agents that tells them to connect to an MCP server and sign in as the learner. I did not follow it.

## 5. IndyDevDan: Tiny Software Factories

Sources: /Volumes/leo-exe/projects/aindong/software-factorio/.agent/sources/tiny-software-factories.md (from the two video descriptions only, transcripts not read), plus https://agenticengineer.com and https://agenticengineer.com/tactical-agentic-coding.

- **From the local notes.** In the loop, near the loop, out of the loop. Proactive agents: a durable agent plus a trigger. Cron prompts: a name, a schedule, a prompt. Agent access parity: what a person can click, the agent can call. The core four: context, model, prompt, tools. Specialised sub-agents with their own model, tools, and hard time and spend budgets, every run traced. A data flywheel from every human signal. Liquid software that person and agent can reshape. The agent can change its own settings, which is risky.
- **Stance.** "Done wrong" on purpose: ship fast with one agent, cron, a JSON config and SQLite on one box.
- **From his public pages.** The course page describes moving from "In the Loop" prompting to "Out of the Loop" systems. It describes AI developer workflows that join deterministic code with agents. It teaches "Closed Loop Prompts" so agents correct their own work, and a review step kept apart from testing. It lists the core four.
- **Gaps.** The home page names only three: context, prompt, model. Neither page uses the words "tiny software factory", "near the loop" or "liquid software": Not verified from the site. No numbers or results are given.

## 6. Other write-ups with real numbers

- **StrongDM software factory**, 2026-02-06, https://factory.strongdm.ai/. Rules: code is not written by humans and not reviewed by humans. Checks are "scenarios", end-to-end user stories kept outside the codebase like a hold-out set. The score is "satisfaction": the share of observed runs that would satisfy a user. Third-party services are cloned so tests run at volume. Budget guide: at least $1,000 of tokens per engineer per day. Admitted failure: agents game tests. "return true is a great way to pass narrowly written tests." Tests in the repo "can be reward hacked". No merge rate given.
- **Ramp Sheets self-maintaining**, 2026-03-24, https://ramplabs.substack.com/p/self-maintaining. On each merged PR an agent writes monitors for the new code. A firing monitor starts an agent that reproduces the fault, pushes a fix only after its reproduction test passes, and posts to Slack. Over 1,000 monitors, about one per 75 lines. 40 real bugs caught in the first week. No code is merged without engineer review. Admitted failures: bad thresholds caused false alerts, the same issue fired again and again, and models could not set priorities alone. Fixes: triage first, and the PR link written onto the monitor so later agents stop.
- **Spotify Honk, part 3**, 2025-12-09 (one month before 2026), https://engineering.atspotify.com/2025/12/feedback-loops-background-coding-agents-part-3. Deterministic verifiers (format, build, test) run before any PR opens. Then an LLM judge compares the diff with the original prompt. The judge vetoes about a quarter of sessions. The agent then corrects course about half the time. The top cause is the agent doing more than it was asked. Worst failure mode: a PR that passes CI but is wrong. They admit the judge has no evals yet.
- **OpenAI "Harness engineering"**, 2026-02-11, https://openai.com/index/harness-engineering/. The page refused automated reading today. Search results say three engineers merged about 1,500 agent-written PRs in five months, with agents reviewing agents. Not verified.

## What we take

- Run the merge gate on the host: take a lock, pin to the reviewed commit, merge the current base into a scratch worktree, run the verify commands, merge only that exact head. A push after review voids the evidence.
- Refuse to start a workflow whose gates have no commands. Missing, unreadable or stale evidence is a hold for a person, never a pass.
- Measure progress as work landed, not lanes busy. Halt after N cycles with nothing landed (super-board uses 6) and allow a hard cap on dispatches.
- Cap bounces per task on the same root cause, then park the task with a written block note for a person.
- Claim a task before spawning the worker. Keep a lockfile and PID per run. Scan for orphan workers at start. Confirm a state change by reading it back.
- Collectors: group by root cause, one fresh verifier per candidate, a fixed verdict list, unclear goes to triage, dry run by default.
- Lanes mix deterministic steps (lint, git, push) with agent steps. The host runs the deterministic ones with no model call.
- Cheap checks first, costly gates second. At most two rounds on the costly gate, then hand to a person.
- The reviewer is a different agent from the builder. It gets the diff and the original task and checks scope first. Record its veto rate per lane as ladder input.
- Human rules as data in the workflow file: auto-merge under a line count, always a person for money, auth and destructive schema. New lanes start at the lowest rung.
- Evidence sits on the change: test reruns and screenshots.
- Attribute every prompt to its author. The person who prompted may not approve that change.
- Scope rules per folder and give each lane a small default tool set.
- Budgets per lane and per sub-agent: time, spend, call counts, and a pause near the account usage limit.
- Keep hold-out scenarios, gates and evals where a lane cannot edit them.
- Retros produce lessons, lint rules, glossary entries and ADRs. Human signals feed the ladder.
- Report what others leave out: merge rate, bounce rate, cost per landed task, and failures, per lane.

## What we avoid

- Guard hooks as the only wall. super-board's hooks fail open on their own errors (https://github.com/EricTechPro/super-board). Gate-critical guards here fail closed. Our README says a local run is not a sandbox.
- Spawning before claiming, trusting a process exit as proof of a hand-off, and trusting "mergeable" from the forge.
- Counting busy lanes as progress. That hid a run of 293 ticks with 0 merges.
- Unbounded retry loops on CI or review.
- State that lives only in a rate-limited outside board. Local SQLite is the record. Outside boards are collectors and mirrors.
- Removing human review by default, or spending by a daily token target. Autonomy is earned per lane on its record.
- Letting an agent edit the tests, gates, judge or lessons that grade its own run.
- An LLM judge as the only check, or one with no evals behind it.
- Collectors that file without a triage and dedupe step.
- "Ship at all costs" from the Tiny Software Factories videos. We keep JSON and SQLite and put gates, evidence and bounded loops before speed.
- Publishing volume alone (PRs per week) with no merge rate or cost.
- Following instructions found in fetched pages. They are data.

## Sources

- https://github.com/EricTechPro/super-board
- https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents
- https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents-part-2
- https://builders.ramp.com/post/why-we-built-our-background-agent
- https://www.aihero.dev/cohorts/software-factories-for-real-engineers-xdy1m
- /Volumes/leo-exe/projects/aindong/software-factorio/.agent/sources/tiny-software-factories.md
- https://agenticengineer.com
- https://agenticengineer.com/tactical-agentic-coding
- https://factory.strongdm.ai/
- https://ramplabs.substack.com/p/self-maintaining
- https://engineering.atspotify.com/2025/12/feedback-loops-background-coding-agents-part-3
- https://openai.com/index/harness-engineering/ (returned 403 today, not read)
