import * as path from "node:path";
import type { TextContent } from "@mariozechner/pi-ai";
import type { ExtensionContext, ToolResultEvent } from "@mariozechner/pi-coding-agent";

import { isProductionFile, isTestFile } from "./file-classification.js";
import { formatDuration, type TestSummary } from "./parsers.js";
import { buildSystemPrompt, type Phase } from "./prompt.js";
import { detectsShellWritePattern, extractRedirectTargets } from "./shell-detection.js";
import { evaluateTestResult, getStringInput, shouldRunTests } from "./tdd-state.js";
import { renderWidget } from "./tdd-widget.js";
import { resolveTestConfig } from "./test-config.js";
import {
  appendTestRunOutput,
  runTestCommand,
  TEST_RUN_FAIL_DISMISS_MS,
  TEST_RUN_MIN_VISIBLE_MS,
  TEST_RUN_PASS_DISMISS_MS,
  TEST_RUN_SPINNER_FRAMES,
  type TestRunSnapshot,
} from "./test-run-overlay.js";

interface ToolCallMutation {
  block?: boolean;
  reason?: string;
}

interface ToolResultMutation {
  content?: ToolResultEvent["content"];
  details?: unknown;
}

function appendTextContent(content: ToolResultEvent["content"], text: string): ToolResultMutation {
  return { content: [...content, { type: "text", text }] };
}

function joinTextContent(content: ToolResultEvent["content"]): string {
  return content
    .filter((item): item is TextContent => item.type === "text")
    .map((item) => item.text)
    .join("\n");
}

