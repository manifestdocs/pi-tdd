/**
 * Heuristics for detecting shell commands that write to production files.
 * Used to warn (not block) when agents bypass the SPECIFYING gate via bash.
 */

const SHELL_WRITE_RE = /\bcat\s.*>|>\s*\S|<<\s*['"]?\w|\btee\b|\bsed\s+-i|\bprintf\s.*>|\bdd\b.*\bof=/;

export function detectsShellWritePattern(command: string): boolean {
  return SHELL_WRITE_RE.test(command);
}

const REDIRECT_RE = /(?<!\d)>>?\s*(\S+)/g;
const TEE_RE = /\btee\s+(?:-[a-z]\s+)*(\S+)/;

export function extractRedirectTargets(command: string): string[] {
  const targets: string[] = [];

  for (const m of command.matchAll(REDIRECT_RE)) {
    const target = m[1];
    if (target && !target.startsWith("/dev/")) targets.push(target);
  }

  const teeMatch = command.match(TEE_RE);
  if (teeMatch?.[1] && !teeMatch[1].startsWith("-")) {
    targets.push(teeMatch[1]);
  }

  return targets;
}
