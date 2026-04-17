import { describe, expect, it } from "vitest";

import { renderTestRunOverlay } from "../src/test-run-overlay.js";

const theme = {
  bold: (s: string) => s,
  fg: (_color: string, s: string) => s,
};

describe("renderTestRunOverlay", () => {
  it("renders a running shell-style panel", () => {
    const lines = renderTestRunOverlay(
      {
        command: "npm test",
        cwdLabel: "api",
        outputLines: [],
        running: true,
        spinnerFrame: "|",
      },
      theme,
      40,
    );

    expect(lines.some((line) => line.includes("$ npm test"))).toBe(true);
    expect(lines.some((line) => line.includes("RUNNING"))).toBe(true);
    expect(lines.some((line) => line.includes("in api"))).toBe(true);
    expect(lines.some((line) => line.includes("waiting for output..."))).toBe(true);
    expect(lines.every((line) => line.length <= 40)).toBe(true);
  });

  it("shows the most recent output lines with overflow context", () => {
    const lines = renderTestRunOverlay(
      {
        command: "bundle exec rspec",
        duration: "1.2s",
        outputLines: Array.from({ length: 11 }, (_, index) => `line ${index + 1}`),
        passed: true,
        running: false,
        spinnerFrame: "-",
      },
      theme,
      44,
    );

    expect(lines.some((line) => line.includes("PASS"))).toBe(true);
    expect(lines.some((line) => line.includes("1.2s"))).toBe(true);
    expect(lines.some((line) => line.includes("... 3 earlier lines"))).toBe(true);
    expect(lines.some((line) => line.includes("line 3"))).toBe(false);
    expect(lines.some((line) => line.includes("line 11"))).toBe(true);
  });
});
