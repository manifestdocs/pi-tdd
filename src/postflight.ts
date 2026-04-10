import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { PhaseState, TDDConfig } from "./types.js";
import { loadPrompt } from "./prompt-loader.js";
import { extractJSON, runReview } from "./reviews.js";

/**
 * Postflight (proving the cycle) — runs after the TDD cycle is complete with
 * passing tests. Validates that the work delivered against the spec: every
 * acceptance criterion has a corresponding test, every test passes, the
 * implementation actually solves what the spec asked for, and the change fits
 * the surrounding project unless the user request or spec justifies something
 * new.
 *
 * Auto-triggered on every disengage path (tdd_disengage tool, /tdd disengage
 * command, and disengageOnTools lifecycle hooks) when there is real evidence
 * to review — see maybeRunPostflightOnDisengage in engagement.ts. Can also be
 * invoked explicitly via the tdd_postflight tool or /tdd postflight command
 * for mid-flow checkpoints.
 */

export interface PostflightInput {
  state: PhaseState;
  /** Optional user story / request text for context. */
  userStory?: string;
}

export interface PostflightGap {
  /** 1-based index of the spec item the gap applies to, or null for general gaps. */
  itemIndex: number | null;
  /** Short description of the gap. */
  message: string;
}

export type PostflightResult =
  | { ok: true; reason: string }
  | { ok: false; gaps: PostflightGap[]; reason: string };

const SYSTEM_PROMPT = loadPrompt("postflight-system");

export function buildPostflightUserPrompt(input: PostflightInput): string {
  const { state, userStory } = input;
  const lines: string[] = [];

  if (userStory && userStory.trim().length > 0) {
    lines.push("User story / request:");
    lines.push(userStory.trim());
    lines.push("");
  }

  lines.push("Spec checklist:");
  if (state.plan.length === 0) {
    lines.push("(no spec checklist was set)");
  } else {
    state.plan.forEach((item, idx) => {
      const marker = idx < state.planCompleted ? "[x]" : "[ ]";
      lines.push(`${marker} ${idx + 1}. ${item}`);
    });
  }
  lines.push("");

  lines.push(`Cycle count: ${state.cycleCount}`);
  if (state.lastTestFailed !== null) {
    lines.push(`Last test result: ${state.lastTestFailed ? "FAILED" : "PASSED"}`);
  }
  if (state.lastTestOutput) {
    lines.push("Last test output (truncated):");
    lines.push(truncateFromEnd(state.lastTestOutput, 1500));
  }
  lines.push("");

  lines.push("Recent test runs captured in this cycle:");
  if (state.recentTests.length === 0) {
    lines.push("(no test runs were captured in this cycle)");
  } else {
    state.recentTests.forEach((test, index) => {
      lines.push(
        `${index + 1}. ${test.failed ? "FAIL" : "PASS"} | ${formatProofLevel(test.level)} | ${test.command}`
      );
    });
  }
  lines.push("");
  lines.push("Use this history to decide whether the completed work was proven at the right level.");
  lines.push("Unit tests are appropriate for isolated logic; integration tests matter when the behavior crosses boundaries, contracts, or wiring.");
  lines.push("");

  if (state.diffs.length > 0) {
    lines.push("Recent tool calls / mutations made during the cycle:");
    state.diffs.forEach((diff) => lines.push(`  - ${diff}`));
    lines.push("");
  }

  lines.push("Decide whether the cycle delivered what the spec asked for.");
  lines.push("");
  lines.push("Respond with one of:");
  lines.push(`{"ok": true, "reason": "short explanation of what was delivered"}`);
  lines.push(`{"ok": false, "reason": "short overall explanation", "gaps": [{"itemIndex": 1, "message": "..."}, {"itemIndex": null, "message": "general gap"}]}`);

  return lines.join("\n");
}

export async function runPostflight(
  input: PostflightInput,
  ctx: ExtensionContext,
  config: TDDConfig
): Promise<PostflightResult> {
  if (input.state.lastTestFailed === true) {
    return {
      ok: false,
      reason: "Last test run failed. Get the cycle to green before running postflight.",
      gaps: [
        { itemIndex: null, message: "Tests are not currently passing." },
      ],
    };
  }

  const raw = await runReview(
    {
      label: "postflight",
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: buildPostflightUserPrompt(input),
    },
    ctx,
    config
  );

  return parsePostflightResponse(raw.text);
}

export function parsePostflightResponse(raw: string): PostflightResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJSON(raw));
  } catch (error) {
    throw new Error(`Postflight response was not valid JSON: ${String(error)}`);
  }

  if (typeof parsed !== "object" || parsed === null || !("ok" in parsed)) {
    throw new Error("Postflight response did not contain an `ok` field");
  }

  const obj = parsed as Record<string, unknown>;
  if (typeof obj.ok !== "boolean") {
    throw new Error("Postflight response `ok` field must be boolean");
  }

  const ok = obj.ok;
  const reason = typeof obj.reason === "string" ? obj.reason : "";

  if (ok) {
    return { ok: true, reason };
  }

  const rawGaps = Array.isArray(obj.gaps) ? obj.gaps : [];
  const gaps: PostflightGap[] = rawGaps
    .map((gap): PostflightGap | null => {
      if (typeof gap !== "object" || gap === null) return null;
      const g = gap as Record<string, unknown>;
      const itemIndex =
        typeof g.itemIndex === "number"
          ? g.itemIndex
          : g.itemIndex === null
            ? null
            : null;
      const message = typeof g.message === "string" ? g.message : "";
      if (!message) return null;
      return { itemIndex, message };
    })
    .filter((gap): gap is PostflightGap => gap !== null);

  return { ok: false, reason, gaps };
}

export function formatPostflightResult(result: PostflightResult): string {
  if (result.ok) {
    return `Post-flight OK — ${result.reason}`;
  }

  const lines = [`Post-flight found ${result.gaps.length} gap(s): ${result.reason}`];
  for (const gap of result.gaps) {
    const prefix = gap.itemIndex === null ? "  •" : `  ${gap.itemIndex}.`;
    lines.push(`${prefix} ${gap.message}`);
  }
  return lines.join("\n");
}

function truncateFromEnd(value: string, max: number): string {
  return value.length > max ? `...${value.slice(-max)}` : value;
}

function formatProofLevel(level: PhaseState["recentTests"][number]["level"]): string {
  switch (level) {
    case "unit":
      return "UNIT";
    case "integration":
      return "INTEGRATION";
    default:
      return "UNKNOWN";
  }
}
