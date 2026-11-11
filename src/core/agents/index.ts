// Which agent works a lane: the role's binding names the scripted agent or an account, and the
// account names the CLI.
import { type Account, readAccounts } from "../accounts.ts";
import type { RoleBinding } from "../config.ts";
import { UserError } from "../errors.ts";
import { own } from "../schema/builtins.ts";
import type { Lane } from "../schema/workflow.ts";
import { claudeAgent } from "./claude.ts";
import { codexAgent } from "./codex.ts";
import { fakeAgent } from "./fake.ts";
import { commandAgent, kimiAgent } from "./others.ts";
import type { AgentAdapter } from "./types.ts";

export interface Bound {
  adapter: AgentAdapter;
  /** The agent's kind: fake, claude, codex, kimi or command. */
  agent: string;
  /** The account's name, when the role is bound to one. */
  account?: string;
  /** The model the binding names for the lane's tier: none for the CLI's own. */
  model?: string;
}

/** The account a binding names, or nothing for the scripted agent. Refused when it is not on this machine. */
export function accountOf(
  binding: RoleBinding,
  role: string,
): { name: string; account: Account } | undefined {
  if (!("account" in binding)) return undefined;
  const account = own(readAccounts(), binding.account);
  if (!account) {
    throw new UserError(
      `The role "${role}" is bound to the account "${binding.account}", which is not on this machine.`,
      "Add it with `softwarefactor account add`, or bind the role to another account with `softwarefactor role bind`.",
    );
  }
  return { name: binding.account, account };
}

export function adapterFor(binding: RoleBinding, lane: Lane): Bound {
  if (!("account" in binding)) return { adapter: fakeAgent(binding), agent: "fake" };
  const found = accountOf(binding, lane.agent?.role ?? "");
  if (!found) throw new Error("an account binding has an account");
  const { name, account } = found;
  const choice = {
    model: binding.models?.[lane.agent?.tier ?? "medium"],
    effort: lane.agent?.effort ?? binding.effort,
  };
  const adapter =
    account.agent === "claude"
      ? claudeAgent(account, choice)
      : account.agent === "codex"
        ? codexAgent(account, choice)
        : account.agent === "kimi"
          ? kimiAgent(account, choice)
          : commandAgent(account);
  return { adapter, agent: account.agent, account: name, model: choice.model };
}

/** The command line of the factor server for one start of a lane. Which lane it serves is fixed here. */
export const serverFor = (root: string, run: string, lane: string, laneDir: string, account: string) => [
  ...[process.execPath, process.argv[1] ?? "", "mcp", "--workspace", root, "--run", run],
  ...["--lane", lane, "--lane-dir", laneDir, "--account", account],
];

/**
 * The roles a lane's agents work as: the lane's own, and those its panel members name. With
 * `joins`, only the members that take part this time.
 */
export function rolesOf(lane: Lane, joins: (member: Member) => boolean = () => true): string[] {
  const members = (lane.panel?.members ?? []).filter(joins).map((m) => m.role);
  // the lane's own role works only when a member has none of its own, or there is no panel
  const usesOwn = !lane.panel || (lane.panel.members ?? []).filter(joins).some((m) => m.role === undefined);
  return [...new Set([usesOwn ? lane.agent?.role : undefined, ...members].filter((r) => r !== undefined))];
}
type Member = NonNullable<Lane["panel"]>["members"][number];

/** For each role of the lane that should be on another vendor than some role and is not: what to say. */
export function sameVendor(
  roles: Record<string, { differentVendorFrom?: string[] }>,
  bindings: Record<string, RoleBinding>,
  lane: Lane,
  joins?: (member: Member) => boolean,
): string[] {
  const vendorOf = (role: string) => {
    const binding = own(bindings, role);
    return binding ? accountOf(binding, role)?.account.agent : undefined;
  };
  return rolesOf(lane, joins).flatMap((role) =>
    (own(roles, role)?.differentVendorFrom ?? [])
      .filter((other) => vendorOf(role) !== undefined && vendorOf(role) === vendorOf(other))
      .map(
        (other) =>
          `the role "${role}" is on the same vendor as "${other}" (${vendorOf(role)}): for an independent review, bind one of them to another vendor`,
      ),
  );
}
