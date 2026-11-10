import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The interface is built into dist/ui, which the command serves. Nothing is loaded from a network.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react()],
  build: { outDir: fileURLToPath(new URL("../../dist/ui", import.meta.url)), emptyOutDir: true },
});
