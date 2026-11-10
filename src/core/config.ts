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
  gateEnv: z.array(envName).optional().meta({
    description:
      "Names of environment variables that gates and command lanes may see, beyond the basic ones.",
  }),
});
export type FactoryConfig = z.infer<typeof FactoryConfig>;

/** One step of the scripted agent used in tests, demos and evals. */
export const FakeAction = z.union([
  z.strictObject({ write: z.strictObject({ path: z.string().min(1), content: z.string() }) }),
  z.strictObject({ delete: z.string().min(1) }),
  z.strictObject({ commit: z.string().min(1) }),
  z.strictObject({ handoff: z.record(z.string(), z.unknown()) }),
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

export const RoleBinding = z.strictObject({
  adapter: z.enum(["fake"]),
  script: z
    .record(z.string(), z.union([z.array(FakeAction), z.array(z.array(FakeAction))]))
    .optional()
    .meta({
      description:
        'For the fake adapter: what to do in each lane, by lane id, with "*" for any lane. A list of lists gives one list per time the lane is entered, the last one repeating.',
    }),
});
export type RoleBinding = z.infer<typeof RoleBinding>;

export const LocalConfig = z.strictObject({
  roles: z.record(id, RoleBinding),
});
export type LocalConfig = z.infer<typeof LocalConfig>;
