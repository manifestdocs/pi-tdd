import { Type } from "@mariozechner/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from "@mariozechner/pi-coding-agent";
import type { PhaseStateMachine } from "./phase.js";
import { persistState } from "./persistence.js";
import { formatPreflightResult, runPreflight } from "./preflight.js";
import { formatPostflightResult, runPostflight, type PostflightResult } from "./postflight.js";
import { POSTFLIGHT_TOOL_NAME, PREFLIGHT_TOOL_NAME } from "./review-tools.js";
import type { TDDConfig, TDDPhase } from "./types.js";

const STATUS_KEY = "tdd-gate";

export const ENGAGE_TOOL_NAME = "tdd_engage";
export const DISENGAGE_TOOL_NAME = "tdd_disengage";

const CONTROL_TOOL_NAMES = new Set([
  ENGAGE_TOOL_NAME,
  DISENGAGE_TOOL_NAME,
  PREFLIGHT_TOOL_NAME,
  POSTFLIGHT_TOOL_NAME,
]);

export interface EngagementDeps {
  pi: ExtensionAPI;
  machine: PhaseStateMachine;
  getConfig: () => TDDConfig;
}

interface EngageParams {
  phase?: string;
  reason: string;
}

interface DisengageParams {
  reason: string;
}

interface EngagementDetails {
  engaged: boolean;
  phase: TDDPhase | null;
  reason: string;
  /** Populated by tdd_disengage when postflight ran. Null otherwise. */
  postflight?: PostflightResult | null;
}

function normalizePhase(value: string | undefined): TDDPhase | null {
  if (!value) return null;
  const normalized = value.trim().toUpperCase();
  if (normalized === "SPEC" || normalized === "RED" || normalized === "GREEN" || normalized === "REFACTOR") {
    return normalized;
  }
  if (normalized === "PLAN") return "SPEC";
  return null;
}

function persistIfEnabled(deps: EngagementDeps): void {
  const config = deps.getConfig();
  if (config.persistPhase) {
    persistState(deps.pi, deps.machine);
  }
}

export interface PostflightOnDisengageOutcome {
  /** Postflight result if it ran, otherwise null. */
  result: PostflightResult | null;
  /** Human-readable summary suitable for surfacing to the agent/user. Null if postflight did not run. */
  summary: string | null;
}

/**
 * Postflight runs on disengage only when there is real evidence the cycle
 * actually delivered something to review: TDD was engaged, a spec was set,
 * AND the most recent test run actually passed (with output captured). A
 * `null` lastTestFailed — meaning no test signal has been observed during
 * this engagement — is NOT eligible: postflight against zero evidence would
 * waste an LLM call and risk false confidence.
 */
function isEligibleForPostflightOnDisengage(machine: PhaseStateMachine): boolean {
  return (
    machine.enabled &&
    machine.plan.length > 0 &&
    machine.lastTestFailed === false &&
    machine.lastTestOutput !== null
  );
}

/**
 * Shared helper for the three disengage paths (tdd_disengage tool, /tdd
 * disengage command, disengageOnTools lifecycle hook). Runs postflight when
 * eligible, emits the appropriate UI notification, and returns both the
 * structured result and a formatted summary string. Errors are caught and
 * surfaced as a summary — postflight failure NEVER blocks disengagement.
 */
export async function maybeRunPostflightOnDisengage(
  machine: PhaseStateMachine,
  ctx: ExtensionContext,
  config: TDDConfig
): Promise<PostflightOnDisengageOutcome> {
  if (!isEligibleForPostflightOnDisengage(machine)) {
    return { result: null, summary: null };
  }

  try {
    const result = await runPostflight({ state: machine.getSnapshot() }, ctx, config);
    const summary = formatPostflightResult(result);
    if (ctx.hasUI) {
      ctx.ui.notify(
        result.ok
          ? "TDD post-flight: OK"
          : `TDD post-flight: ${result.gaps.length} gap(s)`,
        result.ok ? "info" : "warning"
      );
    }
    return { result, summary };
  } catch (error) {
    const errorReason = error instanceof Error ? error.message : String(error);
    if (ctx.hasUI) {
      ctx.ui.notify(`Post-flight failed: ${errorReason}`, "warning");
    }
    return { result: null, summary: `Post-flight failed to run: ${errorReason}` };
  }
}

