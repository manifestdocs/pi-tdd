import { describe, expect, it } from "vitest";
import {
  buildPostflightUserPrompt,
  formatPostflightResult,
  parsePostflightResponse,
  runPostflight,
} from "../src/postflight.ts";
import { PhaseStateMachine } from "../src/phase.ts";
import { resolveGuidelines } from "../src/guidelines.ts";
import type { TDDConfig } from "../src/types.ts";

function makeConfig(overrides: Partial<TDDConfig> = {}): TDDConfig {
  return {
    enabled: true,
    reviewModel: null,
    reviewProvider: null,
    reviewModels: {},
    autoTransition: true,
    refactorTransition: "user",
    allowReadInAllPhases: true,
    temperature: 0,
    maxDiffsInContext: 5,
    persistPhase: false,
    startInSpecMode: false,
    defaultEngaged: false,
    runPreflightOnRed: true,
    engageOnTools: [],
    disengageOnTools: [],
    guidelines: resolveGuidelines({}),
    ...overrides,
  };
}

describe("parsePostflightResponse", () => {
  it("parses a successful verdict", () => {
    const result = parsePostflightResponse('{"ok": true, "reason": "all good"}');
    expect(result).toEqual({ ok: true, reason: "all good" });
  });

  it("parses a failing verdict with item-scoped gaps", () => {
    const raw = JSON.stringify({
      ok: false,
      reason: "tests are too narrow",
      gaps: [
        { itemIndex: 2, message: "test only checks happy path" },
        { itemIndex: null, message: "missing integration coverage" },
      ],
    });
    const result = parsePostflightResponse(raw);
    expect(result).toEqual({
      ok: false,
      reason: "tests are too narrow",
      gaps: [
        { itemIndex: 2, message: "test only checks happy path" },
        { itemIndex: null, message: "missing integration coverage" },
      ],
    });
  });

  it("strips fenced JSON before parsing", () => {
    const raw = '```\n{"ok": true, "reason": "ok"}\n```';
    expect(parsePostflightResponse(raw)).toEqual({ ok: true, reason: "ok" });
  });

  it("throws on non-JSON responses", () => {
    expect(() => parsePostflightResponse("not json")).toThrow();
  });

  it("requires `ok` to be a boolean", () => {
    expect(() => parsePostflightResponse('{"ok": "true", "reason": "nope"}')).toThrow(/boolean/);
  });
});

describe("runPostflight early-return paths", () => {
  it("returns failure without calling the LLM when the last test failed", async () => {
    const machine = new PhaseStateMachine({ enabled: true, phase: "GREEN" });
    machine.recordTestResult("1 failed", true);
    const result = await runPostflight(
      { state: machine.getSnapshot() },
      {} as never,
      makeConfig()
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.gaps.length).toBeGreaterThan(0);
    }
  });
});

describe("buildPostflightUserPrompt", () => {
  it("includes recent test history with proof levels", () => {
    const machine = new PhaseStateMachine({ enabled: true, phase: "REFACTOR" });
    machine.recordTestResult("1 failed", true, "npm run test:unit", "unit");
    machine.recordTestResult("1 passed", false, "npm run test:integration", "integration");

    const prompt = buildPostflightUserPrompt({
      state: machine.getSnapshot(),
      userStory: "persist settings through the HTTP API",
    });

    expect(prompt).toContain("Recent test runs captured in this cycle:");
    expect(prompt).toContain("FAIL | UNIT | npm run test:unit");
    expect(prompt).toContain("PASS | INTEGRATION | npm run test:integration");
    expect(prompt).toContain("right level");
  });
});

describe("formatPostflightResult", () => {
  it("formats a successful result", () => {
    const text = formatPostflightResult({ ok: true, reason: "delivered" });
    expect(text).toContain("Post-flight OK");
    expect(text).toContain("delivered");
  });

  it("formats a failing result with gaps", () => {
    const text = formatPostflightResult({
      ok: false,
      reason: "two gaps",
      gaps: [
        { itemIndex: 1, message: "weak test" },
        { itemIndex: null, message: "missing edge case" },
      ],
    });
    expect(text).toContain("Post-flight found 2 gap(s)");
    expect(text).toContain("1. weak test");
    expect(text).toContain("• missing edge case");
  });
});
