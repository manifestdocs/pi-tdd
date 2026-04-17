import { truncateToWidth } from "@mariozechner/pi-tui";
import type { TestSummary } from "./parsers.js";
import type { Phase } from "./prompt.js";
import { renderTestRunOverlay, type TestRunSnapshot } from "./test-run-overlay.js";

export interface WidgetTheme {
  bold(s: string): string;
  fg(color: string, s: string): string;
}

export interface WidgetSnapshot {
  activeTestRun: TestRunSnapshot | undefined;
  cycleCount: number;
  phase: Phase;
  summary: TestSummary | undefined;
}

function getPhaseColor(phase: Phase): "accent" | "error" | "success" {
  switch (phase) {
    case "implementing":
      return "accent";
    case "refactoring":
      return "success";
    default:
      return "error";
  }
}

export function renderWidget(snap: WidgetSnapshot, theme: WidgetTheme, width: number): string[] {
  const lines: string[] = [];
  const maxName = width - 8;
  const phaseLabel = theme.bold(theme.fg(getPhaseColor(snap.phase), snap.phase.toUpperCase()));
  const cycleLabel = snap.cycleCount > 0 ? theme.fg("dim", ` cycle ${snap.cycleCount}`) : "";

  if (snap.activeTestRun) {
    lines.push(...renderTestRunOverlay(snap.activeTestRun, theme, width));
    lines.push("");
  }

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

  const sortedTests = [...snap.summary.tests].sort((left, right) => Number(left.passed) - Number(right.passed));
  const displayedTests = sortedTests.slice(0, 7);

  for (const test of displayedTests) {
    const icon = test.passed ? theme.fg("success", "\u2714") : theme.fg("error", "\u2717");
    lines.push(`  ${icon} ${truncateToWidth(test.name, maxName)}`);
  }

  if (snap.summary.tests.length > displayedTests.length) {
    lines.push(theme.fg("dim", `  ... ${snap.summary.tests.length - displayedTests.length} more`));
  }

  return lines;
}
