import { describe, expect, it } from "vitest";
import { DEFAULTS, resolveGuidelines } from "../src/guidelines.ts";

describe("resolveGuidelines", () => {
  it("maps legacy plan overrides onto spec", () => {
    const guidelines = resolveGuidelines({ plan: "legacy spec" });
    expect(guidelines.spec).toBe("legacy spec");
  });

  it("preserves explicit null overrides for spec", () => {
    const guidelines = resolveGuidelines({ spec: null });
    expect(guidelines.spec).toBeNull();
  });

  it("uses defaults when spec is omitted", () => {
    const guidelines = resolveGuidelines({});
    expect(guidelines.spec).toBe(DEFAULTS.spec);
  });

  it("does not inject security guidance by default", () => {
    const guidelines = resolveGuidelines({});
    expect(guidelines.security).toBeNull();
  });
});
