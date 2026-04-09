import { isBashToolResult, type ExtensionContext, type ToolResultEvent } from "@mariozechner/pi-coding-agent";
import type { TDDConfig, TestSignal } from "./types.js";
import type { PhaseStateMachine } from "./phase.js";
import { splitCommandArgs } from "./commands.js";

const BARE_TEST_BINARIES = new Set(["pytest", "vitest", "rspec", "jest", "mocha"]);
const SHELL_WRAPPERS = new Set(["bash", "sh", "zsh"]);

export function isTestCommand(command: string): boolean {
  return splitCommandClauses(command).some(isTestCommandClause);
}

export function extractTestSignal(event: ToolResultEvent): TestSignal | null {
  if (!isBashToolResult(event)) {
    return null;
  }

  const command = typeof event.input.command === "string" ? event.input.command : "";
  if (!isTestCommand(command)) {
    return null;
  }

  const output = event.content
    .filter((content): content is { type: "text"; text: string } => content.type === "text")
    .map((content) => content.text)
    .join("\n");

  return {
    command,
    output,
    failed: event.isError,
  };
}

export async function evaluateTransition(
  signals: TestSignal[],
  machine: PhaseStateMachine,
  config: TDDConfig,
  ctx: ExtensionContext
): Promise<void> {
  if (!config.enabled || !machine.enabled || !config.autoTransition) {
    return;
  }

  for (const signal of signals) {
    machine.recordTestResult(signal.output, signal.failed);
  }

  if (machine.phase === "SPEC") {
    return;
  }

  const expectedNextPhase = machine.nextPhase();
  if (machine.phase === "REFACTOR" && config.refactorTransition === "user") {
    return;
  }

  if (machine.phase === "RED" && !signals.some((signal) => signal.failed)) {
    return;
  }
  if (machine.phase === "GREEN" && !signals.some((signal) => !signal.failed)) {
    return;
  }

  // Deterministic test-signal-driven transitions only. If signals don't yield
  // a clear answer, no transition fires — the agent advances explicitly with
  // /tdd commands or tdd_engage(phase).
  const verdict = fallbackTransition(machine, signals, expectedNextPhase);
  if (!verdict.transition || verdict.transition !== expectedNextPhase) {
    return;
  }

  const transitioned = machine.transitionTo(verdict.transition, verdict.reason);
  if (!transitioned) {
    return;
  }

  if (ctx.hasUI) {
    ctx.ui.notify(`TDD phase -> ${verdict.transition} (${verdict.reason})`, "info");
  }
  ctx.ui.setStatus("tdd-gate", machine.bottomBarText());
}

export function fallbackTransition(
  machine: PhaseStateMachine,
  signals: TestSignal[],
  expectedNextPhase: ReturnType<PhaseStateMachine["nextPhase"]>
): { transition: typeof expectedNextPhase | null; reason: string } {
  if (machine.phase === "RED" && signals.some((signal) => signal.failed)) {
    return {
      transition: expectedNextPhase,
      reason: "Observed a failing test run in RED.",
    };
  }

  if (machine.phase === "GREEN" && signals.some((signal) => !signal.failed)) {
    return {
      transition: expectedNextPhase,
      reason: "Observed a passing test run in GREEN.",
    };
  }

  return {
    transition: null,
    reason: "No deterministic transition signal was found.",
  };
}

function isTestCommandClause(clause: string): boolean {
  const tokens = splitCommandArgs(clause);
  if (tokens.length === 0) {
    return false;
  }

  const [firstRaw, secondRaw, thirdRaw] = tokens;
  const first = commandName(firstRaw);
  const second = secondRaw?.toLowerCase();
  const third = thirdRaw?.toLowerCase();

  if (BARE_TEST_BINARIES.has(first)) {
    return true;
  }

  if (first === "npx" && secondRaw) {
    return BARE_TEST_BINARIES.has(commandName(secondRaw));
  }

  if (first === "cargo" || first === "go" || first === "deno" || first === "zig") {
    return second === "test";
  }

  if (first === "make") {
    return second === "test" || second === "check";
  }

  if (first === "blc") {
    return second === "check" || second === "test";
  }

  if (first === "npm" || first === "pnpm" || first === "yarn" || first === "bun") {
    if (second === "test") {
      return true;
    }
    if (second === "run" && third?.startsWith("test")) {
      return true;
    }
  }

  if (SHELL_WRAPPERS.has(first) && secondRaw) {
    return looksLikeTestScript(secondRaw);
  }

  return looksLikeTestScript(firstRaw);
}

function looksLikeTestScript(token: string): boolean {
  const normalized = token.toLowerCase();
  if (normalized === "test") {
    return true;
  }

  const trimmed = normalized.startsWith("./") ? normalized.slice(2) : normalized;
  const parts = trimmed.split("/");
  const last = parts[parts.length - 1] ?? "";

  return (
    trimmed.startsWith("scripts/test") ||
    trimmed.includes("/test") ||
    last === "test" ||
    last.startsWith("test.")
  );
}

function commandName(token: string): string {
  const normalized = token.toLowerCase();
  const parts = normalized.split("/");
  return parts[parts.length - 1] ?? normalized;
}

function splitCommandClauses(command: string): string[] {
  const clauses: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let escape = false;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    const next = command[i + 1];

    if (escape) {
      current += ch;
      escape = false;
      continue;
    }

    if (ch === "\\") {
      current += ch;
      escape = true;
      continue;
    }

    if (quote) {
      current += ch;
      if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      current += ch;
      quote = ch;
      continue;
    }

    if ((ch === "&" && next === "&") || (ch === "|" && next === "|")) {
      pushClause(clauses, current);
      current = "";
      i++;
      continue;
    }

    if (ch === ";" || ch === "|") {
      pushClause(clauses, current);
      current = "";
      continue;
    }

    current += ch;
  }

  pushClause(clauses, current);
  return clauses;
}

function pushClause(clauses: string[], clause: string): void {
  const trimmed = clause.trim();
  if (trimmed) {
    clauses.push(trimmed);
  }
}
