// Writes the published JSON Schema from the Zod source. Run after any change to src/core/schema/workflow.ts.
import { writeFileSync } from "node:fs";
import { workflowJsonSchema } from "../src/core/schema/workflow.ts";

const path = "schema/workflow.v1.json";
writeFileSync(path, `${JSON.stringify(workflowJsonSchema(), null, 2)}\n`);
console.log(`wrote ${path}`);
