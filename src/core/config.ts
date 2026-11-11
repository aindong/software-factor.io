// The two files a workspace keeps beside its workflows. `factory.json` is committed: what this
// project's commands are. `local.json` is not: which agent each role is on this machine.
import { z } from "zod";
import { commandName } from "./schema/builtins.ts";

const id = z.string().regex(/^[a-z][a-z0-9-]*$/);
const envName = z.string().regex(/^[A-Z_][A-Z0-9_]*$/);

export const FactoryConfig = z.strictObject({
  version: z.literal(1),
  workflow: id.meta({ description: "The workflow in .factor/workflows/ that runs by default." }),
  commands: z.record(commandName, z.string().min(1)).meta({
    description: "What each command a workflow names means in this project, as a shell command.",
  }),
  protectedPaths: z.array(z.string().min(1)).optional().meta({
    description: "Paths no agent may change in this project, added to the built-in list. Globs are allowed.",
  }),
  slots: z
    .strictObject({
      max: z.number().int().min(1).max(16).optional(),
      portBase: z.number().int().min(1024).max(60000).optional(),
      portsPerSlot: z.number().int().min(1).max(100).optional(),
    })
    .optional()
    .meta({
      description:
        "How many runs may work at once (default 2), and the block of ports each slot gets (default 10 ports from 4100).",
    }),
  ladder: z.strictObject({ runs: z.number().int().positive() }).optional().meta({
    description: "How many clean runs in a row a lane needs before a step up is suggested (10 unless set).",
  }),
  gateEnv: z.array(envName).optional().meta({
    description:
      "Names of environment variables that gates and command lanes may see, beyond the basic ones.",
  }),
});
export type FactoryConfig = z.infer<typeof FactoryConfig>;

/** One step of the scripted agent used in tests, demos and evals. */
export const FakeAction = z.union([
  z.strictObject({
    write: z.strictObject({
      path: z.string().min(1),
      content: z.string(),
      executable: z.boolean().optional(),
    }),
  }),
  z.strictObject({ delete: z.string().min(1) }),
  z.strictObject({ commit: z.string().min(1) }),
  z.strictObject({ handoff: z.record(z.string(), z.unknown()) }),
  z
    .strictObject({
      attach: z.strictObject({
        name: z.string().min(1),
        content: z.string(),
        base64: z.boolean().optional(),
      }),
    })
    .meta({
      description:
        "Leave a file in the evidence folder, for a claim to point at. With base64, the content is the file's bytes in base64: a screenshot or a recording.",
    }),
  z.strictObject({ exit: z.number().int() }),
  z
    .strictObject({ sleep: z.number().int().positive() })
    .meta({ description: "Milliseconds of pretend work." }),
  z.strictObject({
    usage: z.strictObject({
      tokens: z.number().int().nonnegative(),
      usd: z.number().nonnegative().optional(),
    }),
  }),
]);
export type FakeAction = z.infer<typeof FakeAction>;

const FakeBinding = z.strictObject({
  adapter: z.enum(["fake"]),
  script: z
    .record(z.string(), z.union([z.array(FakeAction), z.array(z.array(FakeAction))]))
    .optional()
    .meta({
      description:
        'For the fake adapter: what to do in each lane, by lane id, with "*" for any lane. A list of lists gives one list per time the lane is entered, the last one repeating.',
    }),
});
export type FakeBinding = z.infer<typeof FakeBinding>;

const AccountBinding = z.strictObject({
  account: id.meta({ description: "An account on this machine: see `softwarefactor account list`." }),
  models: z
    .strictObject({ small: z.string().min(1), medium: z.string().min(1), large: z.string().min(1) })
    .partial()
    .optional()
    .meta({
      description: "The model for each tier a lane can ask for. A tier left out uses the CLI's default.",
    }),
  effort: z.enum(["low", "medium", "high", "max"]).optional().meta({
    description: "The effort for lanes that name none.",
  }),
});
export type AccountBinding = z.infer<typeof AccountBinding>;

export const RoleBinding = z.union([FakeBinding, AccountBinding]);
export type RoleBinding = z.infer<typeof RoleBinding>;

export const LocalConfig = z.strictObject({
  roles: z.record(id, RoleBinding),
  // the workflow this machine uses in place of the one factory.json names: a variant of your own, not shared
  workflow: id.optional(),
  // MCP servers a collector may start here, each by the print of what it runs (`softwarefactor allow`)
  servers: z.record(id, z.string()).optional(),
  // plugins installed and said yes to here, each by the hash of its files (`softwarefactor add`)
  plugins: z.record(id, z.string()).optional(),
  // skills from a repository that a run may install here, each by the print of its source (`softwarefactor allow --skill`)
  skills: z.record(z.string(), z.string()).optional(),
});
export type LocalConfig = z.infer<typeof LocalConfig>;
