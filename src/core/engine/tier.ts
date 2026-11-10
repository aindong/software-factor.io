// How risky a change is, from the files it touches. The most sensitive file decides. Workflows use
// it as `change.tier` to size a review and to add lanes such as a browser check.
import type { CHANGE_TIERS } from "../schema/workflow.ts";

export type Tier = (typeof CHANGE_TIERS)[number];

const SENSITIVE =
  /(auth|login|token|secret|password|credential|payment|billing|webhook|permission|crypto|session)/i;
const UI = /\.(tsx|jsx|vue|svelte|css|scss|sass|less|html)$|(^|\/)(components?|ui|pages?|views?|styles?)\//i;
const API = /(^|\/)(routes?|handlers?|controllers?|api|schemas?|migrations?)\/|\.(sql|proto|graphql)$/i;
const DOCS = /\.(md|mdx|txt|rst|adoc)$|(^|\/)docs?\/|(^|\/)LICENSE/i;

export function tierOf(files: string[]): Tier {
  if (files.some((f) => SENSITIVE.test(f))) return "sensitive";
  if (files.some((f) => UI.test(f))) return "ui";
  if (files.some((f) => API.test(f))) return "api";
  if (files.every((f) => DOCS.test(f))) return "docs";
  return "refactor";
}
