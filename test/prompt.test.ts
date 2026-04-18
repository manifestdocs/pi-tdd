import { describe, expect, it } from "vitest";

import { buildSystemPrompt } from "../src/prompt.js";

describe("buildSystemPrompt", () => {
  it("keeps the off prompt focused on when not to use TDD", () => {
    const prompt = buildSystemPrompt("BASE", "off");

    expect(prompt).toContain("[TDD MODE — OFF]");
    expect(prompt).toContain("Use it for new features, bug fixes, and changes to business logic.");
    expect(prompt).toContain("made explicit in tests before changing implementation.");
    expect(prompt).toContain("scaffold only the config and dependencies needed to run tests");
    expect(prompt).toContain("Do not create source stubs or production modules before tdd_start");
    expect(prompt).toContain("Do not use TDD for config changes, documentation, scaffolding, or exploratory tasks.");
    expect(prompt).not.toContain("feature or bug fix work");
    expect(prompt).not.toContain("lock behavior");
    expect(prompt).not.toContain("This is different from the REFACTORING phase inside TDD");
    expect(prompt).not.toContain("substantial changes to existing behavior");
    expect(prompt).not.toContain("WHAT NOT TO TEST:");
    expect(prompt).not.toContain("TEST DOUBLES:");
    expect(prompt).not.toContain("TEST ORGANIZATION:");
  });

  it("includes test scope and organization only during specifying", () => {
    const prompt = buildSystemPrompt("BASE", "specifying", "npm test", "/repo/app");

    expect(prompt).toContain("[TDD MODE — SPECIFYING PHASE]");
    expect(prompt).toContain("Test command: npm test");
    expect(prompt).toContain("Test directory: /repo/app");
    expect(prompt).toContain("WHAT NOT TO TEST:");
    expect(prompt).toContain("TEST DOUBLES:");
    expect(prompt).toContain("TEST ORGANIZATION:");
    expect(prompt.match(/WHAT NOT TO TEST:/g)).toHaveLength(1);
    expect(prompt.match(/TEST DOUBLES:/g)).toHaveLength(1);
    expect(prompt.match(/TEST ORGANIZATION:/g)).toHaveLength(1);

    const testCommandIndex = prompt.indexOf("Test command: npm test");
    const testScopeIndex = prompt.indexOf("WHAT NOT TO TEST:");
    const testDoublesIndex = prompt.indexOf("TEST DOUBLES:");
    const testOrgIndex = prompt.indexOf("TEST ORGANIZATION:");
    expect(testCommandIndex).toBeGreaterThan(-1);
    expect(testScopeIndex).toBeGreaterThan(testCommandIndex);
    expect(testDoublesIndex).toBeGreaterThan(testScopeIndex);
    expect(testOrgIndex).toBeGreaterThan(testDoublesIndex);
  });

  it("keeps implementing focused on production code only", () => {
    const prompt = buildSystemPrompt("BASE", "implementing", "npm test");

    expect(prompt).toContain("[TDD MODE — IMPLEMENTING PHASE]");
    expect(prompt).toContain("Write the smallest amount of code necessary for the CORRECT solution");
    expect(prompt).toContain("Test command: npm test");
    expect(prompt).not.toContain("WHAT NOT TO TEST:");
    expect(prompt).not.toContain("TEST DOUBLES:");
    expect(prompt).not.toContain("TEST ORGANIZATION:");
  });

  it("keeps refactoring focused on restructuring only", () => {
    const prompt = buildSystemPrompt("BASE", "refactoring", "npm test");

    expect(prompt).toContain("[TDD MODE — REFACTORING PHASE]");
    expect(prompt).toContain("Restructure code freely but keep all tests passing.");
    expect(prompt).toContain("Test command: npm test");
    expect(prompt).not.toContain("WHAT NOT TO TEST:");
    expect(prompt).not.toContain("TEST DOUBLES:");
    expect(prompt).not.toContain("TEST ORGANIZATION:");
  });
});
