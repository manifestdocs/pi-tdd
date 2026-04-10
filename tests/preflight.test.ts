import { describe, expect, it } from "vitest";
import {
  buildPreflightUserPrompt,
  formatPreflightResult,
  parsePreflightResponse,
  runPreflight,
} from "../src/preflight.ts";
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

describe("parsePreflightResponse", () => {
  it("parses a successful verdict", () => {
    const result = parsePreflightResponse('{"ok": true, "reason": "spec is solid"}');
    expect(result).toEqual({ ok: true, reason: "spec is solid" });
  });

  it("parses a failing verdict with item-scoped issues", () => {
    const raw = JSON.stringify({
      ok: false,
      reason: "two items are vague",
      issues: [
        { itemIndex: 1, message: "needs an observable assertion" },
        { itemIndex: null, message: "spec misses the error path" },
      ],
    });
    const result = parsePreflightResponse(raw);
    expect(result).toEqual({
      ok: false,
      reason: "two items are vague",
      issues: [
        { itemIndex: 1, message: "needs an observable assertion" },
        { itemIndex: null, message: "spec misses the error path" },
      ],
    });
  });

  it("strips fenced JSON before parsing", () => {
    const raw = '```json\n{"ok": true, "reason": "ok"}\n```';
    expect(parsePreflightResponse(raw)).toEqual({ ok: true, reason: "ok" });
  });

  it("throws on non-JSON responses", () => {
    expect(() => parsePreflightResponse("not json at all")).toThrow();
  });

  it("requires `ok` to be a boolean", () => {
    expect(() => parsePreflightResponse('{"ok": "false", "reason": "nope"}')).toThrow(/boolean/);
  });

  it("ignores malformed issue entries", () => {
    const raw = JSON.stringify({
      ok: false,
      reason: "mixed",
      issues: [
        { itemIndex: 1, message: "fine" },
        { itemIndex: 2 }, // missing message — dropped
        "string-issue", // not an object — dropped
        { itemIndex: 3, message: "also fine" },
      ],
    });
    const result = parsePreflightResponse(raw);
    if (result.ok) {
      throw new Error("expected failing verdict");
    }
    expect(result.issues).toHaveLength(2);
    expect(result.issues.map((i) => i.itemIndex)).toEqual([1, 3]);
  });
});

describe("runPreflight early-return paths", () => {
  it("returns failure without calling the LLM when the spec is empty", async () => {
    const result = await runPreflight(
      { spec: [] },
      // ctx is unused in the empty path
      {} as never,
      makeConfig()
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.length).toBeGreaterThan(0);
    }
  });
});

describe("buildPreflightUserPrompt", () => {
  it("asks the reviewer to reason about unit versus integration proof", () => {
    const prompt = buildPreflightUserPrompt({
      userStory: "save settings through the HTTP API",
      spec: ["persists a valid settings update"],
    });

    expect(prompt).toContain("unit test, an integration test, or both");
    expect(prompt).toContain("Boundary-heavy behavior should usually be provable with integration-level tests");
  });
});

describe("formatPreflightResult", () => {
  it("formats a successful result", () => {
    const text = formatPreflightResult({ ok: true, reason: "spec is solid" });
    expect(text).toContain("Pre-flight OK");
    expect(text).toContain("spec is solid");
  });

  it("formats a failing result with item-scoped issues", () => {
    const text = formatPreflightResult({
      ok: false,
      reason: "two issues",
      issues: [
        { itemIndex: 1, message: "needs assertion" },
        { itemIndex: null, message: "general gap" },
      ],
    });
    expect(text).toContain("Pre-flight found 2 issue(s)");
    expect(text).toContain("1. needs assertion");
    expect(text).toContain("• general gap");
  });
});
