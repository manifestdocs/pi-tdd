import type { TDDConfig } from "./types.js";
import type { PhaseStateMachine } from "./phase.js";
import { guidelinesForPhase } from "./guidelines.js";

export function buildSystemPrompt(machine: PhaseStateMachine, config: TDDConfig): string {
  if (!config.enabled) {
    return "[TDD MODE - DISABLED]\nTDD enforcement is disabled by configuration.";
  }

  if (!machine.enabled) {
    return buildDormantPrompt(config);
  }

  const lines = [
    `[TDD MODE - Phase: ${machine.phase}]`,
    `You are in strict TDD mode. Current phase: ${machine.phase}.`,
    "",
    ...phaseGuidance(machine),
    ...guidelineLines(machine, config),
    ...currentSpecItemLines(machine),
    ...statusLines(machine),
  ];

  return lines.join("\n");
}

function buildDormantPrompt(config: TDDConfig): string {
  const lines = [
    "[TDD MODE - dormant]",
    "TDD enforcement is currently dormant. Investigation, navigation, code review, and exploratory work are unconstrained.",
    "",
    "When you start work on a feature or bug fix, call the `tdd_engage` tool first (phase: SPEC if requirements need clarification, RED if you can write the failing test immediately).",
    "Call `tdd_disengage` when leaving feature work or switching back to investigation.",
  ];

  if (config.engageOnTools.length > 0) {
    lines.push("");
    lines.push(`TDD will also auto-engage when these tools are called: ${config.engageOnTools.join(", ")}.`);
  }

  return lines.join("\n");
}

function phaseGuidance(machine: PhaseStateMachine): string[] {
  switch (machine.phase) {
    case "SPEC":
      return [
        "- Use SPEC as an optional preflight step when needed to set the user's request up for success.",
        "- Translate the user's request into a clear user story, observable acceptance criteria, and concrete testable specifications before changing files.",
        "- Decide whether each spec item needs unit proof, integration proof, or both before moving into RED.",
        "- Present the spec as a numbered list of test cases or acceptance checks that prove the requested behavior.",
        "- Stay in specification mode until the user or command switches to RED.",
        ...specChecklistLines(machine),
      ];
    case "RED":
      return [
        "- Write a failing test first.",
        "- Use the cheapest test that can prove the current behavior: unit for isolated logic, integration for boundaries and contracts.",
        "- Confirm the test fails before moving to implementation.",
      ];
    case "GREEN":
      return [
        "- Write the smallest correct implementation for the behavior the failing test asserts.",
        "- Satisfy the current failing test at its chosen proof level by exercising boundary behavior honestly when the test targets a seam.",
        "- Stay scoped to the current failing test. Save cleanup and broader changes for REFACTOR.",
      ];
    case "REFACTOR":
      return [
        "- Preserve behavior while refining the code from this cycle: naming, readability, duplication, structure.",
      ];
  }
}

function specChecklistLines(machine: PhaseStateMachine): string[] {
  if (machine.plan.length === 0) {
    return [];
  }

  return [
    "",
    "Current feature spec:",
    ...machine.plan.map((item, index) => `${specMarker(machine, index)} ${index + 1}. ${item}`),
  ];
}

function specMarker(machine: PhaseStateMachine, index: number): string {
  if (index < machine.planCompleted) return "[x]";
  if (index === machine.planCompleted) return "[>]";
  return "[ ]";
}

function guidelineLines(machine: PhaseStateMachine, config: TDDConfig): string[] {
  const guidelines = guidelinesForPhase(machine.phase, config.guidelines);
  return guidelines ? ["", guidelines] : [];
}

function currentSpecItemLines(machine: PhaseStateMachine): string[] {
  if (machine.phase === "SPEC" || machine.plan.length === 0) {
    return [];
  }

  const current = machine.currentPlanItem();
  return current
    ? ["", `Current spec item (${machine.planCompleted + 1}/${machine.plan.length}): ${current}`]
    : [];
}

function statusLines(machine: PhaseStateMachine): string[] {
  const lines = [
    "",
    `Allowed: ${machine.allowedActions()}`,
    `Prohibited: ${machine.prohibitedActions()}`,
    "",
    "Tool calls are gated. Out-of-phase actions can be blocked.",
  ];

  if (machine.lastTestFailed !== null) {
    lines.push(`Last test result: ${machine.lastTestFailed ? "FAILING" : "PASSING"}`);
  }
  if (machine.phase !== "SPEC") {
    lines.push(`Cycle: ${machine.cycleCount}`);
  }

  return lines;
}
