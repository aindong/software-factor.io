// The models a role's tier can be bound to, each with its version: those the product knows for an
// agent, newest first, then what the account has run here. No Node import: the page reads it too.

export interface ModelChoice {
  value: string;
  label: string;
}

const CLAUDE = /^claude-([a-z]+)-(\d+)(?:-(\d+))?$/;
const GPT = /^gpt-(\d+(?:\.\d+)?)-([a-z]+)$/;
const word = (w: string) => (w[0] ?? "").toUpperCase() + w.slice(1);

/** "Sonnet 5.5 (claude-sonnet-5-5)", "GPT-6.1 Sol (gpt-6.1-sol)"; any other name as itself. */
export function modelLabel(name: string): string {
  const claude = CLAUDE.exec(name);
  if (claude) return `${word(claude[1] ?? "")} ${claude[2]}${claude[3] ? `.${claude[3]}` : ""} (${name})`;
  const gpt = GPT.exec(name);
  if (gpt) return `GPT-${gpt[1]} ${word(gpt[2] ?? "")} (${name})`;
  return name;
}

/** The version of a name, as numbers to compare: [] for a name with none. */
function versionOf(name: string): number[] {
  const claude = CLAUDE.exec(name);
  if (claude) return [Number(claude[2]), Number(claude[3] ?? 0)];
  const gpt = GPT.exec(name);
  return gpt ? (gpt[1] ?? "").split(".").map(Number).concat(0).slice(0, 2) : [];
}

const PREFIX: Record<string, string> = { claude: "claude-", codex: "gpt-" };

/**
 * The list for an account of `agent`: the `known` models of its agent, highest version first and
 * a version in the order of `known`, then from `ran` (its sessions here, latest first) what the
 * list does not know: an asked name with the version it last ran as, and a model it ran.
 */
export function modelChoices(
  agent: string,
  known: string[],
  ran: { asked: string | null; model: string | null }[],
): ModelChoice[] {
  const prefix = PREFIX[agent];
  const mine = prefix === undefined ? [] : known.filter((name) => name.startsWith(prefix));
  const newer = (a: string, b: string) => {
    const [x, y] = [versionOf(a), versionOf(b)];
    if (x.length === 0 || y.length === 0) return y.length - x.length;
    return (y[0] ?? 0) - (x[0] ?? 0) || (y[1] ?? 0) - (x[1] ?? 0);
  };
  const list: ModelChoice[] = [...mine].sort(newer).map((name) => ({ value: name, label: modelLabel(name) }));
  const has = (name: string) => list.some((c) => c.value === name);
  // the latest session that says another name for an asked one says the version it last ran as
  const ranAs = new Map<string, string>();
  for (const { asked, model } of ran) {
    if (asked && model && model !== asked && !ranAs.has(asked)) ranAs.set(asked, model);
  }
  for (const name of ran.flatMap(({ asked, model }) => [asked, model])) {
    if (!name || has(name)) continue;
    const as = ranAs.get(name);
    list.push({ value: name, label: as ? `${name} (last ran as ${as})` : name });
  }
  return list;
}

/** The list with a bound model it does not know first, as itself, so the binding is shown and kept. */
export function withBound(choices: ModelChoice[], bound: string | undefined): ModelChoice[] {
  if (!bound || choices.some((c) => c.value === bound)) return choices;
  return [{ value: bound, label: bound }, ...choices];
}
