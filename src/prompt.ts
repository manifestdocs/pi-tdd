export type Phase = "off" | "specifying" | "implementing" | "refactoring";

type ActivePhase = Exclude<Phase, "off">;

const TDD_OFF_PROMPT = [
  "[TDD MODE — OFF]",
  "TDD mode enforces test-driven development (specifying → implementing → refactoring). " +
    "Use it for new features, bug fixes, and changes to business logic. " +
    "This includes changing existing behavior when the intended result should be made " +
    "explicit in tests before changing implementation. " +
    "Before enabling TDD: scaffold only the config and dependencies needed to run tests " +
    "— create package manifests and runner config files, install the test framework, " +
    "and ensure the test command works (even if there are no tests yet). " +
    "Do not create source stubs or production modules before tdd_start unless the task " +
    "itself is scaffolding. Then call tdd_start to begin TDD. " +
    "Do not use TDD for config changes, documentation, scaffolding, or exploratory tasks.",
].join("\n");

const PHASE_GUIDANCE: Record<ActivePhase, string> = {
  specifying: [
    "Write a failing test for ONE user story or requirement at a time.",
    "Do not write tests for multiple stories in one cycle.",
    "After this test fails, you will implement just enough code to pass it,",
    "then return to SPECIFYING for the next story.",
    "Do not modify production code until a test exists and fails.",
    "Use standard test file naming",
    "(*.test.*, *.spec.*, *_test.*, *_spec.*, test_*.*,",
    "or files in __tests__/, test/, or tests/ directories).",
  ].join(" "),
  implementing: [
    "Write the smallest amount of code necessary for the CORRECT solution",
    "to a failing test. No extra functionality or refactoring yet.",
  ].join(" "),
  refactoring: [
    "Restructure code freely but keep all tests passing.",
    "No new behavior. If a change causes test failure, revert it immediately and try a different approach.",
    "Look for repeated patterns across classes/methods/functions/handlers and extract them.",
    "Deduplicate test fixtures and shared setup.",
    "When the task is complete and all tests pass,",
    "call tdd_done.",
  ].join(" "),
};

const SPECIFYING_TEST_SCOPE_TEXT = [
  "WHAT NOT TO TEST:",
  "- Test YOUR business logic, not library/framework behavior.",
  "- If a dependency is already tested independently, don't re-prove it.",
  "- Assert what your code does with the result, not that the library works.",
  "- Do not import or test internals of Pi, libraries, frameworks, CLIs, or APIs.",
  "- If validation is about packaging, publishing, installation, or runtime integration, " +
    "prefer a smoke check using the public interface, not a unit test in npm test.",
  "- Do not add tests for builds, GitHub Actions, CI/CD pipelines, or other support " +
    "systems unless that infrastructure itself is the thing being built or fixed.",
].join("\n");

const SPECIFYING_TEST_DOUBLES_TEXT = [
  "TEST DOUBLES:",
  "- Prefer tests that exercise real production code with minimal mocking.",
  "- Prefer the lightest test double that keeps the test honest.",
  "- For business logic, prefer small local fakes/stubs or injected dependencies over " +
    "broad module-level/framework mocks.",
  "- Use framework or module mocks mainly at external boundaries such as network, " +
    "filesystem, time, randomness, process environment, or third-party SDKs.",
  "- Avoid mocks that replace whole modules when a narrower fake or public-interface " + "smoke check is sufficient.",
  "- Do not introduce extra indirection solely to satisfy a testing pattern.",
].join("\n");

const SPECIFYING_TEST_ORG_TEXT = [
  "TEST ORGANIZATION:",
  "- One test file per module or unit under test. Split when a file covers a distinct " + "area of behavior.",
  "- Top-level group names the unit. Nest sub-groups for distinct scenarios. Keep " +
    "different behaviors in separate groups rather than combining them into one " +
    "parameterized block. (e.g. Vitest/Jest: nested describe(); Go: t.Run() subtests; " +
    "pytest: classes; Rust: mod tests with sub-mods.)",
  "- Use parameterized/table-driven tests for variations of the SAME behavior " +
    "(e.g. multiple input-output pairs). Use separate groups for DIFFERENT behaviors " +
    "(e.g. valid input vs error handling vs edge cases).",
  "- Each test describes the expected outcome, not the setup. Prefer " +
    "'returns 0 for empty list' over 'test empty list'.",
  "- Add to an existing test file when the new test covers the same unit. Create a " +
    "new file when it covers a different one.",
  "- Extract shared test setup (fixtures, helpers, factories) into a common location " +
    "rather than duplicating across test files. (e.g. Jest/Vitest: shared helper file; " +
    "pytest: conftest.py; Go: testutil package; RSpec: spec_helper.rb or shared_context.)",
].join("\n");

function formatTestCommandSection(testCommand: string, testCwd?: string): string {
  const cwdNote = testCwd ? `\nTest directory: ${testCwd}` : "";
  return `Test command: ${testCommand}${cwdNote}`;
}

function buildPhaseSections(phase: ActivePhase, testCommand: string, testCwd?: string): string[] {
  const sections = [
    `[TDD MODE — ${phase.toUpperCase()} PHASE]`,
    PHASE_GUIDANCE[phase],
    formatTestCommandSection(testCommand, testCwd),
  ];

  if (phase === "specifying") {
    sections.push(SPECIFYING_TEST_SCOPE_TEXT, SPECIFYING_TEST_DOUBLES_TEXT, SPECIFYING_TEST_ORG_TEXT);
  }

  return sections;
}

function appendPromptSections(base: string, sections: string[]): string {
  const parts = [base, ...sections].filter(Boolean);
  return parts.join("\n\n");
}

export function buildSystemPrompt(base: string, phase: Phase, testCommand?: string, testCwd?: string): string {
  if (phase === "off") {
    return appendPromptSections(base, [TDD_OFF_PROMPT]);
  }

  return appendPromptSections(base, buildPhaseSections(phase, testCommand ?? "", testCwd));
}
