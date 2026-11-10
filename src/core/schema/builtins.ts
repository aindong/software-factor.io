// The built-in lane, gate and collector types and the settings ("with") each accepts.
// A plugin's types are checked by the plugin. These are checked here, strictly.
import { z } from "zod";

/** A command the workspace defines in .factor/factory.json, such as `verify` or `test:e2e`. */
export const commandName = z.string().regex(/^[a-zA-Z][\w:.-]*$/, {
  message:
    'A command name starts with a letter and uses letters, digits, ".", ":", "_" and "-", such as "test:e2e".',
});

const serverName = z.string().regex(/^[a-z][a-z0-9-]*$/);
const outside = (p: string) =>
  p.startsWith("/") || p.startsWith("~") || /^[A-Za-z]:/.test(p) || p.split(/[\\/]/).includes("..");
export const insidePath = z
  .string()
  .min(1)
  .refine((p) => !outside(p), {
    message:
      'Use a relative path that stays inside the folder, with no leading /, no drive letter and no "..".',
  });

const WEEK_MINUTES = 7 * 24 * 60;
const MONTH_HOURS = 30 * 24;

const command = z
  .strictObject({
    run: z.string().min(1).optional(),
    command: commandName.optional(),
    timeoutMinutes: z.number().int().positive().optional(),
  })
  .refine((v) => (v.run === undefined) !== (v.command === undefined), {
    message: 'Name exactly one of "run" (a shell command) or "command" (a name declared in "commands").',
  });

const wait = z
  .strictObject({
    minutes: z.number().int().positive().optional(),
    until: command.optional(),
    everyMinutes: z.number().int().positive().optional(),
    timeoutHours: z.number().positive().optional(),
  })
  .refine((v) => (v.minutes === undefined) !== (v.until === undefined), {
    message:
      'Give exactly one of "minutes" (a fixed wait) or "until" (a command that exits 0 when the wait is over).',
  })
  .refine((v) => v.minutes === undefined || (v.everyMinutes === undefined && v.timeoutHours === undefined), {
    message: 'A fixed wait takes only "minutes". Remove "everyMinutes" and "timeoutHours", or use "until".',
  })
  .refine((v) => v.until === undefined || (v.everyMinutes !== undefined && v.timeoutHours !== undefined), {
    message:
      'With "until", add "everyMinutes" (how often to check) and "timeoutHours" (when to ask a person instead).',
  })
  .refine((v) => (v.minutes ?? 0) <= WEEK_MINUTES, {
    path: ["minutes"],
    message: `A fixed wait can be at most ${WEEK_MINUTES} minutes (one week).`,
  })
  .refine((v) => (v.timeoutHours ?? 0) <= MONTH_HOURS, {
    path: ["timeoutHours"],
    message: `"timeoutHours" can be at most ${MONTH_HOURS} (30 days).`,
  });

export type CommandSettings = z.infer<typeof command>;
export type WaitSettings = z.infer<typeof wait>;

type Kind = "lane" | "gate" | "collector";
const globs = z.array(z.string().min(1)).min(1).optional();

/** What `with` must look like for each built-in. `null` means the type takes no settings. */
export const BUILTINS: Record<Kind, Record<string, z.ZodType | null>> = {
  lane: {
    "core/agent@1": null,
    "core/command@1": command,
    "core/wait@1": wait,
  },
  gate: {
    "core/command@1": command,
    "core/protected-paths@1": z.strictObject({ paths: globs }).optional(),
    "core/tests-not-weakened@1": z.strictObject({ testGlobs: globs }).optional(),
    "core/test-floor@1": z.strictObject({ command: commandName.optional() }).optional(),
    "core/new-tests-fail-on-base@1": z
      .strictObject({ command: commandName.optional(), testGlobs: globs })
      .optional(),
  },
  collector: {
    "core/file@1": z.strictObject({ path: insidePath }),
    "core/github-issues@1": z.strictObject({
      label: z.string().min(1),
      repo: z
        .string()
        .regex(/^[\w.-]+\/[\w.-]+$/)
        .optional(),
    }),
    "core/schedule@1": z.strictObject({
      cron: z
        .string()
        .regex(/^(\S+\s+){4}\S+$/, { message: 'Write "cron" as five fields, such as "0 3 * * *".' }),
      title: z.string().min(1),
      body: z.string().min(1),
    }),
    "core/mcp-query@1": z.strictObject({
      server: serverName,
      tool: z.string().min(1),
      args: z.record(z.string(), z.unknown()).optional(),
    }),
  },
};