export function createEngageTool(
  deps: EngagementDeps
): ToolDefinition<ReturnType<typeof Type.Object>, EngagementDetails, EngageParams> {
  return {
    name: ENGAGE_TOOL_NAME,
    label: "Engage TDD",
    description:
      "Engage the TDD phase gate for feature or bug-fix work. Call this at the start of any work that introduces, modifies, or fixes user-visible behavior. " +
      "Pass phase='SPEC' when the request still needs to be translated into testable acceptance criteria, or phase='RED' when criteria are already clear enough to write the first failing test. Defaults to SPEC.",
    promptSnippet:
      "Engage TDD enforcement before starting a feature or bug fix.",
    promptGuidelines: [
      "Call tdd_engage at the start of any feature or bug-fix work, before any code changes. Use phase='SPEC' if requirements need clarification, phase='RED' if you can write the first failing test immediately.",
      "Do NOT engage TDD for investigation, navigation, branch management, code review, or research. Stay dormant for non-feature work.",
      "When transitioning into RED, the pre-flight gate runs automatically and validates the spec checklist. If pre-flight fails, refine the spec before retrying.",
      "Call tdd_disengage when feature work is finished — post-flight will run automatically to verify the work delivered what was asked.",
    ],
    parameters: Type.Object({
      phase: Type.Optional(
        Type.String({
          description: "TDD phase to start in: SPEC (default) or RED",
        })
      ),
      reason: Type.String({
        description: "Short description of the feature or bug being worked on",
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext) {
      const config = deps.getConfig();
      const machine = deps.machine;
      if (!config.enabled) {
        machine.enabled = false;
        ctx.ui.setStatus(STATUS_KEY, machine.bottomBarText());
        if (ctx.hasUI) {
          ctx.ui.notify("TDD is disabled by configuration", "warning");
        }
        return {
          content: [
            {
              type: "text",
              text: "TDD is disabled by configuration.",
            },
          ],
          details: { engaged: false, phase: null, reason: "disabled by configuration" },
        };
      }

      const phase = normalizePhase(params.phase) ?? "SPEC";
      const reason = String(params.reason ?? "feature/bug work");

      const wasEnabled = machine.enabled;
      const previousPhase = machine.phase;

      // Pre-flight gate when entering RED from anywhere except RED itself.
      // The cycle cannot start with a weak spec.
      if (phase === "RED" && previousPhase !== "RED" && config.runPreflightOnRed) {
        try {
          const result = await runPreflight({ spec: machine.plan, userStory: reason }, ctx, config);
          if (!result.ok) {
            const summary = formatPreflightResult(result);
            if (ctx.hasUI) {
              ctx.ui.notify(
                `Pre-flight blocked engagement into RED: ${result.issues.length} issue(s)`,
                "warning"
              );
            }
            return {
              content: [
                {
                  type: "text",
                  text: `${summary}\n\nEngagement into RED is blocked. Refine the spec checklist and call tdd_engage again.`,
                },
              ],
              details: { engaged: machine.enabled, phase: machine.phase, reason },
            };
          }
        } catch (error) {
          const errorReason = error instanceof Error ? error.message : String(error);
          if (ctx.hasUI) {
            ctx.ui.notify(`Pre-flight gate failed: ${errorReason}`, "warning");
          }
          return {
            content: [
              {
                type: "text",
                text: `Pre-flight gate failed to run: ${errorReason}. Engagement into RED blocked. Resolve the review model error and retry.`,
              },
            ],
            details: { engaged: machine.enabled, phase: machine.phase, reason },
          };
        }
      }

      machine.enabled = true;
      if (machine.phase !== phase) {
        machine.transitionTo(phase, `tdd_engage: ${reason}`, true);
      }

      persistIfEnabled(deps);
      ctx.ui.setStatus(STATUS_KEY, machine.bottomBarText());
      if (ctx.hasUI) {
        const verb = wasEnabled ? "TDD phase set to" : "TDD engaged in";
        ctx.ui.notify(`${verb} ${phase}: ${reason}`, "info");
      }

      return {
        content: [
          {
            type: "text",
            text: `TDD engaged in ${phase} phase. ${reason}`,
          },
        ],
        details: { engaged: true, phase, reason },
      };
    },
  };
}

export function createDisengageTool(
  deps: EngagementDeps
): ToolDefinition<ReturnType<typeof Type.Object>, EngagementDetails, DisengageParams> {
  return {
    name: DISENGAGE_TOOL_NAME,
    label: "Disengage TDD",
    description:
      "Disengage the TDD phase gate when leaving feature or bug-fix work. Call this when switching to investigation, navigation, code review, or any non-feature task so subsequent tool calls are not judged against TDD phase rules.",
    promptSnippet: "Disengage TDD enforcement when leaving feature work.",
    promptGuidelines: [
      "Call tdd_disengage when feature or bug-fix work is finished, or when switching to investigation, branch navigation, or unrelated tasks.",
      "When disengaging from a feature with passing tests and a spec checklist, post-flight runs automatically and reviews whether the work delivered what was asked. Read the post-flight result before treating the feature as truly done.",
      "Stay disengaged until you start the next feature or bug fix.",
    ],
    parameters: Type.Object({
      reason: Type.String({
        description: "Brief reason for disengaging (e.g. 'feature complete', 'switching to investigation')",
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext) {
      const machine = deps.machine;
      const config = deps.getConfig();
      const reason = String(params.reason ?? "leaving feature work");
      const wasEnabled = machine.enabled;

      const { result: postflightResult, summary: postflightSummary } =
        await maybeRunPostflightOnDisengage(machine, ctx, config);

      machine.enabled = false;

      persistIfEnabled(deps);
      ctx.ui.setStatus(STATUS_KEY, machine.bottomBarText());
      if (ctx.hasUI && wasEnabled) {
        ctx.ui.notify(`TDD disengaged: ${reason}`, "info");
      }

      const text = postflightSummary
        ? `${postflightSummary}\n\nTDD disengaged. ${reason}`
        : `TDD disengaged. ${reason}`;

      return {
        content: [{ type: "text", text }],
        details: {
          engaged: false,
          phase: null,
          reason,
          postflight: postflightResult,
        },
      };
    },
  };
}

/**
 * Apply configured lifecycle hooks for an incoming tool call. Returns true if
 * the tool call is itself one of the engagement control tools (so callers can
 * skip the regular gate).
 *
 * Async because the disengage branch runs postflight before flipping the
 * machine off — we want lifecycle hooks (e.g. mcp__manifest__complete_feature)
 * to honour the same proving step as tdd_disengage and /tdd disengage.
 */
export async function applyLifecycleHooks(
  toolName: string,
  deps: EngagementDeps,
  ctx: ExtensionContext
): Promise<{ isControlTool: boolean; engaged?: boolean; disengaged?: boolean }> {
  if (CONTROL_TOOL_NAMES.has(toolName)) {
    return { isControlTool: true };
  }

  const config = deps.getConfig();
  const machine = deps.machine;

  if (!config.enabled) {
    return { isControlTool: false };
  }

  if (config.engageOnTools.includes(toolName) && !machine.enabled) {
    machine.enabled = true;
    const targetPhase = config.startInSpecMode ? "SPEC" : "RED";
    if (machine.phase !== targetPhase) {
      machine.transitionTo(targetPhase, `lifecycle hook: ${toolName}`, true);
    }
    persistIfEnabled(deps);
    ctx.ui.setStatus(STATUS_KEY, machine.bottomBarText());
    if (ctx.hasUI) {
      ctx.ui.notify(`TDD engaged in ${targetPhase} (via ${toolName})`, "info");
    }
    return { isControlTool: false, engaged: true };
  }

  if (config.disengageOnTools.includes(toolName) && machine.enabled) {
    // Run postflight BEFORE flipping the machine off, same as the explicit
    // disengage paths. The shared helper handles eligibility and notifications.
    await maybeRunPostflightOnDisengage(machine, ctx, config);

    machine.enabled = false;
    persistIfEnabled(deps);
    ctx.ui.setStatus(STATUS_KEY, machine.bottomBarText());
    if (ctx.hasUI) {
      ctx.ui.notify(`TDD disengaged (via ${toolName})`, "info");
    }
    return { isControlTool: false, disengaged: true };
  }

  return { isControlTool: false };
}
