import type { GuidelinesConfig, TDDPhase } from "./types.js";
import { loadPrompt } from "./prompt-loader.js";

// ---------------------------------------------------------------------------
// Default guidelines — the built-in way of working, overridable via config.
// Prose lives in prompts/guidelines-*.md so it can be edited as markdown.
// ---------------------------------------------------------------------------

export const DEFAULTS: Readonly<GuidelinesConfig> = {
  spec: loadPrompt("guidelines-spec"),
  red: loadPrompt("guidelines-red"),
  green: loadPrompt("guidelines-green"),
  refactor: loadPrompt("guidelines-refactor"),
  universal: loadPrompt("guidelines-universal"),
  security: null,
};

// ---------------------------------------------------------------------------
// Resolve config — merge user overrides with defaults
// ---------------------------------------------------------------------------

export function resolveGuidelines(
  user: (Partial<GuidelinesConfig> & { plan?: string | null }) | undefined
): GuidelinesConfig {
  if (!user) return { ...DEFAULTS };
  const spec =
    user.spec !== undefined
      ? user.spec
      : user.plan !== undefined
        ? user.plan
        : DEFAULTS.spec;
  return {
    spec,
    red: user.red === undefined ? DEFAULTS.red : user.red,
    green: user.green === undefined ? DEFAULTS.green : user.green,
    refactor: user.refactor === undefined ? DEFAULTS.refactor : user.refactor,
    universal: user.universal === undefined ? DEFAULTS.universal : user.universal,
    security: user.security === undefined ? DEFAULTS.security : user.security,
  };
}

// ---------------------------------------------------------------------------
// Select guidelines for the current phase
// ---------------------------------------------------------------------------

export function guidelinesForPhase(
  phase: TDDPhase,
  config: GuidelinesConfig
): string {
  const sections: string[] = [];

  // Phase-specific
  const phaseKey = phase.toLowerCase() as keyof GuidelinesConfig;
  const phaseBlock = config[phaseKey];
  if (phaseBlock) sections.push(phaseBlock);

  // Universal (always)
  if (config.universal) sections.push(config.universal);

  // Security (always)
  if (config.security) sections.push(config.security);

  return sections.join("\n\n");
}
