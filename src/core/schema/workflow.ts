// The workflow file format. This Zod schema is the one source for types, validation and the
// published JSON Schema (ADR 0001, ADR 0012). Rules a shape cannot express live in check.ts.
import { z } from "zod";

export const SCHEMA_URL = "https://softwarefactor.io/schema/workflow/v1.json";
export const WORKFLOW_VERSION = 1;

/** Where a run can end instead of entering another lane. */
export const END_TARGETS = ["@done", "@drop", "@stop", "@inbox"] as const;

/** How risky a change is, worked out by the host from the files it touches. */
export const CHANGE_TIERS = ["docs", "refactor", "api", "ui", "sensitive"] as const;

const id = z
  .string()
  .regex(/^[a-z][a-z0-9-]*$/)
  .max(40)
  .meta({
    description: "Lowercase letters, digits and dashes. Stable: transitions point at ids, never names.",
  });

const uses = z
  .string()
  .regex(/^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*@[1-9][0-9]*$/)
  .meta({ description: "What this is, as namespace/type@major. The namespace `core` is built in." });

const envName = z
  .string()
  .regex(/^[A-Z_][A-Z0-9_]*$/)
  .meta({ description: "The NAME of an environment variable on the machine. Never a value." });

const target = z.union([id, z.enum(END_TARGETS)]).meta({
  description:
    "A lane id, or @done (finished), @drop (not work after all), @stop (ended, a person takes over), @inbox (wait for a person).",
});

// A value a condition can look at. Never an expression.
const ref = z
  .string()
  .regex(
    /^(task\.(source|labels)|change\.tier|[a-z][a-z0-9-]*\.(outputs\.[a-zA-Z][a-zA-Z0-9]*|gates\.[a-z][a-z0-9-]*))$/,
  )
  .meta({
    description:
      "task.source, task.labels, change.tier, <lane>.outputs.<name>, or <lane>.gates.<gate> (pass or fail).",
  });

const scalar = z.union([z.string(), z.number(), z.boolean()]);

export const Condition = z
  .strictObject({
    ref,
    in: z.array(scalar).min(1).optional(),
    notIn: z.array(scalar).min(1).optional(),
  })
  .refine((c) => (c.in === undefined) !== (c.notIn === undefined), {
    message: 'Give the condition exactly one of "in" or "notIn", such as "in": ["ui"].',
  })
  .meta({
    description:
      "True when the value at `ref` is (or, for a list, contains) one of `in`, or none of `notIn`.",
  });

const Step = z.strictObject({
  to: target,
  when: Condition.optional(),
  maxRounds: z.number().int().min(1).max(10).optional().meta({
    description: "How many times this transition may be taken in one run. Required when it points back.",
  }),
});

const Transition = z.union([target, z.array(Step).min(1)]).meta({
  description:
    "A target, or a list tried in order: the first entry that applies wins, the last is a plain default.",
});

const insidePath = z
  .string()
  .min(1)
  .refine((p) => !p.startsWith("/") && !p.startsWith("~") && !p.split(/[\\/]/).includes(".."), {
    message: 'Use a relative path that stays inside the folder, with no leading / and no "..".',
  });
const Prompt = z.union([z.string().min(1), z.strictObject({ file: insidePath })]);
const Tier = z.enum(["small", "medium", "large"]);
const Effort = z.enum(["low", "medium", "high", "max"]);

const Agent = z.strictObject({
  role: id.meta({ description: "A role declared in `roles`. Each machine binds roles to accounts." }),
  access: z
    .enum(["read", "write"])
    .meta({ description: "Whether this lane may change files in the worktree." }),
  prompt: Prompt.meta({ description: "The instructions, inline or as a file path beside the workflow." }),
  tier: Tier.optional().meta({ description: "Model size, resolved to a real model by the role's binding." }),
  effort: Effort.optional(),
  skills: z.array(z.string().min(1)).optional().meta({ description: "Names declared in `skills`." }),
  mcp: z.array(id).optional().meta({ description: "Names declared in `mcp`." }),
  session: z
    .union([z.literal("new"), z.strictObject({ continue: id })])
    .optional()
    .meta({ description: "Start fresh (the default), or continue the session another lane left." }),
});

const Member = z.strictObject({
  id,
  role: id.optional(),
  prompt: Prompt.optional(),
  tier: Tier.optional(),
  effort: Effort.optional(),
  when: Condition.optional().meta({ description: "Only include this member when the condition holds." }),
  advisory: z.boolean().optional().meta({ description: "Reported, but never decides the outcome." }),
});

const Panel = z.strictObject({
  members: z.array(Member).min(2),
  join: z
    .enum(["all", "any"])
    .meta({ description: "Pass when all deciding members pass, or when any does." }),
});

const Output = z.strictObject({
  type: z.enum(["string", "number", "boolean", "array", "object"]),
  enum: z.array(z.string()).min(1).optional(),
  required: z.boolean().optional(),
  description: z.string().optional(),
});

