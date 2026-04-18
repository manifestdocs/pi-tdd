import { spawn } from "node:child_process";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

const ANSI_RE = /\x1b\[[0-9;]*m/g;
export const TEST_RUN_SPINNER_FRAMES = ["-", "\\", "|", "/"];
export const TEST_RUN_MAX_OUTPUT_LINES = 8;
export const TEST_RUN_MIN_VISIBLE_MS = 300;
export const TEST_RUN_PASS_DISMISS_MS = 250;
export const TEST_RUN_FAIL_DISMISS_MS = 700;
const FRAME_LEFT = "│";
const FRAME_RIGHT = "│";
const FRAME_TOP_LEFT = "┌";
const FRAME_TOP_RIGHT = "┐";
const FRAME_BOTTOM_LEFT = "└";
const FRAME_BOTTOM_RIGHT = "┘";
const FRAME_HORIZONTAL = "─";

export interface TestRunTheme {
  bold(s: string): string;
  fg(color: string, s: string): string;
}

export interface TestRunSnapshot {
  command: string;
  cwdLabel?: string;
  duration?: string;
  outputLines: string[];
  passed?: boolean;
  running: boolean;
  spinnerFrame: string;
}

interface TestRunResult {
  durationMs: number;
  output: string;
  passed: boolean;
}

function buildShellCommand(command: string): { command: string; args: string[] } {
  if (process.platform === "win32") {
    return {
      command: process.env.ComSpec ?? "cmd.exe",
      args: ["/d", "/s", "/c", command],
    };
  }

  return {
    command: process.env.SHELL ?? "sh",
    args: ["-lc", command],
  };
}

function frameLine(content: string, innerWidth: number, theme: TestRunTheme): string {
  const clipped = truncateToWidth(content, innerWidth);
  const padding = Math.max(0, innerWidth - visibleWidth(clipped));
  const leftBorder = theme.fg("borderMuted", FRAME_LEFT);
  const rightBorder = theme.fg("borderMuted", FRAME_RIGHT);
  return `${leftBorder} ${clipped}${" ".repeat(padding)} ${rightBorder}`;
}

export function renderTestRunOverlay(snap: TestRunSnapshot, theme: TestRunTheme, width: number): string[] {
  const innerWidth = Math.max(1, width - 4);
  const topBorder = theme.fg(
    "borderMuted",
    `${FRAME_TOP_LEFT}${FRAME_HORIZONTAL.repeat(innerWidth + 2)}${FRAME_TOP_RIGHT}`,
  );
  const bottomBorder = theme.fg(
    "borderMuted",
    `${FRAME_BOTTOM_LEFT}${FRAME_HORIZONTAL.repeat(innerWidth + 2)}${FRAME_BOTTOM_RIGHT}`,
  );
  const lines = [topBorder];
  const statusColor = snap.running ? "accent" : snap.passed ? "success" : "error";
  const statusLabel = snap.running ? `${snap.spinnerFrame} RUNNING` : snap.passed ? "PASS" : "FAIL";
  const statusParts = [theme.bold(theme.fg(statusColor, statusLabel))];

  if (snap.duration) {
    statusParts.push(theme.fg("dim", snap.duration));
  }

  lines.push(frameLine(theme.fg("bashMode", `$ ${snap.command}`), innerWidth, theme));
  lines.push(frameLine(statusParts.join(` ${theme.fg("dim", "|")} `), innerWidth, theme));

  if (snap.cwdLabel) {
    lines.push(frameLine(theme.fg("dim", `in ${snap.cwdLabel}`), innerWidth, theme));
  }

  lines.push(frameLine("", innerWidth, theme));

  const visibleOutput = snap.outputLines.slice(-TEST_RUN_MAX_OUTPUT_LINES);
  const hiddenLineCount = snap.outputLines.length - visibleOutput.length;

  if (hiddenLineCount > 0) {
    lines.push(frameLine(theme.fg("dim", `... ${hiddenLineCount} earlier lines`), innerWidth, theme));
  }

  if (visibleOutput.length === 0) {
    const emptyState = snap.running ? "waiting for output..." : "no output";
    lines.push(frameLine(theme.fg("dim", emptyState), innerWidth, theme));
  } else {
    for (const outputLine of visibleOutput) {
      const line = outputLine.length > 0 ? theme.fg("muted", outputLine) : "";
      lines.push(frameLine(line, innerWidth, theme));
    }
  }

  lines.push(bottomBorder);
  return lines;
}

export function appendTestRunOutput(outputLines: string[], chunk: string): string[] {
  const nextLines = [...outputLines];
  const cleanChunk = chunk.replace(ANSI_RE, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const newLines = cleanChunk.split("\n");

  if (nextLines.length > 0 && newLines.length > 0) {
    nextLines[nextLines.length - 1] += newLines[0];
    nextLines.push(...newLines.slice(1));
  } else {
    nextLines.push(...newLines);
  }

  return nextLines;
}

async function executeTestCommand(
  command: string,
  cwd: string | undefined,
  onChunk?: (chunk: string) => void,
): Promise<TestRunResult> {
  const startedAt = Date.now();
  const shell = buildShellCommand(command);

  return new Promise((resolve) => {
    const outputChunks: string[] = [];
    let settled = false;

    const finish = (passed: boolean) => {
      if (settled) return;
      settled = true;
      resolve({
        durationMs: Date.now() - startedAt,
        output: outputChunks.join(""),
        passed,
      });
    };

    const child = spawn(shell.command, shell.args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const handleChunk = (chunk: string | Buffer) => {
      const text = chunk.toString();
      outputChunks.push(text);
      onChunk?.(text);
    };

    child.stdout?.on("data", handleChunk);
    child.stderr?.on("data", handleChunk);
    child.on("error", (error) => {
      handleChunk(`${error.message}\n`);
      finish(false);
    });
    child.on("close", (code) => finish(code === 0));
  });
}

export async function runTestCommand(
  command: string,
  cwd?: string,
  onChunk?: (chunk: string) => void,
): Promise<TestRunResult> {
  return executeTestCommand(command, cwd, onChunk);
}
