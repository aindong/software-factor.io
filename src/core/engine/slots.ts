// A slot is what one moving run may use so that runs side by side do not collide: a block of ports,
// a database name and a browser session name. The slot gives the names and numbers. Creating the
// database or starting a server on the port is the workspace's own setup and commands.
import { basename } from "node:path";
import type { Workspace } from "../workspace.ts";

export const DEFAULT_SLOTS = 2;

export const maxSlots = (ws: Workspace) => ws.config.slots?.max ?? DEFAULT_SLOTS;

export function slotEnv(ws: Workspace, slot: number | null | undefined): Record<string, string> {
  if (!slot) return {};
  const per = ws.config.slots?.portsPerSlot ?? 10;
  const port = (ws.config.slots?.portBase ?? 4100) + (slot - 1) * per;
  const name = basename(ws.root)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return {
    FACTOR_SLOT: String(slot),
    FACTOR_PORT: String(port),
    FACTOR_PORT_COUNT: String(per),
    FACTOR_DB_NAME: `${name || "workspace"}_factor_${slot}`,
    FACTOR_BROWSER_SESSION: `factor-${slot}`,
  };
}
