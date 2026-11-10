// This runs before anything that builds a schema. The checker's schema library tries to compile
// code at run time when a schema is made. The page's content policy forbids that, and the plain
// path is fast enough for a workflow file.
import { z } from "zod";

z.config({ jitless: true });
