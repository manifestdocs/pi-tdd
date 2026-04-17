import { describe, expect, it } from "vitest";

import { renderWidget } from "../src/tdd-widget.js";

const theme = {
  bold: (s: string) => s,
  fg: (_color: string, s: string) => s,
};

describe("renderWidget", () => {
  it("renders the active test run panel above the TDD summary", () => {
    const lines = renderWidget(
      {
        activeTestRun: {
          command: "npm test",
          outputLines: ["running spec"],
          running: true,
          spinnerFrame: "|",
        },
        cycleCount: 1,
        phase: "implementing",
        summary: {
          failed: 1,
          passed: 0,
          tests: [{ name: "adds two numbers", passed: false }],
        },
      },
      theme,
      52,
    );

    expect(lines[0]).toContain("┌");
    expect(lines.some((line) => line.includes("$ npm test"))).toBe(true);
    expect(lines.some((line) => line.includes("running spec"))).toBe(true);
    expect(lines.some((line) => line.includes("TDD IMPLEMENTING cycle 1"))).toBe(true);
  });
});
