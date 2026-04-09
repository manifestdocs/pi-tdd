import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { TDDConfig } from "./types.js";
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

const SYSTEM_PROMPT = `You are a TDD pre-flight reviewer. Your role is to check that a spec checklist is solid enough to drive a clean RED → GREEN → REFACTOR cycle BEFORE any code is written.

A good spec item is:
- Observable: the behavior can be witnessed by a test (input → output, side effect, error)
- Testable: a failing test can be written for it before any implementation
- Atomic: it asserts one thing, not several
- Tied to user-visible behavior, not implementation details

Reject items that are vague, untestable, mix multiple concerns, describe implementation rather than behavior, or duplicate other items. Reject the whole spec if it leaves obvious gaps in the user story.

Respond with JSON only.`;

function buildUserPrompt(input: PreflightInput): string {
  const lines: string[] = [];
  if (input.userStory && input.userStory.trim().length > 0) {
    lines.push("User story / request:");
    lines.push(input.userStory.trim());
    lines.push("");
  }

  lines.push("Spec checklist (one item per line):");
  if (input.spec.length === 0) {
    lines.push("(empty)");
  } else {
    input.spec.forEach((item, idx) => {
      lines.push(`${idx + 1}. ${item}`);
    });
  }

  lines.push("");
  lines.push("Decide whether this spec is ready to start a TDD cycle.");
  lines.push("");
  lines.push("Respond with one of:");
  lines.push(`{"ok": true, "reason": "short explanation of why it's ready"}`);
  lines.push(`{"ok": false, "reason": "short overall explanation", "issues": [{"itemIndex": 1, "message": "..."}, {"itemIndex": null, "message": "general gap"}]}`);
  lines.push("");
  lines.push("itemIndex is the 1-based position of the spec item, or null for issues that span the whole spec.");

  return lines.join("\n");
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
      userPrompt: buildUserPrompt(input),
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
  const ok = Boolean(obj.ok);
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
