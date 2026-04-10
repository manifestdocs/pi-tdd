import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const PROMPT_NAMES = [
  "guidelines-green",
  "guidelines-red",
  "guidelines-refactor",
  "guidelines-security",
  "guidelines-spec",
  "guidelines-universal",
  "postflight-system",
  "preflight-system",
  "tool-disengage-guidelines",
  "tool-disengage-snippet",
  "tool-engage-guidelines",
  "tool-engage-snippet",
  "tool-postflight-guidelines",
  "tool-postflight-snippet",
  "tool-preflight-guidelines",
  "tool-preflight-snippet",
] as const;

export type PromptName = typeof PROMPT_NAMES[number];

/**
 * Loads static prompt text from the project-root `prompts/` directory.
 *
 * Prompts are stored as `.md` files so they can be edited as real markdown
 * without escape hazards or awkward diffs. They are read synchronously at
 * module-init time (matching the `readFileSync` pattern used in config.ts).
 * Prompt lists are expected to be markdown lists: headings and blank lines are
 * ignored, wrapped lines are folded into the active item, and stray prose is
 * rejected so formatting mistakes fail loudly.
 *
 * The path resolves correctly from both runtime entry points:
 *   - src/prompt-loader.ts  (pi extension loads TS source directly)
 *   - dist/prompt-loader.js (npm library consumers load compiled output)
 * Both locations are siblings of `prompts/` under the package root, so
 * `../prompts/` works uniformly.
 */
export function resolvePromptsBase(moduleUrl: string | URL = import.meta.url): URL {
  return new URL("../prompts/", moduleUrl);
}

export function resolvePromptUrl(name: PromptName, moduleUrl: string | URL = import.meta.url): URL {
  return new URL(`${name}.md`, resolvePromptsBase(moduleUrl));
}

export function loadPrompt(name: PromptName, moduleUrl: string | URL = import.meta.url): string {
  const url = resolvePromptUrl(name, moduleUrl);
  const path = fileURLToPath(url);

  try {
    return readFileSync(path, "utf8").trimEnd();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load prompt "${name}" from ${path}: ${detail}`);
  }
}

export function loadPromptList(name: PromptName, moduleUrl: string | URL = import.meta.url): string[] {
  const lines = loadPrompt(name, moduleUrl).split("\n");
  const items: string[] = [];
  let current: string | null = null;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || isMarkdownHeading(trimmed)) {
      continue;
    }

    const listItem = extractMarkdownListItem(trimmed);
    if (listItem !== null) {
      if (current) {
        items.push(current);
      }
      current = listItem;
      continue;
    }

    if (current) {
      current = `${current} ${trimmed}`;
      continue;
    }

    throw new Error(
      `Prompt list "${name}" must contain markdown list items. Unexpected content: "${trimmed}"`
    );
  }

  if (current) {
    items.push(current);
  }
  if (items.length === 0) {
    throw new Error(`Prompt list "${name}" did not contain any markdown list items.`);
  }

  return items;
}

function isMarkdownHeading(line: string): boolean {
  return /^#{1,6}\s+/.test(line);
}

function extractMarkdownListItem(line: string): string | null {
  const bullet = line.match(/^[-*+]\s+(.*)$/);
  if (bullet) {
    return bullet[1];
  }

  const numbered = line.match(/^\d+\.\s+(.*)$/);
  return numbered ? numbered[1] : null;
}
