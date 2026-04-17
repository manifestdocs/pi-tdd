/**
 * Pi TDD Extension
 *
 * Enforces specifying-implementing-refactoring sequencing when activated via /tdd.
 * Off by default. No configuration beyond a test command.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { type ExtensionAPI, type ExtensionContext, isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { truncateToWidth } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

import { isConfigFile, isProductionFile, isTestFile } from "./file-classification.js";
import { formatDuration, parseTestOutput, type TestSummary } from "./parsers.js";
import { buildSystemPrompt, type Phase } from "./prompt.js";
import { detectsShellWritePattern, extractRedirectTargets } from "./shell-detection.js";

// -- File classification ------------------------------------------------------
const IMPORT_ERROR_RE =
  /Cannot find module|Module not found|ModuleNotFoundError|ImportError|unresolved import|cannot find package|no required module|Could not resolve/i;

function isImportOnlyFailure(output: string, summary: TestSummary): boolean {
  const noTestsRan = summary.passed === 0 && summary.failed === 0 && summary.tests.length === 0;
  return noTestsRan && IMPORT_ERROR_RE.test(output);
}

function getStringInput(input: Record<string, unknown>, key: string): string | undefined {
  const val = input[key];
  return typeof val === "string" ? val : undefined;
}

function shouldRunTests(phase: Phase, filePath: string): boolean {
  if (isConfigFile(filePath)) return false;
  switch (phase) {
    case "specifying":
      return isTestFile(filePath);
    case "implementing":
    case "refactoring":
      return true;
    default:
      return false;
  }
}

// -- Widget rendering ---------------------------------------------------------

interface WidgetTheme {
  bold(s: string): string;
  fg(color: string, s: string): string;
}

const PHASE_COLORS: Record<string, "error" | "success" | "accent"> = {
  specifying: "error",
  implementing: "accent",
  refactoring: "success",
};

function renderWidget(
  snap: { phase: Phase; cycleCount: number; summary: TestSummary | undefined },
  theme: WidgetTheme,
  width: number,
): string[] {
  const lines: string[] = [];
  const maxName = width - 8;

  const phaseLabel = theme.bold(theme.fg(PHASE_COLORS[snap.phase] ?? "text", snap.phase.toUpperCase()));
  const cycleLabel = snap.cycleCount > 0 ? theme.fg("dim", ` cycle ${snap.cycleCount}`) : "";
  lines.push(`${theme.fg("muted", "TDD")} ${phaseLabel}${cycleLabel}`);

  if (!snap.summary) {
    lines.push(theme.fg("dim", "  Waiting for tests..."));
    return lines;
  }

  const parts: string[] = [];
  if (snap.summary.passed > 0) parts.push(theme.fg("success", `${snap.summary.passed} passed`));
  if (snap.summary.failed > 0) parts.push(theme.fg("error", `${snap.summary.failed} failed`));
  if (snap.summary.duration) parts.push(theme.fg("dim", snap.summary.duration));
  if (parts.length > 0) lines.push(`  ${parts.join(theme.fg("dim", " | "))}`);

  const maxTests = 7;
  const sorted = [...snap.summary.tests].sort((a, b) => Number(a.passed) - Number(b.passed));
  const shown = sorted.slice(0, maxTests);
  for (const t of shown) {
    const icon = t.passed ? theme.fg("success", "\u2714") : theme.fg("error", "\u2717");
    const name = truncateToWidth(t.name, maxName);
    lines.push(`  ${icon} ${name}`);
  }
  if (snap.summary.tests.length > maxTests) {
    lines.push(theme.fg("dim", `  ... ${snap.summary.tests.length - maxTests} more`));
  }

  return lines;
}

// -- Test command inference ----------------------------------------------------

type TestRule =
  | { marker: string; command: string }
  | {
      marker: string;
      command: string;
      when: (cwd: string) => Promise<boolean>;
    };

const TEST_RULES: TestRule[] = [
  // Node / JS — only if package.json declares a test script
  { marker: "package.json", command: "npm test", when: hasNpmTestScript },
  // Rust
  { marker: "Cargo.toml", command: "cargo test" },
  // Go
  { marker: "go.mod", command: "go test ./..." },
  // Python
  { marker: "pytest.ini", command: "pytest" },
  { marker: "pyproject.toml", command: "pytest" },
  { marker: "setup.py", command: "python -m unittest discover" },
  // Ruby
  { marker: "Gemfile", command: "bundle exec rake test" },
  // Elixir
  { marker: "mix.exs", command: "mix test" },
  // .NET
  { marker: "*.sln", command: "dotnet test" },
  { marker: "*.csproj", command: "dotnet test" },
  { marker: "*.fsproj", command: "dotnet test" },
  // Java / Kotlin
  { marker: "pom.xml", command: "mvn test" },
  { marker: "build.gradle", command: "gradle test" },
  { marker: "build.gradle.kts", command: "gradle test" },
  // PHP
  { marker: "phpunit.xml", command: "vendor/bin/phpunit" },
  { marker: "phpunit.xml.dist", command: "vendor/bin/phpunit" },
  // Makefile — generic fallback
  { marker: "Makefile", command: "make test", when: makefileHasTestTarget },
];

async function fileExists(cwd: string, name: string): Promise<boolean> {
  if (name.includes("*")) {
    const entries = await fs.promises.readdir(cwd);
    const ext = name.slice(1); // "*.sln" → ".sln"
    return entries.some((e) => e.endsWith(ext));
  }
  try {
    await fs.promises.access(path.join(cwd, name));
    return true;
  } catch {
    return false;
  }
}

async function hasNpmTestScript(cwd: string): Promise<boolean> {
  try {
    const pkg = JSON.parse(await fs.promises.readFile(path.join(cwd, "package.json"), "utf-8"));
    return Boolean(pkg.scripts?.test);
  } catch {
    return false;
  }
}

async function makefileHasTestTarget(cwd: string): Promise<boolean> {
  try {
    const contents = await fs.promises.readFile(path.join(cwd, "Makefile"), "utf-8");
    return /^test\s*:/m.test(contents);
  } catch {
    return false;
  }
}

async function inferTestCommand(cwd: string): Promise<string | undefined> {
  for (const rule of TEST_RULES) {
    if (!(await fileExists(cwd, rule.marker))) continue;
    if ("when" in rule && !(await rule.when(cwd))) continue;
    return rule.command;
  }
  return undefined;
}

// -- Monorepo / multi-directory discovery --------------------------------------

interface TestProject {
  dir: string;
  name: string;
  command: string;
}

async function scanChildDirectories(cwd: string): Promise<TestProject[]> {
  const entries = await fs.promises.readdir(cwd, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith("."));
  const results: TestProject[] = [];
  for (const entry of dirs) {
    const dir = path.join(cwd, entry.name);
    const cmd = await inferTestCommand(dir);
    if (cmd) results.push({ dir, name: entry.name, command: cmd });
  }
  return results;
}

function buildSelectOptions(projects: TestProject[]): string[] {
  return [...projects.map((p) => `${p.name} \u2014 ${p.command}`), "Custom command..."];
}

interface TestConfig {
  command: string;
  cwd: string;
}

async function resolveTestConfig(
  rootCwd: string,
  ui: { input: ExtensionContext["ui"]["input"]; select: ExtensionContext["ui"]["select"] } | undefined,
): Promise<TestConfig | undefined> {
  const rootCmd = await inferTestCommand(rootCwd);
  if (rootCmd) return { command: rootCmd, cwd: rootCwd };

  const projects = await scanChildDirectories(rootCwd);

  if (projects.length === 1) {
    return { command: projects[0].command, cwd: projects[0].dir };
  }

  if (projects.length > 1 && ui) {
    const options = buildSelectOptions(projects);
    const choice = await ui.select("Select test project", options);
    if (!choice) return undefined;
    const project = projects.find((p) => choice.startsWith(p.name));
    if (project) return { command: project.command, cwd: project.dir };
  }

  if (ui) {
    const manual = await ui.input("Test command", "npm test");
    if (manual) return { command: manual, cwd: rootCwd };
  }

  return undefined;
}

// -- Extension ----------------------------------------------------------------

export default function tddExtension(pi: ExtensionAPI) {
  let phase: Phase = "off";
  let testCommand: string | undefined;
  let testCwd: string | undefined;
  let testEvidenceObserved = false;
  let stubAllowed = false;
  let lastSummary: TestSummary | undefined;
  let cycleCount = 0;

  // -- Helpers --------------------------------------------------------------

  async function runTests(): Promise<{
    passed: boolean;
    output: string;
    durationMs: number;
  }> {
    if (!testCommand)
      return {
        passed: true,
        output: "No test command configured",
        durationMs: 0,
      };
    const start = Date.now();
    const opts = testCwd ? { cwd: testCwd } : undefined;
    const { stdout, stderr, code } = await pi.exec("sh", ["-c", testCommand], opts);
    const durationMs = Date.now() - start;
    return {
      passed: code === 0,
      output: `${stdout}\n${stderr}`.trim(),
      durationMs,
    };
  }

  function setPhase(next: Phase, ctx: ExtensionContext) {
    if (next === "specifying" && phase === "refactoring") cycleCount++;
    if (next === "specifying") {
      testEvidenceObserved = false;
      stubAllowed = false;
    }
    if (next === "off") {
      lastSummary = undefined;
      cycleCount = 0;
      stubAllowed = false;
    }
    phase = next;
    ctx.ui.setStatus("tdd", phase === "off" ? "" : `TDD: ${phase.toUpperCase()}`);
    updateWidget(ctx);
  }

  function updateWidget(ctx: ExtensionContext) {
    if (!ctx.hasUI) return;
    if (phase === "off") {
      ctx.ui.setWidget("tdd", undefined);
      return;
    }
    const snap = { phase, cycleCount, summary: lastSummary };
    ctx.ui.setWidget("tdd", (_tui, theme) => ({
      render: (width: number) => renderWidget(snap, theme, width),
      invalidate() {},
    }));
  }

  // -- Enable / disable -----------------------------------------------------

  async function enableTdd(ctx: ExtensionContext): Promise<string> {
    if (phase !== "off") return "TDD is already active";
    const config = await resolveTestConfig(ctx.cwd, ctx.hasUI ? ctx.ui : undefined);
    if (!config) {
      ctx.ui.notify("TDD requires a test command", "warning");
      return (
        "Could not determine test command. " +
        "Scaffold the project first: create a config file (package.json, pyproject.toml, " +
        "Cargo.toml, go.mod, etc.) with a test script/dependency, then call tdd_start again."
      );
    }
    testCommand = config.command;
    testCwd = config.cwd;
    cycleCount = 1;
    lastSummary = undefined;
    setPhase("specifying", ctx);
    const label = testCwd !== ctx.cwd ? ` in ${path.basename(testCwd)}` : "";
    ctx.ui.notify(`TDD on${label} \u2014 write a failing test`);
    let msg = `TDD enabled \u2014 SPECIFYING phase. Write a failing test first.\nTest command: ${testCommand}${label}`;
    if (config.command === "pytest") {
      msg +=
        '\nHint: add pythonpath = ["."] under [tool.pytest.ini_options] in pyproject.toml so pytest can import your modules.';
    }
    return msg;
  }

  function disableTdd(ctx: ExtensionContext): string {
    if (phase === "off") return "TDD is already off";
    testCwd = undefined;
    setPhase("off", ctx);
    ctx.ui.notify("TDD off");
    return "TDD disabled";
  }

  // -- /tdd command ---------------------------------------------------------

  pi.registerCommand("tdd", {
    description: "Toggle TDD mode (specifying-implementing-refactoring)",
    handler: async (_args, ctx) => {
      if (phase === "off") await enableTdd(ctx);
      else disableTdd(ctx);
    },
  });

  // -- Agent tools ----------------------------------------------------------

  pi.registerTool({
    name: "tdd_start",
    label: "TDD Start",
    description:
      "Enable TDD mode for feature or bug fix work." +
      " Call this before writing code when the task" +
      " involves new behavior or fixing a bug.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const msg = await enableTdd(ctx);
      return { content: [{ type: "text", text: msg }], details: {} };
    },
  });

  pi.registerTool({
    name: "tdd_done",
    label: "TDD Done",
    description: "End TDD mode. Call this when the current feature or bug fix is complete and all tests pass.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const msg = disableTdd(ctx);
      return { content: [{ type: "text", text: msg }], details: {} };
    },
  });

  // -- Shared test-result handler -------------------------------------------

  function handleTestResult(
    passed: boolean,
    output: string,
    durationMs: number | undefined,
    ctx: ExtensionContext,
  ): { appendText: string } {
    stubAllowed = false;

    const summary = parseTestOutput(output);
    if (durationMs != null && !summary.duration) {
      summary.duration = formatDuration(durationMs);
    }
    lastSummary = summary;
    updateWidget(ctx);

    if (phase === "specifying" && !passed && summary.failed > 0) {
      testEvidenceObserved = true;
    }

    const label = `[TDD ${phase.toUpperCase()}] Tests ${passed ? "PASS" : "FAIL"}`;
    let appendText = `\n${label}:\n${output}`;

    if (phase === "specifying" && !passed && isImportOnlyFailure(output, summary)) {
      stubAllowed = true;
      appendText +=
        "\n\n[TDD HINT] Tests failed due to a missing module, not a failing assertion." +
        " You may now create a minimal stub (empty class/function with the right exports)" +
        " so the tests can load and fail on actual behavioral assertions. Stay in SPECIFYING" +
        " — do not implement business logic yet. The stub allowance will clear after the next test run.";
    } else if (phase === "specifying" && !passed) {
      setPhase("implementing", ctx);
    } else if (phase === "implementing" && passed) {
      setPhase("refactoring", ctx);
    }

    return { appendText };
  }

  // -- SPECIFYING phase: gate production code writes ------------------------

  pi.on("tool_call", async (event, ctx) => {
    if (phase !== "specifying") return undefined;

    let filePath: string | undefined;
    if (isToolCallEventType("write", event)) filePath = event.input.path;
    else if (isToolCallEventType("edit", event)) filePath = event.input.path;
    if (!filePath || !isProductionFile(filePath)) return undefined;

    if (stubAllowed) return undefined;

    if (ctx.hasUI) ctx.ui.notify("SPECIFYING: write a failing test first", "warning");
    return {
      block: true,
      reason: "TDD SPECIFYING phase: write a failing test before changing production code",
    };
  });

  // -- Auto-run tests after writes ------------------------------------------

  pi.on("tool_result", async (event, ctx) => {
    if (phase === "off" || event.isError) return;
    if (event.toolName !== "write" && event.toolName !== "edit") return;

    const filePath = getStringInput(event.input, "path");
    if (!filePath) return;

    if (isTestFile(filePath)) testEvidenceObserved = true;
    if (!shouldRunTests(phase, filePath)) return;
    if (phase === "specifying" && !testEvidenceObserved) return;

    const { passed, output, durationMs } = await runTests();
    const { appendText } = handleTestResult(passed, output, durationMs, ctx);

    const appended = [...event.content, { type: "text" as const, text: appendText }];
    return { content: appended };
  });

  // -- Warn on shell-based production writes during SPECIFYING --------------

  pi.on("tool_result", async (event, ctx) => {
    if (phase !== "specifying" || event.toolName !== "bash") return;

    const command = getStringInput(event.input, "command");
    if (!command) return;
    if (testCommand && command.includes(testCommand)) return;

    if (!detectsShellWritePattern(command)) return;

    const targets = extractRedirectTargets(command);
    if (targets.length > 0 && !targets.some((f) => isProductionFile(f))) return;

    const warning =
      "\n\n[TDD WARNING] This command appears to write to a production file during SPECIFYING." +
      " TDD best practice: write a failing test before modifying production code." +
      " This is a warning only — the command was not blocked.";

    if (ctx.hasUI) ctx.ui.notify("SPECIFYING: possible production write via shell", "warning");

    const appended = [...event.content, { type: "text" as const, text: warning }];
    return { content: appended };
  });

  // -- Detect manual test runs via bash -------------------------------------

  pi.on("tool_result", async (event, ctx) => {
    if (phase === "off" || event.toolName !== "bash") return;

    const command = getStringInput(event.input, "command");
    if (!command || !testCommand || !command.includes(testCommand)) return;

    testEvidenceObserved = true;

    const bashOutput = event.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("\n");

    const testPassed = !event.isError;
    const { appendText } = handleTestResult(testPassed, bashOutput, undefined, ctx);

    const appended = [...event.content, { type: "text" as const, text: appendText }];
    return { content: appended };
  });

  // -- REFACTORING -> SPECIFYING on new user turn ---------------------------

  pi.on("turn_start", async (_event, ctx) => {
    if (phase === "refactoring") setPhase("specifying", ctx);
  });

  // -- System prompt injection ----------------------------------------------

  pi.on("before_agent_start", async (event) => {
    return { systemPrompt: buildSystemPrompt(event.systemPrompt, phase, testCommand, testCwd) };
  });
}
