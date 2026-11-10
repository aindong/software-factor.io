// The built-in lane, gate and collector types and the settings ("with") each accepts.
// A plugin's types are checked by the plugin. These are checked here, strictly.
import { z } from "zod";

const name = z.string().regex(/^[a-z][a-z0-9-]*$/);
const inside = z
  .string()
  .min(1)
  .refine((p) => !p.startsWith("/") && !p.startsWith("~") && !p.split(/[\\/]/).includes(".."), {
    message: 'Use a path inside the workspace, with no leading / and no "..".',
  });

const commandShape = {
  run: z.string().min(1).optional(),
  command: name.optional(),
  timeoutMinutes: z.number().int().positive().optional(),
};
const oneCommand = 'Name exactly one of "run" (a shell command) or "command" (a name from factory.json).';
const command = z
  .strictObject(commandShape)
  .refine((v) => (v.run === undefined) !== (v.command === undefined), { message: oneCommand });

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
  .refine((v) => v.until === undefined || v.timeoutHours !== undefined, {
    message: 'Add "timeoutHours": how long to wait for "until" before asking a person.',
  });

type Kind = "lane" | "gate" | "collector";

/** What `with` must look like for each built-in. `null` means the type takes no settings. */
export const BUILTINS: Record<Kind, Record<string, z.ZodType | null>> = {
  lane: {
    "core/agent@1": null,
    "core/command@1": command,
    "core/wait@1": wait,
  },
  gate: {
    "core/command@1": command,
    "core/protected-paths@1": z
      .strictObject({ paths: z.array(z.string().min(1)).min(1).optional() })
      .optional(),
    "core/tests-not-weakened@1": z
      .strictObject({ testGlobs: z.array(z.string().min(1)).min(1).optional() })
      .optional(),
    "core/test-floor@1": z.strictObject({ command: name.optional() }).optional(),
    "core/new-tests-fail-on-base@1": z
      .strictObject({ command: name.optional(), testGlobs: z.array(z.string().min(1)).min(1).optional() })
      .optional(),
  },
  collector: {
    "core/file@1": z.strictObject({ path: inside }),
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
      server: name,
      tool: z.string().min(1),
      args: z.record(z.string(), z.unknown()).optional(),
    }),
  },
};

// Text that looks like a credential. A shared workflow must never carry one.
const SECRET =
  /(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_\w{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|xox[abprs]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/;

/** Paths of every string in the file that looks like a secret. */
export function findSecrets(value: unknown, path = ""): string[] {
  if (typeof value === "string") return SECRET.test(value) ? [path || "(top)"] : [];
  if (Array.isArray(value)) return value.flatMap((v, i) => findSecrets(v, `${path}[${i}]`));
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([k, v]) => findSecrets(v, path ? `${path}.${k}` : k));
  }
  return [];
}
