import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@mariozechner/pi-coding-agent";
import type { PhaseState, TDDPhase } from "./types.js";
import type { PhaseStateMachine } from "./phase.js";

export const STATE_ENTRY_TYPE = "tdd_state";

type TddStateEntry = SessionEntry & {
  type: "custom";
  customType: typeof STATE_ENTRY_TYPE;
  data?: PhaseState;
};

export function persistState(pi: ExtensionAPI, machine: PhaseStateMachine): void {
  pi.appendEntry(STATE_ENTRY_TYPE, machine.getSnapshot());
}

export function restoreState(ctx: ExtensionContext): PhaseState | null {
  const entries = ctx.sessionManager.getBranch();

  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i] as TddStateEntry;
    if (entry.type !== "custom" || entry.customType !== STATE_ENTRY_TYPE || !entry.data) {
      continue;
    }

    const state = entry.data;
    const phase = normalizePhase(state.phase);
    if (!phase) {
      continue;
    }

    return {
      phase,
      diffs: Array.isArray(state.diffs) ? state.diffs : [],
      lastTestOutput: typeof state.lastTestOutput === "string" ? state.lastTestOutput : null,
      lastTestFailed: typeof state.lastTestFailed === "boolean" ? state.lastTestFailed : null,
      cycleCount: typeof state.cycleCount === "number" ? state.cycleCount : 0,
      enabled: typeof state.enabled === "boolean" ? state.enabled : true,
      plan: Array.isArray(state.plan) ? state.plan : [],
      planCompleted: typeof state.planCompleted === "number" ? state.planCompleted : 0,
    };
  }

  return null;
}

function normalizePhase(phase: unknown): TDDPhase | null {
  if (phase === "PLAN" || phase === "SPEC") return "SPEC";
  if (phase === "RED" || phase === "GREEN" || phase === "REFACTOR") return phase;
  return null;
}
