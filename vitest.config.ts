import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Most acceptance tests start the command several times, each a new process. Under a full run on
// a busy machine that passes the default of five seconds.
// The React plugin is for the interface's own tests, which render components to markup.
export default defineConfig({
  plugins: [react()],
  test: {
    testTimeout: 20_000,
    setupFiles: ["test/helpers/clean-env.ts"],
    // a working copy an agent session keeps inside the repository has its own tests: they are not this checkout's
    exclude: ["**/node_modules/**", "**/dist/**", ".claude/**"],
  },
});