/** A record's own entry. Plain indexing would also find inherited names such as "constructor". */
export function own<T>(record: Record<string, T> | undefined, key: string): T | undefined {
  return record !== undefined && Object.hasOwn(record, key) ? record[key] : undefined;
}

/** Every workspace command a settings object names, with where it is named. */
export function commandsIn(settings: unknown, path = "with"): { name: string; path: string }[] {
  if (typeof settings !== "object" || settings === null) return [];
  const s = settings as { command?: unknown; until?: unknown };
  const here = typeof s.command === "string" ? [{ name: s.command, path: `${path}.command` }] : [];
  return [...here, ...commandsIn(s.until, `${path}.until`)];
}

// Text that looks like a credential. A shared workflow must never carry one. Token prefixes must
// start a word, so ordinary words such as "risk-assessment" do not match.
const START = "(?<![A-Za-z0-9_-])";
const SECRET = new RegExp(
  [
    `${START}gh[pousr]_[A-Za-z0-9]{20,}`,
    `${START}github_pat_\\w{20,}`,
    `${START}glpat-[\\w-]{16,}`,
    `${START}(sk|rk|pk)_(live|test)_[A-Za-z0-9]{16,}`,
    `${START}sk-(ant|proj)-[\\w-]{20,}`,
    `${START}sk-(?=[A-Za-z0-9]*\\d)[A-Za-z0-9]{32,}`,
    `${START}AKIA[0-9A-Z]{16}`,
    `${START}xox[abprs]-[A-Za-z0-9-]{10,}`,
    "-----BEGIN [A-Z ]*PRIVATE KEY( BLOCK)?-----",
    `${START}eyJ[\\w-]{10,}\\.[\\w-]{10,}\\.[\\w-]{10,}`,
    // a secret as a URL parameter or in the user part, unless the value is read from the environment
    "[?&;][\\w.-]*(key|token|secret|password|passwd|auth)=(?!\\$)[^&\\s]{6,}",
    "://[^/\\s:@]+:(?!\\$)[^/\\s:@]{3,}@",
  ].join("|"),
  "i",
);
const SECRET_KEY =
  /^(password|passwd|secret|token|api[_-]?key|access[_-]?token|private[_-]?key|client[_-]?secret)$/i;
// Under these keys every value is the name of an environment variable or a reference, never a secret.
const NAMES_ONLY = new Set(["env", "headersEnv", "inputs"]);
const MAX_DEPTH = 40;

export interface SecretHit {
  path: string;
  /** The start of the text that matched, so a false alarm can be found. */
  shown: string;
}

/** Every string in the file that looks like a secret, or sits under a key named like one. */
export function findSecrets(value: unknown, path = "", key = "", namesOnly = false, depth = 0): SecretHit[] {
  if (depth > MAX_DEPTH) return [];
  if (typeof value === "string") {
    const match = SECRET.exec(value);
    if (match) return [{ path: path || "(top)", shown: `${match[0].slice(0, 8)}...` }];
    if (!namesOnly && SECRET_KEY.test(key) && value.length > 0)
      return [{ path, shown: `the value of "${key}"` }];
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((v, i) => findSecrets(v, `${path}[${i}]`, key, namesOnly, depth + 1));
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([k, v]) =>
      findSecrets(v, path ? `${path}.${k}` : k, k, namesOnly || NAMES_ONLY.has(k), depth + 1),
    );
  }
  return [];
}
