// The text patterns the guard looks for. Each is a spelling seen in the wild, with a test. None is
// complete: see the note at the top of guard.ts.

/** Before a path in a shell command: its start, a space, a quote, or a sign that takes a path. */
const BEFORE = "(^|[\\s\"'=<>(/])";
/** After a path word. */
const AFTER = "(?=$|[\\s\"';|&<>)])";

// Files that hold logins and keys. An example file (.env.example) is not one.
export const SECRET_FILE = new RegExp(
  [
    "(^|/)(\\.env(\\.(?!(example|sample|template)$)[^/]*)?|\\.netrc|\\.npmrc|\\.pypirc|\\.git-credentials)$",
    "(^|/)(id_(rsa|dsa|ecdsa|ed25519)[^/]*|[^/]*\\.(pem|key|p12|pfx)|\\.credentials\\.json)$",
    "(^|/)(\\.ssh|\\.aws|\\.gnupg|\\.azure|\\.config/(gh|gcloud))(/|$)",
    "\\.codex/auth\\.json$|\\.kimi-code/credentials(/|$)|\\.docker/config\\.json$|\\.kube/config$",
  ].join("|"),
);

/** A file pattern that would match secret files, such as ".env*". */
export const SECRET_GLOB =
  /\.env(?!\.(example|sample|template)\b)|id_(rsa|dsa|ecdsa|ed25519)|\.(pem|key|p12|pfx)\b|\.ssh|\.aws|credentials/;

export const SECRET_IN_SHELL = [
  new RegExp(`${BEFORE}\\.env(\\.(?!(example|sample|template)\\b)[\\w.-]+)?${AFTER}`),
  /\.ssh\/|\.aws\/|\.gnupg\/|\.azure\/|\.config\/(gh|gcloud)|\.codex\/auth\.json|\.credentials\.json/,
  /\.netrc\b|\.git-credentials|\.kimi-code\/credentials|\.docker\/config\.json|\.kube\/config/,
  /\bsecurity\s+(find-(generic|internet)-password|dump-keychain|export)\b/,
  /\bgit\s+credential/,
];

/** What git, the factory or an agent CLI owns, named in a shell command. */
export const OWNED_IN_SHELL = [
  new RegExp(`${BEFORE}\\.git(/|${AFTER})`), // .git itself or anything in it, not .gitignore or .github
  /--git-common-dir|--git-dir|--absolute-git-dir/,
  // a CLI's folder or config file, also with a suffix: .claude.json, .claude-work/
  new RegExp(
    `${BEFORE}(\\.claude|\\.codex|\\.kimi-code|\\.agents)[\\w.-]*(/|${AFTER})|\\.mcp\\.json\\b|\\.claude\\.json`,
  ),
  /\b(CLAUDE_CONFIG_DIR|CODEX_HOME|KIMI_CODE_HOME)\b/, // the CLI's profile folder, by its variable
];

export const PIPE_TO_SHELL = /\b(curl|wget)\b[^;&\n]*\|\s*(sudo\s+)?(env\s+)?(ba|z|da|k)?sh\b/;
export const DOWNLOAD_AS_COMMAND = /(\$\(|`|<\()\s*(curl|wget)\b/;

// Folders and files an agent CLI reads its own settings, hooks, servers and skills from, at any depth.
const CLI_OWNED = new Set([".claude", ".codex", ".kimi-code", ".agents", ".mcp.json"]);
export const isCliOwned = (part: string) => CLI_OWNED.has(part) || part.startsWith(".claude.json");
