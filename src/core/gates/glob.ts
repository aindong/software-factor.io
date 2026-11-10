// A small path matcher for protected paths and test files. A pattern ending in "/" is a folder at
// the top of the repository. "*" stays inside one folder, "**" crosses folders.
const cache = new Map<string, RegExp>();

function compile(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, "\uE000")
    .replace(/\*\*/g, "\uE001")
    .replace(/\*/g, "[^/]*")
    .replace(/\uE000/g, "(?:.*/)?")
    .replace(/\uE001/g, ".*");
  return new RegExp(`^${escaped}$`);
}

export function matches(pattern: string, path: string): boolean {
  if (pattern.endsWith("/")) return path.startsWith(pattern);
  let re = cache.get(pattern);
  if (!re) {
    re = compile(pattern);
    cache.set(pattern, re);
  }
  return re.test(path);
}

export const matchesAny = (patterns: string[], path: string) => patterns.some((p) => matches(p, path));
