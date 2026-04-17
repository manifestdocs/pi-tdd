import { describe, expect, it } from "vitest";

import { buildSystemPrompt } from "../src/prompt.js";

describe("buildSystemPrompt", () => {
  it("keeps the off prompt focused on when not to use TDD", () => {
    const prompt = buildSystemPrompt("BASE", "off");

    expect(prompt).toContain("[TDD MODE — OFF]");
    expect(prompt).toContain("Do not use TDD for config changes, documentation, scaffolding, or exploratory tasks.");
    expect(prompt).not.toContain("WHAT NOT TO TEST:");
    expect(prompt).not.toContain("TEST ORGANIZATION:");
  });

  it("includes test scope and organization only during specifying", () => {
    const prompt = buildSystemPrompt("BASE", "specifying", "npm test", "/repo/app");

    expect(prompt).toContain("[TDD MODE — SPECIFYING PHASE]");
    expect(prompt).toContain("Test command: npm test");
    expect(prompt).toContain("Test directory: /repo/app");
    expect(prompt).toContain("WHAT NOT TO TEST:");
    expect(prompt).toContain("TEST ORGANIZATION:");
    expect(prompt.match(/WHAT NOT TO TEST:/g)).toHaveLength(1);
    expect(prompt.match(/TEST ORGANIZATION:/g)).toHaveLength(1);

    const testCommandIndex = prompt.indexOf("Test command: npm test");
    const testScopeIndex = prompt.indexOf("WHAT NOT TO TEST:");
    const testOrgIndex = prompt.indexOf("TEST ORGANIZATION:");
    expect(testCommandIndex).toBeGreaterThan(-1);
    expect(testScopeIndex).toBeGreaterThan(testCommandIndex);
    expect(testOrgIndex).toBeGreaterThan(testScopeIndex);
  });

  it("keeps implementing focused on production code only", () => {
    const prompt = buildSystemPrompt("BASE", "implementing", "npm test");

    expect(prompt).toContain("[TDD MODE — IMPLEMENTING PHASE]");
    expect(prompt).toContain("Write a MINIMAL and CORRECT production code solution");
    expect(prompt).toContain("Test command: npm test");
    expect(prompt).not.toContain("WHAT NOT TO TEST:");
    expect(prompt).not.toContain("TEST ORGANIZATION:");
  });

  it("keeps refactoring focused on restructuring only", () => {
    const prompt = buildSystemPrompt("BASE", "refactoring", "npm test");

    expect(prompt).toContain("[TDD MODE — REFACTORING PHASE]");
    expect(prompt).toContain("Restructure code freely but keep all tests passing.");
    expect(prompt).toContain("Test command: npm test");
    expect(prompt).not.toContain("WHAT NOT TO TEST:");
    expect(prompt).not.toContain("TEST ORGANIZATION:");
  });
});
