// After an approval whose next lane waits for a person too, the run is back in the inbox a moment later,
// as a new item. Wait for it, so that the keyboard can stay on the run that was just approved.
import type { InboxItem } from "../core/views.ts";
import { op } from "./api.ts";

/** The inbox as it is once the run waits again (not the item that was decided); nothing if it does not within a few seconds. */
export async function listWhenBack(run: string, decided: number): Promise<InboxItem[] | undefined> {
  for (let tries = 0; tries < 15; tries++) {
    const { status, body } = await op<{ items: InboxItem[] }>("inbox_list");
    if (status === 200 && body.items.some((i) => i.run === run && i.id !== decided)) return body.items;
    await new Promise((again) => setTimeout(again, 200));
  }
  return undefined;
}
