import type { TDDConfig } from "./types.js";
import type { PhaseStateMachine } from "./phase.js";
import { guidelinesForPhase } from "./guidelines.js";

export function buildSystemPrompt(machine: PhaseStateMachine, config: TDDConfig): string {
  if (!config.enabled) {
    return "[TDD MODE - DISABLED]\nTDD enforcement is disabled by configuration.";
  }

  if (!machine.enabled) {
    const lines = [
      "[TDD MODE - dormant]",
      "TDD enforcement is currently dormant. Investigation, navigation, code review, and exploratory work are unconstrained.",
      "",
      "When you start work on a feature or bug fix, call the `tdd_engage` tool first (phase: SPEC if requirements need clarification, RED if you can write the failing test immediately).",
      "Call `tdd_disengage` when leaving feature work or switching back to investigation.",
    ];
    if (config.engageOnTools.length > 0) {
      lines.push("");
      lines.push(
        `TDD will also auto-engage when these tools are called: ${config.engageOnTools.join(", ")}.`
      );
    }
    return lines.join("\n");
  }

  const phase = machine.phase;
  const allowed = machine.allowedActions();
  const prohibited = machine.prohibitedActions();
  const lines = [
    `[TDD MODE - Phase: ${phase}]`,
    `You are in strict TDD mode. Current phase: ${phase}.`,
    "",
  ];

  switch (phase) {
    case "SPEC":
      lines.push("- Use SPEC as an optional preflight step when needed to set the user's request up for success.");
      lines.push("- Translate the user's request into a clear user story, observable acceptance criteria, and concrete testable specifications before changing files.");
      lines.push("- Decide whether each spec item needs unit proof, integration proof, or both before moving into RED.");
      lines.push("- Present the spec as a numbered list of test cases or acceptance checks that prove the requested behavior.");
      lines.push("- Do not write code until the user or command switches to RED.");
      if (machine.plan.length > 0) {
        lines.push("");
        lines.push("Current feature spec:");
        for (let i = 0; i < machine.plan.length; i++) {
          const marker = i < machine.planCompleted ? "[x]" : i === machine.planCompleted ? "[>]" : "[ ]";
          lines.push(`${marker} ${i + 1}. ${machine.plan[i]}`);
        }
      }
      break;
    case "RED":
      lines.push("- Write a failing test first.");
      lines.push("- Use the cheapest test that can prove the current behavior: unit for isolated logic, integration for boundaries and contracts.");
      lines.push("- Confirm the test fails before moving to implementation.");
      break;
    case "GREEN":
      lines.push("- Write the smallest correct implementation for the behavior the failing test asserts.");
      lines.push("- Satisfy the current failing test at its chosen proof level without dodging boundary behavior behind mocks.");
      lines.push("- Stay scoped to the current failing test. Save cleanup and broader changes for REFACTOR.");
      break;
    case "REFACTOR":
      lines.push("- Refine the code from this cycle without changing behavior: naming, readability, duplication, structure.");
      break;
  }

  const guidelines = guidelinesForPhase(phase, config.guidelines);
  if (guidelines) {
    lines.push("");
    lines.push(guidelines);
  }

  if (phase !== "SPEC" && machine.plan.length > 0) {
    const current = machine.currentPlanItem();
    if (current) {
      lines.push("");
      lines.push(`Current spec item (${machine.planCompleted + 1}/${machine.plan.length}): ${current}`);
    }
  }

  lines.push("");
  lines.push(`Allowed: ${allowed}`);
  lines.push(`Prohibited: ${prohibited}`);
  lines.push("");
  lines.push("Tool calls are gated. Out-of-phase actions can be blocked.");

  if (machine.lastTestFailed !== null) {
    lines.push(`Last test result: ${machine.lastTestFailed ? "FAILING" : "PASSING"}`);
  }

  if (phase !== "SPEC") {
    lines.push(`Cycle: ${machine.cycleCount}`);
  }

  return lines.join("\n");
}
