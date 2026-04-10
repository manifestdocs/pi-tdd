import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { PROMPT_NAMES, loadPrompt, loadPromptList, resolvePromptUrl, type PromptName } from "../src/prompt-loader.ts";
import { PhaseStateMachine } from "../src/phase.ts";
import { buildSystemPrompt } from "../src/system-prompt.ts";
import { resolveGuidelines } from "../src/guidelines.ts";

const GREEN_IMPLEMENTATION_GUIDANCE =
  "Write the smallest correct implementation to pass the current failing unit or integration test.";
const GREEN_SCOPE_GUIDANCE =
  "Stay scoped to the current failing test. Save cleanup and broader changes for REFACTOR.";

describe("prompts", () => {
  it("loads every declared prompt file", () => {
    for (const name of PROMPT_NAMES) {
      expect(loadPrompt(name)).not.toBe("");
    }
  });

  it("resolves prompt paths from both src and dist module URLs", () => {
    const expected = "file:///repo/prompts/preflight-system.md";

    expect(resolvePromptUrl("preflight-system", "file:///repo/src/prompt-loader.ts").href).toBe(expected);
    expect(resolvePromptUrl("preflight-system", "file:///repo/dist/prompt-loader.js").href).toBe(expected);
  });

  it("loads bullet-list prompt files as plain guideline strings", () => {
    expect(loadPromptList("tool-engage-guidelines")).toEqual([
      "Call tdd_engage at the start of any feature or bug-fix work, before any code changes. Use phase='SPEC' if requirements need clarification, phase='RED' if you can write the first failing test immediately.",
      "Do NOT engage TDD for investigation, navigation, branch management, code review, or research. Stay dormant for non-feature work.",
      "When transitioning into RED, the pre-flight gate runs automatically and validates the spec checklist. If pre-flight fails, refine the spec before retrying.",
      "Call tdd_disengage when feature work is finished — post-flight will run automatically to verify the work delivered what was asked.",
    ]);
  });

  it("parses real markdown lists with headings and wrapped lines", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-tdd-prompts-"));
    mkdirSync(join(root, "prompts"));
    mkdirSync(join(root, "src"));
    writeFileSync(
      join(root, "prompts", "tool-engage-guidelines.md"),
      [
        "# Engage Tool",
        "",
        "- First guideline wraps",
        "  onto a second line.",
        "",
        "1. Second guideline uses numbered markdown.",
      ].join("\n")
    );

    const moduleUrl = pathToFileURL(join(root, "src", "prompt-loader.ts")).href;
    expect(loadPromptList("tool-engage-guidelines", moduleUrl)).toEqual([
      "First guideline wraps onto a second line.",
      "Second guideline uses numbered markdown.",
    ]);
  });

  it("rejects prompt-list files that contain stray prose", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-tdd-prompts-"));
    mkdirSync(join(root, "prompts"));
    mkdirSync(join(root, "src"));
    writeFileSync(
      join(root, "prompts", "tool-engage-guidelines.md"),
      [
        "# Engage Tool",
        "",
        "This sentence is not a markdown list item.",
      ].join("\n")
    );

    const moduleUrl = pathToFileURL(join(root, "src", "prompt-loader.ts")).href;
    expect(() => loadPromptList("tool-engage-guidelines", moduleUrl)).toThrow(/must contain markdown list items/);
  });

  it("throws a targeted error when a prompt file is missing", () => {
    expect(() => loadPrompt("missing-prompt" as PromptName)).toThrow(/Failed to load prompt "missing-prompt"/);
    expect(() => loadPrompt("missing-prompt" as PromptName)).toThrow(/missing-prompt\.md/);
  });

  it("keeps GREEN guidance aligned across the phase machine, system prompt, and skill", () => {
    const machine = new PhaseStateMachine({ enabled: true, phase: "GREEN" });
    const prompt = buildSystemPrompt(machine, {
      enabled: true,
      reviewModel: null,
      reviewProvider: null,
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
    });
    const skill = readFileSync("skills/pi-tdd/SKILL.md", "utf8");

    expect(machine.allowedActions()).toContain(GREEN_IMPLEMENTATION_GUIDANCE);
    expect(prompt).toContain("Write the smallest correct implementation for the behavior the failing test asserts.");
    expect(prompt).toContain(GREEN_SCOPE_GUIDANCE);
    expect(skill).toContain("- Write the smallest correct code for the behavior the failing test asserts.");
    expect(skill).toContain(`- ${GREEN_SCOPE_GUIDANCE}`);
  });

  it("keeps the built-in prompt markdown focused on TDD workflow instead of coding style", () => {
    expect(loadPrompt("guidelines-green")).toContain("Implement only the behavior required to make the current failing test pass.");
    expect(loadPrompt("guidelines-red")).toContain("Use unit tests for isolated logic and integration tests for boundaries, contracts, or wiring.");
    expect(loadPrompt("guidelines-spec")).toContain("unit test, an integration test, or both");
    expect(loadPrompt("guidelines-green")).not.toContain("Favor pure functions");
    expect(loadPrompt("guidelines-green")).not.toContain("Functions: 25-30 lines max");
    expect(loadPrompt("guidelines-refactor")).not.toContain("Unix philosophy");
    expect(loadPrompt("guidelines-universal")).toContain("AGENTS.md");
  });

  it("does not inject repository-author coding-style guidance into the system prompt", () => {
    const machine = new PhaseStateMachine({ enabled: true, phase: "REFACTOR" });
    const prompt = buildSystemPrompt(machine, {
      enabled: true,
      reviewModel: null,
      reviewProvider: null,
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
    });

    expect(prompt).not.toContain("coding guidelines");
    expect(prompt).toContain("Refine the code from this cycle without changing behavior");
  });

  it("keeps the postflight prompt focused on spec delivery and project fit", () => {
    const postflight = loadPrompt("postflight-system");

    expect(postflight).toContain("delivered what its spec asked for and fits the project it was added to");
    expect(postflight).toContain("The proving tests are at the right level for the behavior");
    expect(postflight).toContain("repository's documented instructions, established code patterns, or chosen tech stack");
    expect(postflight).toContain("not justified by the user request or the spec");
    expect(postflight).not.toContain("NOT to police whether the implementation was minimal");
  });

  it("teaches preflight to reason about proof level", () => {
    const preflight = loadPrompt("preflight-system");

    expect(preflight).toContain("whether unit proof, integration proof, or both are needed");
    expect(preflight).toContain("Boundary-heavy items should usually be provable with integration tests");
  });
});
