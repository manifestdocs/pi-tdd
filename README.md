# pi-tdd

A minimal TDD extension for [Pi](https://pi.dev), the terminal coding agent. Enforces **specifying-implementing-refactoring** sequencing when activated via `/tdd`. Off by default. No configuration beyond a test command.


---

**Table of contents**

- [Quick start](#quick-start)
- [What is TDD?](#what-is-tdd)
- [Why this matters for coding agents](#why-this-matters-for-coding-agents)
- [How it works](#how-it-works)
- [Phase details](#phase-details)
- [Test command inference](#test-command-inference)
- [Test file detection](#test-file-detection)
- [Test output parsing](#test-output-parsing)
- [HUD widget](#hud-widget)
- [Limits](#limits)
- [License](#license)

---

## Quick start

### 1. Install Pi

```bash
npm install -g @mariozechner/pi-coding-agent
```

Launch Pi and authenticate:

```bash
pi
```

### 2. Install pi-tdd

**From Git:**

```bash
# Project-local
pi install -l git:git@github.com:manifestdocs/pi-tdd.git

# Global
pi install git:git@github.com:manifestdocs/pi-tdd.git
```

**From a local checkout:**

```bash
git clone git@github.com:manifestdocs/pi-tdd.git
cd pi-tdd

# Project-local (writes to .pi/settings.json)
npm run install-ext

# Global (writes to ~/.pi/agent/extensions/)
npm run install-ext
```

If Pi is already running, run `/reload` inside the session to pick up the extension.

### 3. Use it

Just ask the agent to work on a feature or fix a bug. The extension nudges the agent to call `tdd_start` automatically when the task involves new behavior or a bug fix:

```
Fix the off-by-one error in pagination
```

The agent enables TDD, writes a failing test, implements the fix, refactors, and calls `tdd_done` when finished.

You can also toggle TDD manually with the slash command:

```
/tdd
```

## What is TDD?

Test-driven development is a workflow:

1. Write a test that expresses the next behavior you want.
2. Run it and confirm it fails.
3. Write the smallest amount of code that makes it pass.
4. Refactor without changing behavior.
5. Repeat.

The test does not have to be a unit test. Use the cheapest test that can prove the behavior.

## Why this matters for coding agents

Empirical evidence from 2024-2026 shows that providing pre-written tests to LLM agents improves code generation accuracy by 12-46 percentage points across multiple benchmarks and models. The TDFlow paper (2025) found that agents given human-written tests achieved 94.3% resolution on SWE-bench Verified, compared to 69.8% when generating their own tests.

Without test-driven discipline, coding agents tend to:

- Implement before specifying behavior.
- Change too much at once.
- Mix feature work with refactors.
- Declare success from plausibility instead of proof.

`pi-tdd` makes that discipline operational by telling the agent which kind of work is allowed right now, blocking out-of-phase tool calls, treating test output as the transition signal between phases, and keeping the cycle visible through the HUD.

The result is smaller diffs, better reviewability, and fewer ungrounded changes.

## How it works

The extension provides two agent tools and a manual toggle:

| Interface | Description |
|-----------|-------------|
| `tdd_start` | Agent tool — enables TDD mode |
| `tdd_done` | Agent tool — disables TDD mode when work is complete |
| `/tdd` | Slash command — manual toggle for user override |

When TDD is off, the extension injects a system prompt nudge telling the agent that TDD is available for feature and bug fix work. The agent decides whether the current task warrants it — no keyword heuristics.

When TDD is active, the extension:

1. **Injects phase-specific instructions** into the agent's system prompt, telling it what kind of work is allowed.
2. **Blocks production code writes in SPECIFYING** -- only test files and config files can be written until a test exists and fails.
3. **Auto-runs tests after file writes** and uses the results to advance phases.
4. **Detects manual test runs** via bash and uses those results for phase transitions too.
5. **Displays a HUD widget** showing the current phase, cycle count, and test results.

Phase transitions are automatic and driven entirely by test results:

```
OFF --(/tdd)--> SPECIFYING --[test fails]--> IMPLEMENTING --[tests pass]--> REFACTORING --[new turn]--> SPECIFYING
                                                                                  \------(/tdd)-------> OFF
```

## Phase details

### SPECIFYING

Write a failing test first. The extension blocks `write` and `edit` tool calls targeting production code. Only test files and config files are allowed through. Once a test file has been written and the test command reports failure, the phase advances to IMPLEMENTING.

The agent's system prompt says: *"Write a failing test FIRST. Do not modify production code until a test exists and fails."*

### IMPLEMENTING

Write the minimal production code to make the failing test pass. The extension runs tests after every file write. Once the test command reports success, the phase advances to REFACTORING.

The agent's system prompt says: *"Write the MINIMAL production code to make the failing test pass. No extra functionality or refactoring yet."*

### REFACTORING

Restructure code freely. The extension runs tests after every change. If tests fail, the agent is told to revert. No new behavior should be introduced in this phase.

REFACTORING advances back to SPECIFYING automatically when a new user turn begins, starting the next cycle.

The agent's system prompt says: *"Restructure code freely but keep all tests passing. No new behavior. If a change causes test failure, revert it immediately."*

### Non-TDD tasks

Some file changes have no testable behavior -- config files, lockfiles, dotfiles, manifests. The extension recognizes these by path pattern and lets them through in any phase without triggering test runs.

## Test command inference

The extension infers the test command from project files:

| Detected file | Test command |
|--------------|-------------|
| `package.json` with a `test` script | `npm test` |
| `Cargo.toml` | `cargo test` |
| `go.mod` | `go test ./...` |
| `pytest.ini` or `pyproject.toml` | `pytest` |

If inference fails, the extension prompts for a test command on first `/tdd` invocation.

## Test file detection

Convention-based. Files matching these patterns are treated as test files:

- `*.test.*` / `*.spec.*`
- `*_test.*` / `*_spec.*`
- Files under `__tests__/` or `test/` directories

No configuration needed.

## Test output parsing

The extension parses test output from 13+ frameworks using a Strategy pattern -- each framework has its own parser, and adding a new one means appending a single object. Individual test results, pass/fail counts, and duration are extracted automatically.

| Language | Frameworks | Pass pattern | Fail pattern |
|----------|-----------|-------------|-------------|
| JS/TS | Jest, Vitest, Mocha, Bun, AVA | `✓ name` | `✗ name` |
| Python | pytest | `path::test PASSED` | `path::test FAILED` |
| Python | unittest | `test (Class) ... ok` | `test (Class) ... FAIL` |
| Go | go test | `--- PASS: TestName` | `--- FAIL: TestName` |
| Rust | cargo test | `test name ... ok` | `test name ... FAILED` |
| Ruby | RSpec | — | `name (FAILED - 1)` |
| Ruby | Minitest | `Class#test = 0.00 s = .` | `Class#test = 0.00 s = F` |
| Java/Kotlin | Gradle | `Class > test() PASSED` | `Class > test() FAILED` |
| C# | dotnet test | `Passed TestName` | `Failed TestName` |
| Swift | XCTest | `Test Case '...' passed` | `Test Case '...' failed` |
| PHP | PHPUnit | `✔ name` | `✘ name` |
| Elixir | ExUnit | `* test name (0.1ms)` | — |
| Universal | TAP | `ok N - desc` | `not ok N - desc` |

When individual test lines aren't found, the parser falls back to summary-level regex matching (`N passed`, `N failed`). Frameworks like JUnit/Maven that only output summaries are handled by this fallback.

Parsed test output is appended to the tool result so the agent sees the test results inline, and is also used to populate the HUD widget.

## HUD widget

When TDD is active, a widget appears in the Pi interface showing:

- **Phase** (SPECIFYING / IMPLEMENTING / REFACTORING) with color coding
- **Cycle count** (increments each time REFACTORING transitions back to SPECIFYING)
- **Test summary** (passed / failed / duration)
- **Individual test results** (up to 7, with overflow indicator)

The widget updates after every test run.

## Development

```bash
git clone git@github.com:manifestdocs/pi-tdd.git
cd pi-tdd
npm install
npm test          # vitest — 46 tests for the parser module
```

Project structure:

```
src/
  index.ts        # Extension entry point, phase machine, HUD, tools
  parsers.ts      # Test output parsers (Strategy pattern, 13 frameworks)
test/
  parsers.test.ts # Parser test suite
```

To add a new test framework parser, append a `TestLineParser` object to the `defaultParsers` array in `src/parsers.ts`.

## Limits

This extension improves discipline. It does not replace judgment.

- A passing test can still be a weak test.
- The gate only blocks writes in SPECIFYING. IMPLEMENTING and REFACTORING steer via the system prompt rather than blocking tool calls, because over-blocking disrupts natural agent flow.
- No persistent state between sessions.
- No LLM-backed reviews -- the extension trusts test results as the source of truth.

The goal is not perfect enforcement. The goal is to keep the agent inside a tight feedback loop where tests drive every change.

## License

MIT
