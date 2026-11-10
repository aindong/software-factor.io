// Reading a file that an agent or a command may have left. The folder is theirs to write, so the
// file may be a link to something else or a pipe that never ends: it is opened without following
// links and without waiting, and only a plain file of a sane size is read.
import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";

const MAX_FILE_BYTES = 1_000_000;

/** A JSON object left at `path`, or nothing when it is missing, not a plain file, too large or not an object. */
export function readObject(path: string): { text: string; value: Record<string, unknown> } | undefined {
  let fd: number | undefined;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return undefined;
    const text = readFileSync(fd, "utf8");
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? { text, value: value as Record<string, unknown> }
      : undefined;
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
