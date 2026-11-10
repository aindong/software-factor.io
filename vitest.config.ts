import { defineConfig } from "vitest/config";

// Most acceptance tests start the command several times, each a new process. Under a full run on
// a busy machine that passes the default of five seconds.
export default defineConfig({ test: { testTimeout: 20_000, setupFiles: ["test/helpers/clean-env.ts"] } });
