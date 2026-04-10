import { isBashToolResult, type ExtensionContext, type ToolResultEvent } from "@mariozechner/pi-coding-agent";
import type { TDDConfig, TestProofLevel, TestSignal } from "./types.js";
import type { PhaseStateMachine } from "./phase.js";
import { splitCommandArgs } from "./commands.js";

const BARE_TEST_BINARIES = new Set(["pytest", "vitest", "rspec", "jest", "mocha"]);
const SHELL_WRAPPERS = new Set(["bash", "sh", "zsh"]);
const TRUTHY_NO_OP_COMMANDS = new Set(["true", ":"]);
const FAILURE_OUTPUT_PATTERNS = [
  /\b[1-9]\d*\s+failed\b/i,
  /\b[1-9]\d*\s+failures?\b/i,
  /\b[1-9]\d*\s+errors?\b/i,
  /\btest result:\s*failed\b/i,
  /^fail(?:\s|$)/im,
  /^failed\b/im,
  /\berror:\s+test failed\b/i,
];
const PASS_OUTPUT_PATTERNS = [
  /\b0\s+failed\b/i,
  /\b0\s+failures?\b/i,
  /\b0\s+errors?\b/i,
  /\btest result:\s*ok\b/i,
  /\b[1-9]\d*\s+passed\b/i,
];
const INTEGRATION_PROOF_HINTS = [
  "integration",
  "e2e",
  "end-to-end",
  "end_to_end",
  "contract",
  "api",
  "component",
  "playwright",
  "cypress",
  "browser",
  "system",
  "smoke",
] as const;
const UNIT_PROOF_HINTS = ["unit"] as const;

type CommandOperator = "&&" | "||" | ";" | "|" | null;

interface CommandClause {
  text: string;
  nextOperator: CommandOperator;
}

export function isTestCommand(command: string): boolean {
  return splitCommandClauses(command).some((clause) => isTestCommandClause(clause.text));
}

export function extractTestSignal(event: ToolResultEvent): TestSignal | null {
  if (!isBashToolResult(event)) {
    return null;
  }

  const command = typeof event.input.command === "string" ? event.input.command : "";
  const clauses = splitCommandClauses(command);
  if (!clauses.some((clause) => isTestCommandClause(clause.text))) {
    return null;
  }

  const output = event.content
    .filter((content): content is { type: "text"; text: string } => content.type === "text")
    .map((content) => content.text)
    .join("\n");
  const failed = inferTestFailure(clauses, output, event.isError);
  if (failed === null) {
    return null;
  }

  return {
    command,
    output,
    failed,
    level: inferTestProofLevel(command),
  };
}

export async function evaluateTransition(
  signals: TestSignal[],
  machine: PhaseStateMachine,
  config: TDDConfig,
  ctx: ExtensionContext
): Promise<void> {
  if (!config.enabled || !machine.enabled) {
    return;
  }

  for (const signal of signals) {
    machine.recordTestResult(signal.output, signal.failed, signal.command, signal.level);
  }

  if (!config.autoTransition) {
    return;
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

function inferTestFailure(
  clauses: CommandClause[],
  output: string,
  isError: boolean
): boolean | null {
  if (isError) {
    return true;
  }

  if (!hasMaskedFailureFallback(clauses)) {
    return false;
  }

  if (matchesAnyPattern(output, FAILURE_OUTPUT_PATTERNS)) {
    return true;
  }
  if (matchesAnyPattern(output, PASS_OUTPUT_PATTERNS)) {
    return false;
  }
  return null;
}

function hasMaskedFailureFallback(clauses: CommandClause[]): boolean {
  for (let i = 0; i < clauses.length - 1; i++) {
    if (clauses[i].nextOperator !== "||") {
      continue;
    }
    if (!isTestCommandClause(clauses[i].text)) {
      continue;
    }
    if (isTruthyNoOpClause(clauses[i + 1].text)) {
      return true;
    }
  }
  return false;
}

function isTruthyNoOpClause(clause: string): boolean {
  const [firstToken] = splitCommandArgs(clause);
  return firstToken ? TRUTHY_NO_OP_COMMANDS.has(commandName(firstToken)) : false;
}

function matchesAnyPattern(value: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
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

export function inferTestProofLevel(command: string): TestProofLevel {
  const normalized = command.toLowerCase();
  if (INTEGRATION_PROOF_HINTS.some((hint) => normalized.includes(hint))) {
    return "integration";
  }
  if (UNIT_PROOF_HINTS.some((hint) => normalized.includes(hint))) {
    return "unit";
  }
  return "unknown";
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

function splitCommandClauses(command: string): CommandClause[] {
  const clauses: CommandClause[] = [];
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
      pushClause(clauses, current, `${ch}${next}` as CommandOperator);
      current = "";
      i++;
      continue;
    }

    if (ch === ";" || ch === "|") {
      pushClause(clauses, current, ch as CommandOperator);
      current = "";
      continue;
    }

    current += ch;
  }

  pushClause(clauses, current, null);
  return clauses;
}

function pushClause(clauses: CommandClause[], clause: string, nextOperator: CommandOperator): void {
  const trimmed = clause.trim();
  if (trimmed) {
    clauses.push({ text: trimmed, nextOperator });
  }
}
