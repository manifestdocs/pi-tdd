import { isToolCallEventType, type ExtensionContext, type ToolCallEvent, type ToolCallEventResult } from "@mariozechner/pi-coding-agent";
import type { TDDConfig } from "./types.js";
import type { PhaseStateMachine } from "./phase.js";
import { isTestCommand } from "./transition.js";

const READ_ONLY_TOOLS = new Set(["read", "grep", "find", "ls"]);
const BUILTIN_MUTATING_TOOLS = new Set(["write", "edit", "bash"]);

/**
 * The gate enforces exactly one deterministic rule: SPEC blocks file mutations
 * (write/edit/bash) so the spec gets finalised before any code lands. In every
 * other phase the gate is a passthrough that only records diffs into the phase
 * state for downstream review (preflight/postflight) context.
 *
 * There is no per-tool-call LLM judging. The system prompt steers the agent
 * during the cycle and test signals drive transitions; review LLM calls only
 * fire at cycle boundaries (preflight before, postflight after) — never during.
 */
export async function gateSingleToolCall(
  event: ToolCallEvent,
  machine: PhaseStateMachine,
  config: TDDConfig,
  ctx: ExtensionContext
): Promise<ToolCallEventResult | void> {
  if (!config.enabled || !machine.enabled) {
    return undefined;
  }

  if (config.allowReadInAllPhases && READ_ONLY_TOOLS.has(event.toolName)) {
    return undefined;
  }

  if (isToolCallEventType("bash", event) && machine.phase !== "SPEC" && isTestCommand(event.input.command)) {
    machine.addDiff(summarizeDiff(event), config.maxDiffsInContext);
    return undefined;
  }

  if (machine.phase === "SPEC" && BUILTIN_MUTATING_TOOLS.has(event.toolName)) {
    const blocked = await handleSpecBlock(event, ctx);
    if (blocked) {
      return blocked;
    }
    machine.addDiff(summarizeDiff(event), config.maxDiffsInContext);
    return undefined;
  }

  // RED / GREEN / REFACTOR: passthrough. Just record the diff for review
  // context. The system prompt steers the agent and the test signal drives
  // phase transitions — no LLM judging here.
  machine.addDiff(summarizeDiff(event), config.maxDiffsInContext);
  return undefined;
}

async function handleSpecBlock(
  event: ToolCallEvent,
  ctx: ExtensionContext
): Promise<ToolCallEventResult | undefined> {
  if (ctx.hasUI) {
    ctx.ui.notify(`Blocked ${event.toolName} during SPEC. Finish the feature spec first.`, "warning");
  }

  const override = await confirmOverride(
    ctx,
    "SPEC phase is read-only",
    `SPEC blocks ${event.toolName}. Override and allow it anyway?`
  );

  return override
    ? undefined
    : {
        block: true,
        reason: "SPEC phase blocks file changes and bash execution until the test specification is ready.",
      };
}

async function confirmOverride(
  ctx: ExtensionContext,
  title: string,
  message: string
): Promise<boolean> {
  if (!ctx.hasUI) {
    return false;
  }

  return ctx.ui.confirm(title, message, { signal: ctx.signal });
}

function summarizeDiff(event: ToolCallEvent): string {
  const parts = [event.toolName];
  const input = event.input as Record<string, unknown>;

  if (typeof input.path === "string") {
    parts.push(input.path);
  }
  if (typeof input.command === "string") {
    parts.push(truncate(input.command, 120));
  }

  return parts.join(" | ");
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}
