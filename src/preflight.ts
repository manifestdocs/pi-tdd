import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { TDDConfig, TDDPhase } from "./types.js";
import { loadPrompt } from "./prompt-loader.js";
import { extractJSON, runReview } from "./reviews.js";

/**
 * Preflight (priming the cycle) — runs before transitioning out of SPEC into
 * RED. Validates that the spec checklist is good enough to drive a clean
 * RED → GREEN → REFACTOR loop. Surfaces ambiguity, gaps, and items that
 * cannot be expressed as a failing test.
 */

export interface PreflightInput {
  /** The spec checklist items the user/agent has accumulated in SPEC. */
  spec: string[];
  /** Optional user story / request text for context. */
  userStory?: string;
}

export interface PreflightIssue {
  /** 1-based index of the spec item the issue applies to, or null for general issues. */
  itemIndex: number | null;
  /** Short description of the problem. */
  message: string;
}

export type PreflightResult =
  | { ok: true; reason: string }
  | { ok: false; issues: PreflightIssue[]; reason: string };

export function shouldRunPreflightOnRedEntry(
  currentPhase: TDDPhase,
  enabled: boolean,
  targetPhase: TDDPhase,
  config: Pick<TDDConfig, "runPreflightOnRed">
): boolean {
  return config.runPreflightOnRed && targetPhase === "RED" && (!enabled || currentPhase !== "RED");
}

const SYSTEM_PROMPT = loadPrompt("preflight-system");

export function buildPreflightUserPrompt(input: PreflightInput): string {
  return [
    ...userStoryLines(input.userStory),
    ...specChecklistLines(input.spec),
    "",
    "For each spec item, consider whether the best first proof should be a unit test, an integration test, or both.",
    "Boundary-heavy behavior should usually be provable with integration-level tests, not only isolated mocks.",
    "",
    "Decide whether this spec is ready to start a TDD cycle.",
    "",
    ...preflightResponseLines(),
  ].join("\n");
}

export async function runPreflight(
  input: PreflightInput,
  ctx: ExtensionContext,
  config: TDDConfig
): Promise<PreflightResult> {
  if (input.spec.length === 0) {
    return {
      ok: false,
      reason: "Spec checklist is empty. Add at least one acceptance criterion before starting RED.",
      issues: [
        { itemIndex: null, message: "No spec items to drive the cycle." },
      ],
    };
  }

  const raw = await runReview(
    {
      label: "preflight",
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: buildPreflightUserPrompt(input),
    },
    ctx,
    config
  );

  return parsePreflightResponse(raw.text);
}

export function parsePreflightResponse(raw: string): PreflightResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJSON(raw));
  } catch (error) {
    throw new Error(`Preflight response was not valid JSON: ${String(error)}`);
  }

  if (typeof parsed !== "object" || parsed === null || !("ok" in parsed)) {
    throw new Error("Preflight response did not contain an `ok` field");
  }

  const obj = parsed as Record<string, unknown>;
  if (typeof obj.ok !== "boolean") {
    throw new Error("Preflight response `ok` field must be boolean");
  }

  const ok = obj.ok;
  const reason = typeof obj.reason === "string" ? obj.reason : "";

  if (ok) {
    return { ok: true, reason };
  }

  const rawIssues = Array.isArray(obj.issues) ? obj.issues : [];
  const issues: PreflightIssue[] = rawIssues
    .map((issue): PreflightIssue | null => {
      if (typeof issue !== "object" || issue === null) return null;
      const i = issue as Record<string, unknown>;
      const itemIndex =
        typeof i.itemIndex === "number"
          ? i.itemIndex
          : i.itemIndex === null
            ? null
            : null;
      const message = typeof i.message === "string" ? i.message : "";
      if (!message) return null;
      return { itemIndex, message };
    })
    .filter((issue): issue is PreflightIssue => issue !== null);

  return { ok: false, reason, issues };
}

export function formatPreflightResult(result: PreflightResult): string {
  if (result.ok) {
    return `Pre-flight OK — ${result.reason}`;
  }

  const lines = [`Pre-flight found ${result.issues.length} issue(s): ${result.reason}`];
  for (const issue of result.issues) {
    const prefix = issue.itemIndex === null ? "  •" : `  ${issue.itemIndex}.`;
    lines.push(`${prefix} ${issue.message}`);
  }
  return lines.join("\n");
}

function userStoryLines(userStory: string | undefined): string[] {
  if (!userStory?.trim()) {
    return [];
  }

  return ["User story / request:", userStory.trim(), ""];
}

function specChecklistLines(spec: string[]): string[] {
  const items = spec.length === 0
    ? ["(empty)"]
    : spec.map((item, index) => `${index + 1}. ${item}`);

  return ["Spec checklist (one item per line):", ...items];
}

function preflightResponseLines(): string[] {
  return [
    "Respond with one of:",
    `{"ok": true, "reason": "short explanation of why it's ready"}`,
    `{"ok": false, "reason": "short overall explanation", "issues": [{"itemIndex": 1, "message": "..."}, {"itemIndex": null, "message": "general gap"}]}`,
    "",
    "itemIndex is the 1-based position of the spec item, or null for issues that span the whole spec.",
  ];
}
