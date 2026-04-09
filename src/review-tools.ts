import { Type } from "@mariozechner/pi-ai";
import type {
  ExtensionContext,
  ToolDefinition,
} from "@mariozechner/pi-coding-agent";
import type { EngagementDeps } from "./engagement.js";
import { formatPreflightResult, runPreflight, type PreflightResult } from "./preflight.js";
import { formatPostflightResult, runPostflight, type PostflightResult } from "./postflight.js";

export const PREFLIGHT_TOOL_NAME = "tdd_preflight";
export const POSTFLIGHT_TOOL_NAME = "tdd_postflight";

interface PreflightParams {
  userStory?: string;
}

interface PostflightParams {
  userStory?: string;
}

export function createPreflightTool(
  deps: EngagementDeps
): ToolDefinition<ReturnType<typeof Type.Object>, PreflightResult, PreflightParams> {
  return {
    name: PREFLIGHT_TOOL_NAME,
    label: "TDD Pre-flight",
    description:
      "Run the TDD pre-flight check (priming the cycle). Validates the spec checklist is solid enough to drive a clean RED → GREEN → REFACTOR cycle BEFORE any tests or implementation are written. Call this when leaving SPEC for RED if you want to verify the spec is testable, atomic, and covers the user story.",
    promptSnippet: "Inspect the pre-flight verdict on the current spec.",
    promptGuidelines: [
      "Pre-flight runs AUTOMATICALLY when transitioning into RED via tdd_engage(phase: 'RED') or /tdd red. You normally do NOT need to call this tool yourself.",
      "Call tdd_preflight directly only when you want to inspect the spec checklist mid-flow without attempting a phase transition (for example, after editing the spec to verify it's now solid).",
      "If pre-flight returns issues, refine the spec checklist (via /tdd spec-set or by editing the items) before retrying RED.",
    ],
    parameters: Type.Object({
      userStory: Type.Optional(
        Type.String({
          description: "Optional user story or original request text. Provides context for whether the spec covers what was asked for.",
        })
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext) {
      const config = deps.getConfig();
      const machine = deps.machine;

      const result = await runPreflight(
        {
          spec: machine.plan,
          userStory: params.userStory,
        },
        ctx,
        config
      );

      const summary = formatPreflightResult(result);
      if (ctx.hasUI) {
        ctx.ui.notify(
          result.ok ? "TDD pre-flight: OK" : `TDD pre-flight: ${result.issues.length} issue(s)`,
          result.ok ? "info" : "warning"
        );
      }

      return {
        content: [{ type: "text", text: summary }],
        details: result,
      };
    },
  };
}

export function createPostflightTool(
  deps: EngagementDeps
): ToolDefinition<ReturnType<typeof Type.Object>, PostflightResult, PostflightParams> {
  return {
    name: POSTFLIGHT_TOOL_NAME,
    label: "TDD Post-flight",
    description:
      "Run the TDD post-flight review (proving the cycle). Validates that the completed TDD cycle delivered what the spec asked for: every spec item has a passing test, the implementation matches the behavior the spec describes, and there are no obvious gaps or feature creep. Call this when tests are green and you believe the cycle is complete.",
    promptSnippet: "Inspect the post-flight verdict on the current cycle.",
    promptGuidelines: [
      "Post-flight runs AUTOMATICALLY when you call tdd_disengage on a feature with passing tests and a spec checklist. You normally do NOT need to call this tool yourself — just disengage when the feature is done.",
      "Call tdd_postflight directly only when you want a mid-feature checkpoint (for example, after one TDD cycle, before starting the next) to verify the work so far.",
      "If post-flight surfaces gaps, decide whether to run another RED → GREEN cycle to address them or to accept the work and disengage.",
      "Do NOT call tdd_postflight while tests are failing or mid-cycle — it only checks completed work.",
    ],
    parameters: Type.Object({
      userStory: Type.Optional(
        Type.String({
          description: "Optional user story or original request text. Provides context for whether the implementation matches what was asked for.",
        })
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext) {
      const config = deps.getConfig();
      const machine = deps.machine;

      const result = await runPostflight(
        {
          state: machine.getSnapshot(),
          userStory: params.userStory,
        },
        ctx,
        config
      );

      const summary = formatPostflightResult(result);
      if (ctx.hasUI) {
        ctx.ui.notify(
          result.ok ? "TDD post-flight: OK" : `TDD post-flight: ${result.gaps.length} gap(s)`,
          result.ok ? "info" : "warning"
        );
      }

      return {
        content: [{ type: "text", text: summary }],
        details: result,
      };
    },
  };
}
