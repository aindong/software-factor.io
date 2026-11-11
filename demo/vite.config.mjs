import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const react = createRequire(import.meta.url)("./.stageshow/node_modules/@vitejs/plugin-react").default;
const here = dirname(fileURLToPath(import.meta.url));
const mod = (name) => join(here, ".stageshow", "node_modules", name);
// the kit brings React 18; the product's own React 19 must not be a second copy on the page
export default {
  root: here,
  plugins: [react()],
  resolve: {
    alias: { react: mod("react"), "react-dom": mod("react-dom"), "lucide-react": mod("lucide-react") },
    dedupe: ["react", "react-dom"],
  },
  server: { host: "127.0.0.1", fs: { allow: [join(here, "..")] } },
  build: { target: "es2022" },
};