const LaneLimits = z.strictObject({
  minutes: z.number().int().positive().optional(),
  tokens: z.number().int().positive().optional(),
  usd: z.number().positive().optional(),
  turns: z.number().int().positive().optional(),
  repairRounds: z.number().int().min(0).max(5).optional().meta({
    description: "How many times a failed `repair` gate may send its output back to the same session.",
  }),
});

export const Lane = z.strictObject({
  id,
  name: z.string().optional(),
  description: z.string().optional(),
  uses,
  agent: Agent.optional(),
  panel: Panel.optional(),
  with: z.record(z.string(), z.unknown()).optional().meta({ description: "Settings for this lane type." }),
  inputs: z.record(z.string(), ref).optional(),
  outputs: z.record(z.string(), Output).optional(),
  gates: z
    .array(id)
    .optional()
    .meta({ description: "Gate ids from `gates`, run by the host in this order." }),
  checkpoint: z.enum(["in", "near", "out"]).meta({
    description: "in: wait for a person. near: tell a person and go on. out: no notice, audited later.",
  }),
  oneWay: z.boolean().optional().meta({ description: "This lane does something that cannot be undone." }),
  pin: z
    .boolean()
    .optional()
    .meta({ description: "The autonomy ladder never changes this lane's checkpoint." }),
  limits: LaneLimits.optional(),
  retry: z
    .strictObject({ max: z.number().int().min(0).max(3) })
    .optional()
    .meta({
      description: "Restarts after a crash. A retry is not a round.",
    }),
  on: z.strictObject({ pass: Transition, fail: Transition, needsPerson: Transition.optional() }).meta({
    description: "Where the task goes for each outcome. needsPerson defaults to @inbox.",
  }),
  meta: z.record(z.string(), z.unknown()).optional(),
});

const Gate = z.strictObject({
  uses,
  with: z.record(z.string(), z.unknown()).optional(),
  onFail: z.enum(["repair", "fail", "stop", "inform"]).meta({
    description:
      "repair: send the output back to the agent. fail: the lane fails. stop: the run stops, nothing is sent back. inform: recorded only.",
  }),
  description: z.string().optional(),
});

const Collector = z.strictObject({
  id,
  uses,
  with: z.record(z.string(), z.unknown()).optional(),
});

const McpServer = z.discriminatedUnion("from", [
  z
    .strictObject({ from: z.literal("profile") })
    .meta({ description: "Already set up in the agent's profile." }),
  z.strictObject({
    from: z.literal("command"),
    command: z.string().min(1),
    args: z.array(z.string()).optional(),
    env: z.array(envName).optional(),
  }),
  z.strictObject({
    from: z.literal("url"),
    url: z.url(),
    headersEnv: z.record(z.string(), envName).optional(),
  }),
]);

const Skill = z.discriminatedUnion("from", [
  z.strictObject({ from: z.literal("profile") }),
  z.strictObject({ from: z.literal("repo"), source: z.string().min(1), skill: z.string().min(1).optional() }),
]);

export const Workflow = z.strictObject({
  $schema: z.literal(SCHEMA_URL).meta({ description: "Lets editors check and complete the file." }),
  version: z.literal(WORKFLOW_VERSION),
  name: id,
  description: z.string().min(1),
  plugins: z
    .record(id, z.string().min(1))
    .optional()
    .meta({ description: "Plugin namespace to semver range." }),
  roles: z
    .record(
      id,
      z.strictObject({
        description: z.string().min(1),
        differentVendorFrom: z.array(id).min(1).optional().meta({
          description: "Bind this role to another vendor than these roles when the machine has one.",
        }),
      }),
    )
    .meta({ description: "Every role a lane names. A workflow never names an account." }),
  mcp: z.record(id, McpServer).optional(),
  skills: z.record(z.string().min(1), Skill).optional(),
  limits: z
    .strictObject({
      minutes: z.number().int().positive(),
      tokens: z.number().int().positive(),
      usd: z.number().positive().optional(),
    })
    .meta({ description: "Budget for one run. A lane can only lower it." }),
  collectors: z.array(Collector).min(1),
  gates: z.record(id, Gate).optional(),
  lanes: z.array(Lane).min(1).meta({ description: "In order. The first lane is where a run starts." }),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export type Workflow = z.infer<typeof Workflow>;
export type Lane = z.infer<typeof Lane>;
export type Condition = z.infer<typeof Condition>;
export type Transition = z.infer<typeof Transition>;

/** The JSON Schema editors and other tools read. Shape only: the rules in check.ts are not in it. */
export function workflowJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(Workflow, { target: "draft-7", io: "input" }) as Record<string, unknown>;
  return { $id: SCHEMA_URL, title: "Software Factor.io workflow", ...schema };
}
