// Text that came from outside: an agent, a CLI, a task.
// biome-ignore lint/suspicious/noControlCharactersInRegex: removing them is the point
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]+/g;
/** Agent text on one line and bounded, for notes, logs and reports: it cannot forge a line of its own. */
export const oneLine = (text: string, max = 500) => {
  const flat = text.replace(UNSAFE, " ").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}...` : flat;
};