export function createTddController() {
  let activeTestRun: TestRunSnapshot | undefined;
  let activeTestRunShownAt = 0;
  let activeTestRunDismissTimer: ReturnType<typeof setTimeout> | undefined;
  let activeTestRunSpinnerTimer: ReturnType<typeof setInterval> | undefined;
  let cycleCount = 0;
  let lastSummary: TestSummary | undefined;
  let lastWidgetCtx: ExtensionContext | undefined;
  let phase: Phase = "off";
  let stubAllowed = false;
  let testCommand: string | undefined;
  let testCwd: string | undefined;
  let testEvidenceObserved = false;

  async function runTests(ctx: ExtensionContext): Promise<{
    durationMs: number;
    output: string;
    passed: boolean;
  }> {
    if (!testCommand) {
      return {
        durationMs: 0,
        output: "No test command configured",
        passed: true,
      };
    }

    const cwdLabel = testCwd && testCwd !== ctx.cwd ? path.basename(testCwd) : undefined;
    beginActiveTestRun(testCommand, cwdLabel, ctx);

    const result = await runTestCommand(testCommand, testCwd, (chunk) => appendActiveTestRunOutput(chunk, ctx));
    finishActiveTestRun(result.passed, result.durationMs, ctx);
    return result;
  }

  function updateWidget(ctx: ExtensionContext) {
    if (!ctx.hasUI) return;
    lastWidgetCtx = ctx;

    if (phase === "off") {
      ctx.ui.setWidget("tdd", undefined);
      return;
    }

    ctx.ui.setWidget("tdd", (_tui, theme) => ({
      invalidate() {},
      render: (width: number) => renderWidget({ activeTestRun, cycleCount, phase, summary: lastSummary }, theme, width),
    }));
  }

  function stopActiveTestRunTimers() {
    if (activeTestRunDismissTimer) {
      clearTimeout(activeTestRunDismissTimer);
      activeTestRunDismissTimer = undefined;
    }

    if (activeTestRunSpinnerTimer) {
      clearInterval(activeTestRunSpinnerTimer);
      activeTestRunSpinnerTimer = undefined;
    }
  }

  function clearActiveTestRun(ctx?: ExtensionContext) {
    stopActiveTestRunTimers();
    activeTestRun = undefined;
    if (ctx) updateWidget(ctx);
    else if (lastWidgetCtx) updateWidget(lastWidgetCtx);
  }

  function beginActiveTestRun(command: string, cwdLabel: string | undefined, ctx: ExtensionContext) {
    stopActiveTestRunTimers();
    activeTestRunShownAt = Date.now();
    activeTestRun = {
      command,
      cwdLabel,
      outputLines: [],
      running: true,
      spinnerFrame: TEST_RUN_SPINNER_FRAMES[0],
    };

    if (ctx.hasUI) {
      activeTestRunSpinnerTimer = setInterval(() => {
        if (!activeTestRun?.running || !lastWidgetCtx) return;
        const currentIndex = TEST_RUN_SPINNER_FRAMES.indexOf(activeTestRun.spinnerFrame);
        const nextIndex = (currentIndex + 1) % TEST_RUN_SPINNER_FRAMES.length;
        activeTestRun = { ...activeTestRun, spinnerFrame: TEST_RUN_SPINNER_FRAMES[nextIndex] };
        updateWidget(lastWidgetCtx);
      }, 80);
    }

    updateWidget(ctx);
  }

  function appendActiveTestRunOutput(chunk: string, ctx: ExtensionContext) {
    if (!activeTestRun) return;
    activeTestRun = {
      ...activeTestRun,
      outputLines: appendTestRunOutput(activeTestRun.outputLines, chunk),
    };
    updateWidget(ctx);
  }

  function finishActiveTestRun(passed: boolean, durationMs: number, ctx: ExtensionContext) {
    if (!activeTestRun) return;

    if (activeTestRunSpinnerTimer) {
      clearInterval(activeTestRunSpinnerTimer);
      activeTestRunSpinnerTimer = undefined;
    }

    activeTestRun = {
      ...activeTestRun,
      duration: formatDuration(durationMs),
      passed,
      running: false,
    };
    updateWidget(ctx);

    const visibleDelay = Math.max(0, TEST_RUN_MIN_VISIBLE_MS - (Date.now() - activeTestRunShownAt));
    const completionDelay = passed ? TEST_RUN_PASS_DISMISS_MS : TEST_RUN_FAIL_DISMISS_MS;
    activeTestRunDismissTimer = setTimeout(() => clearActiveTestRun(ctx), visibleDelay + completionDelay);
  }

  function setPhase(next: Phase, ctx: ExtensionContext) {
    if (next === "specifying" && phase === "refactoring") cycleCount++;

    if (next === "specifying") {
      stubAllowed = false;
      testEvidenceObserved = false;
    }

    if (next === "off") {
      clearActiveTestRun(ctx);
      cycleCount = 0;
      lastSummary = undefined;
      stubAllowed = false;
    }

    phase = next;
    ctx.ui.setStatus("tdd", phase === "off" ? "" : `TDD: ${phase.toUpperCase()}`);
    updateWidget(ctx);
  }

  function applyTestResult(result: ReturnType<typeof evaluateTestResult>, ctx: ExtensionContext) {
    lastSummary = result.summary;
    updateWidget(ctx);

    if (result.testEvidenceObserved) {
      testEvidenceObserved = true;
    }

    stubAllowed = result.stubAllowed;

    if (result.nextPhase) {
      setPhase(result.nextPhase, ctx);
    }
  }

  return {
    getPhase() {
      return phase;
    },

    async enable(ctx: ExtensionContext): Promise<string> {
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

      cycleCount = 1;
      lastSummary = undefined;
      testCommand = config.command;
      testCwd = config.cwd;
      setPhase("specifying", ctx);

      const label = testCwd !== ctx.cwd ? ` in ${path.basename(testCwd)}` : "";
      ctx.ui.notify(`TDD on${label} \u2014 specify behavior in a test`);

      let message =
        `TDD enabled \u2014 SPECIFYING phase. ` +
        `Specify the next behavior in a test before changing production code.\n` +
        `Test command: ${testCommand}${label}`;
      if (config.command === "pytest") {
        message +=
          '\nHint: add pythonpath = ["."] under [tool.pytest.ini_options] in pyproject.toml so pytest can import your modules.';
      }

      return message;
    },

    disable(ctx: ExtensionContext): string {
      if (phase === "off") return "TDD is already off";

      testCwd = undefined;
      setPhase("off", ctx);
      ctx.ui.notify("TDD off");
      return "TDD disabled";
    },

    handleProductionWrite(filePath: string, ctx: ExtensionContext): ToolCallMutation | undefined {
      if (phase !== "specifying" || !isProductionFile(filePath) || stubAllowed) return undefined;

      if (ctx.hasUI) ctx.ui.notify("SPECIFYING: specify behavior in a test before editing production code", "warning");
      return {
        block: true,
        reason: "TDD SPECIFYING phase: specify the next behavior in a test before changing production code",
      };
    },

    async handleFileToolResult(event: ToolResultEvent, ctx: ExtensionContext): Promise<ToolResultMutation | undefined> {
      if (phase === "off" || event.isError) return undefined;
      if (event.toolName !== "write" && event.toolName !== "edit") return undefined;

      const filePath = getStringInput(event.input, "path");
      if (!filePath) return undefined;

      if (isTestFile(filePath)) testEvidenceObserved = true;
      if (!shouldRunTests(phase, filePath)) return undefined;
      if (phase === "specifying" && !testEvidenceObserved) return undefined;

      const result = evaluateTestResult({ phase, ...(await runTests(ctx)) });
      applyTestResult(result, ctx);
      return appendTextContent(event.content, result.appendText);
    },

    handleShellWriteWarning(event: ToolResultEvent, ctx: ExtensionContext): ToolResultMutation | undefined {
      if (phase !== "specifying" || event.toolName !== "bash") return undefined;

      const command = getStringInput(event.input, "command");
      if (!command) return undefined;
      if (testCommand && command.includes(testCommand)) return undefined;
      if (!detectsShellWritePattern(command)) return undefined;

      const targets = extractRedirectTargets(command);
      if (targets.length > 0 && !targets.some((target) => isProductionFile(target))) return undefined;

      if (ctx.hasUI) ctx.ui.notify("SPECIFYING: possible production write via shell", "warning");

      const warning =
        "\n\n[TDD WARNING] This command appears to write to a production file during SPECIFYING." +
        " TDD best practice: specify the next behavior in a test before modifying production code." +
        " This is a warning only — the command was not blocked.";

      return appendTextContent(event.content, warning);
    },

    handleManualTestRun(event: ToolResultEvent, ctx: ExtensionContext): ToolResultMutation | undefined {
      if (phase === "off" || event.toolName !== "bash") return undefined;

      const command = getStringInput(event.input, "command");
      if (!command || !testCommand || !command.includes(testCommand)) return undefined;

      testEvidenceObserved = true;

      const result = evaluateTestResult({
        output: joinTextContent(event.content),
        passed: !event.isError,
        phase,
      });

      applyTestResult(result, ctx);
      return appendTextContent(event.content, result.appendText);
    },

    handleTurnStart(ctx: ExtensionContext) {
      if (phase === "refactoring") {
        setPhase("specifying", ctx);
      }
    },

    buildSystemPrompt(basePrompt: string) {
      return buildSystemPrompt(basePrompt, phase, testCommand, testCwd);
    },
  };
}
