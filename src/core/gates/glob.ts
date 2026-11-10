// A small path matcher for protected paths and test files. "*" stays inside one folder, "**"
// crosses folders, and a pattern ending in "/" means everything under that folder. Letter case is
// ignored: on macOS and Windows ".Claude/" is the same folder as ".claude/".
const cache = new Map<string, RegExp>();

function compile(pattern: string): RegExp {
  let p = pattern.replace(/^\.?\//, "");
  if (p.endsWith("/")) p = `${p}**`;
  const escaped = p
    .replace(/[.+^${}()|[\]\\?]/g, "\\$&")
    .replace(/\*\*\//g, "")
    .replace(/\*\*/g, "")
    .replace(/\*/g, "[^/]*")
    .replace(//g, "(?:.*/)?")
    .replace(//g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

export function matches(pattern: string, path: string): boolean {
  let re = cache.get(pattern);
  if (!re) {
    re = compile(pattern);
    cache.set(pattern, re);
  }
  return re.test(path);
}

export const matchesAny = (patterns: string[], path: string) => patterns.some((p) => matches(p, path));
