# pi-tdd

A TDD phase gate for [Pi](https://pi.dev), the terminal coding agent. `pi-tdd` keeps an AI agent inside a deliberate **SPEC -> RED -> GREEN -> REFACTOR** loop instead of letting it drift straight into broad implementation.

The extension injects phase-specific instructions into the agent prompt, gates tool calls against the current phase, runs LLM-backed reviews at cycle boundaries, watches test output for pass/fail signals, and persists TDD state across the session.

**Dormant by default.** Fresh sessions are unconstrained. TDD only engages when the agent calls `tdd_engage`, a lifecycle hook fires, or you run an explicit `/tdd` command. Investigation, navigation, code review, and other non-feature work are never gated.

---

**Table of contents**

- [Quick start](#quick-start)
- [What is TDD?](#what-is-tdd)
- [Why this matters for coding agents](#why-this-matters-for-coding-agents)
- [How the phases work](#how-the-phases-work)
- [Slash commands](#slash-commands)
- [Agent tools](#agent-tools)
- [Reviews](#reviews)
- [Recommended workflow](#recommended-workflow)
- [Configuration reference](#configuration-reference)
- [Coding guidelines are separate](#coding-guidelines-are-separate)
- [Local development](#local-development)
- [Limits](#limits)

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

Inside Pi, run `/login` or set your provider API key as an environment variable before launching.

### 2. Install pi-tdd

**From Git** (recommended for most users):

```bash
# Project-local install (writes to .pi/settings.json)
pi install -l git:git@github.com:manifestdocs/pi-tdd.git

# Global install (writes to ~/.pi/agent/settings.json)
pi install git:git@github.com:manifestdocs/pi-tdd.git
```

**From a local checkout** (for contributors):

```bash
git clone git@github.com:manifestdocs/pi-tdd.git
cd pi-tdd
npm install && npm run build

# Project-local
npm run pi:install

# Global
npm run pi:install:global
```

If Pi is already running, run `/reload` inside the session to pick up the extension.

### 3. Use it

Ask the agent to work on a feature normally. It will call `tdd_engage` on its own when it recognizes feature or bug-fix work:

```text
Fix the off-by-one error in pagination. The last page shows one fewer item than it should.
```

The agent engages TDD, writes a failing test, makes the fix, confirms the test passes, and cleans up. When the work is done, it calls `tdd_disengage`.

You can also drive the cycle manually with slash commands:

```text
/tdd spec
/tdd spec-set "last page shows the correct item count" "boundary: page size evenly divides total" "boundary: page size does not evenly divide total"
/tdd red
```

## What is TDD?

Test-driven development is a workflow:

1. Write a test that expresses the next behavior you want.
2. Run it and confirm it fails.
3. Write the smallest amount of code that makes it pass.
4. Refactor without changing behavior.
5. Repeat.

The test does not have to be a unit test. Use the cheapest test that can prove the behavior. For isolated domain logic, that is often a unit test. For boundaries -- persistence, HTTP contracts, CLI wiring, serialization -- the honest first test is often an integration test.

Before that loop starts, you need clarity on what you are building:

- **User story**: what this enables for the user.
- **Need**: what problem it solves.
- **Acceptance criteria**: how you know the feature is done.

Without that grounding, you can still follow strict TDD and get very little value from it. You end up proving the agent implemented *something* consistently, not necessarily the *right* thing.

## Why this matters for coding agents

Coding agents are fast, but they tend to:

- Implement before specifying behavior.
- Change too much at once.
- Mix feature work with refactors.
- Declare success from plausibility instead of proof.

Those problems are exactly what TDD controls for. `pi-tdd` makes that discipline operational:

- It tells the model which kind of work is allowed right now.
- It blocks out-of-phase tool calls (write/edit/bash are blocked in SPEC).
- It treats test output as the transition signal between phases.
- It keeps the cycle visible to the human operator through status and commands.
- It gives you an override path when the gate is too strict.

The result is smaller diffs, better reviewability, and fewer ungrounded changes.

## How the phases work

### SPEC

Translate the user's request into testable acceptance criteria. Write tools (`write`, `edit`, `bash`) are blocked to keep focus on planning. Read tools are always allowed.

The agent builds a numbered checklist of spec items. Each item is a concrete, observable behavior that can be proven with a test. The agent also decides whether each item needs unit proof, integration proof, or both.

SPEC does not auto-advance. Move to RED with `/tdd red` or by having the agent call `tdd_engage(phase: "RED")`.

SPEC is optional. When acceptance criteria are already clear, engage directly into RED.

### RED

Write a failing test for one acceptance criterion. Run it to confirm it fails for the expected reason.

The phase auto-advances to GREEN when the extension detects a failing test signal.

### GREEN

Write the smallest correct implementation that makes the failing test pass. Stay scoped to the current test -- save cleanup for REFACTOR.

The phase auto-advances to REFACTOR when the extension detects a passing test signal.

### REFACTOR

Improve naming, readability, duplication, and structure without changing behavior. Run tests to confirm the refactor preserved the spec.

By default, REFACTOR does not auto-advance. Start the next cycle with `/tdd red` or let the agent call `tdd_engage(phase: "RED")`.

### Phase diagram

```
SPEC --[preflight passes]--> RED --[test fails]--> GREEN --[test passes]--> REFACTOR
                              ^                                                |
                              |________________[user / agent]__________________|
```

## Slash commands

All commands are available via `/tdd` inside a Pi session.

| Command | Description |
|---------|-------------|
| `/tdd status` | Show current phase, test status, and cycle count |
| `/tdd spec` | Engage TDD and switch to SPEC |
| `/tdd red` | Engage TDD and switch to RED |
| `/tdd green` | Engage TDD and switch to GREEN |
| `/tdd refactor` | Engage TDD and switch to REFACTOR |
| `/tdd spec-set "Criterion 1" "Criterion 2"` | Store the feature spec checklist |
| `/tdd spec-show` | Show the active spec checklist |
| `/tdd spec-done` | Mark the current spec item complete |
| `/tdd preflight` | Run the preflight review on the current spec |
| `/tdd postflight` | Run the postflight review on the current cycle |
| `/tdd engage` | Engage TDD without changing phase (alias: `/tdd on`) |
| `/tdd disengage` | Disengage TDD (alias: `/tdd off`). Runs postflight if eligible |
| `/tdd history` | Show phase transition history |

Phase commands (`/tdd spec`, `/tdd red`, etc.) both engage TDD and switch to that phase, so they work whether TDD is dormant or already active.

## Agent tools

The extension registers four tools the agent can call directly, so natural-language workflows can proceed without slash-command interruptions:

| Tool | Parameters | Description |
|------|-----------|-------------|
| `tdd_engage` | `phase?` (SPEC or RED, default SPEC), `reason` | Engage TDD for feature or bug-fix work. Preflight runs automatically when entering RED |
| `tdd_disengage` | `reason` | Disengage TDD. Postflight runs automatically when eligible |
| `tdd_preflight` | `userStory?` | Run the preflight review explicitly |
| `tdd_postflight` | `userStory?` | Run the postflight review explicitly |

The agent is instructed via tool prompt guidelines to call `tdd_engage` at the start of feature work and `tdd_disengage` when leaving it. You generally do not need to call these tools yourself.

## Reviews

Two LLM-backed reviews run at cycle boundaries. They fire automatically -- you do not need to trigger them unless you want an ad-hoc check.

### Preflight (priming)

Runs when transitioning from SPEC into RED (or when engaging directly into RED with a spec set). Validates that the spec checklist is testable, unambiguous, and complete enough to drive a clean TDD cycle.

**Blocks entry to RED on failure.** The agent must refine the spec and try again.

### Postflight (proving)

Runs on disengage (via `tdd_disengage`, `/tdd disengage`, or a `disengageOnTools` lifecycle hook). Validates that every spec item has a corresponding passing test and that the implementation matches what the spec asked for.

**Surfaces gaps but does not block.** The agent and user can decide whether to re-engage and address the gaps.

Postflight only runs when there is real evidence to review: TDD was engaged, a spec was set, and the most recent test run passed with captured output.

### Review model resolution

Reviews use LLM calls. The model is resolved in this order:

1. **Per-review override**: `reviewModels.preflight` or `reviewModels.postflight`
2. **Top-level default**: `reviewProvider` + `reviewModel`
3. **Active session model**: whatever model the Pi session is currently using

This lets you route preflight to a fast model (e.g., Gemini Flash) and postflight to a more thorough one (e.g., Claude Sonnet) while using your session model as the fallback.

## Recommended workflow

### For people new to TDD

1. State the user story and acceptance criteria clearly in your prompt.
2. Let the agent engage into SPEC and translate your request into a numbered spec checklist.
3. Review the spec. Refine anything vague or untestable.
4. Move to RED. The agent writes one failing test for one acceptance criterion.
5. Confirm the test fails for the expected reason.
6. Let the agent write the smallest code change to make the test pass.
7. Confirm the test passes.
8. Use REFACTOR for cleanup that preserves behavior.
9. Start the next RED cycle for the next acceptance criterion.

If you cannot explain what user need the feature serves and how to tell when it is done, stop before RED. You are likely to test the wrong thing.

### For experienced TDD practitioners

Engage directly into RED when criteria are clear:

```text
/tdd red
```

Or let the agent do it:

```text
Add rate limiting to the /api/search endpoint. 100 requests per minute per API key, 429 response with Retry-After header when exceeded.
```

The agent will call `tdd_engage(phase: "RED")`, write the failing test, implement, refactor, and disengage when done.

## Configuration reference

Configure `pi-tdd` via the `tddGate` key in Pi settings files:

- **Global**: `~/.pi/agent/settings.json`
- **Project**: `.pi/settings.json` (overrides global; both layers are deep-merged)

All fields are optional. Defaults are shown below:

```jsonc
{
  "tddGate": {
    // Core behavior
    "enabled": true,                    // false disables the extension entirely
    "defaultEngaged": false,            // true = auto-engage on every session start
    "startInSpecMode": false,           // true = engage into SPEC instead of RED
    "autoTransition": true,             // auto-advance phases on test signals
    "refactorTransition": "user",       // "user" | "agent" | "timeout"
    "allowReadInAllPhases": true,       // allow read tools in SPEC phase
    "persistPhase": true,               // persist phase in session log

    // Review settings
    "runPreflightOnRed": true,          // run preflight before entering RED
    "temperature": 0,                   // LLM temperature for reviews
    "maxDiffsInContext": 5,             // max diffs sent to postflight

    // Default review model (applies to all reviews)
    "reviewProvider": null,             // e.g. "anthropic", "google"
    "reviewModel": null,                // e.g. "claude-haiku-4-5-20251001"

    // Per-review model overrides
    "reviewModels": {
      "preflight": {
        "provider": "google",
        "model": "gemini-2.5-flash"
      },
      "postflight": {
        "provider": "anthropic",
        "model": "claude-sonnet-4-20250514"
      }
    },

    // Lifecycle hooks
    "engageOnTools": [],                // tool names that auto-engage TDD
    "disengageOnTools": [],             // tool names that auto-disengage TDD

    // Phase-specific prompt guidelines (override built-in prompts)
    "guidelines": {
      "spec": null,
      "red": null,
      "green": null,
      "refactor": null,
      "universal": null,
      "security": null
    }
  }
}
```

### Key options explained

**`defaultEngaged`** -- If `true`, every fresh session starts with TDD engaged (legacy always-on behavior). Default `false`: sessions start dormant and only engage on `tdd_engage`, a lifecycle hook, or an explicit `/tdd` phase command.

**`startInSpecMode`** -- When TDD engages, begin in SPEC instead of RED. Useful when you want the agent to always translate requests into a spec before writing tests.

**`engageOnTools` / `disengageOnTools`** -- Auto-engage or disengage TDD when specific tools are called. Hook task-management tools into the TDD lifecycle without relying on the agent to remember `tdd_engage`:

```json
{
  "tddGate": {
    "engageOnTools": ["mcp__manifest__start_feature"],
    "disengageOnTools": ["mcp__manifest__complete_feature"]
  }
}
```

**`refactorTransition`** -- Controls how REFACTOR advances to the next RED cycle. `"user"` (default) requires an explicit command or tool call. `"agent"` lets the agent advance on its own.

**`guidelines`** -- Override the built-in phase prompts with your own. Set a key to a string to replace the default, or `null` to keep the built-in. The built-in prompts focus on TDD workflow only; broader coding preferences belong in your `AGENTS.md` (see [below](#coding-guidelines-are-separate)).

### Test signal detection

The extension automatically recognizes test commands from common test runners and uses their output to detect pass/fail signals:

`npm test`, `pnpm test`, `yarn test`, `bun test`, `npx vitest`, `npx jest`, `pytest`, `cargo test`, `go test`, `deno test`, `rspec`, `dotnet test`, `make test`, `zig test`, and scripts matching `./scripts/test*` or similar patterns.

Test output is parsed for standard pass/fail patterns. When a command pipes through `|| true` (a common pattern to prevent shell exit on failure), the extension falls back to output pattern matching instead of relying on the exit code.

### Phase persistence

Phase state is written to the Pi session log as a custom entry. Within-session navigation (branching the session tree) preserves the phase state. New sessions always start dormant regardless of what was persisted, unless `defaultEngaged: true` is set.

### Backwards-compatible aliases

The codebase accepts these deprecated names for compatibility:

| Deprecated | Current |
|-----------|---------|
| `startInPlanMode` | `startInSpecMode` |
| `judgeProvider` / `judgeModel` | `reviewProvider` / `reviewModel` |
| `guidelines.plan` | `guidelines.spec` |
| `/tdd plan` | `/tdd spec` |

## Coding guidelines are separate

`pi-tdd` focuses on TDD workflow. It does not inject coding style rules, tech stack preferences, or architectural conventions. Those belong in your Pi context files:

- **Global** (all projects): `~/.pi/agent/AGENTS.md`
- **Per-project**: `AGENTS.md` or `CLAUDE.md` in the project root

Pi loads and concatenates all matching files automatically. Put your coding standards, preferred frameworks, naming conventions, and project-specific rules there. The TDD phase prompts work alongside them without overlap or conflict.

## Local development

To work on this extension itself:

```bash
git clone git@github.com:manifestdocs/pi-tdd.git
cd pi-tdd
npm install
npm run build              # tsc -> dist/
npm test                   # vitest (one shot)
npm run watch              # tsc --watch
npm run pi:install         # build + install into .pi/settings.json
npm run pi:install:global  # build + install into ~/.pi/agent/settings.json
```

After `pi:install`, run `/reload` inside Pi to pick up the new build.

There is no lint script. Type checking happens through `tsc` with strict mode.

### Architecture at a glance

- **`PhaseStateMachine`** (`src/phase.ts`) is the single source of mutable state. Phase, engagement flag, spec checklist, cycle count, test signals, and a rolling diff buffer all live here.
- **`src/index.ts`** is the extension entry point. It builds the machine, registers tools and commands, and wires Pi events to the right modules.
- **`src/gate.ts`** enforces one deterministic rule: SPEC blocks file mutations. All other phases are passthrough that record diffs for review context.
- **`src/transition.ts`** converts bash tool results into pass/fail test signals and drives phase transitions.
- **`src/preflight.ts`** and **`src/postflight.ts`** implement the LLM-backed reviews at cycle boundaries.
- **`src/engagement.ts`** implements the engage/disengage tools and lifecycle hooks.
- **`prompts/*.md`** contains all prompt text as editable markdown files.

## Limits

This extension improves discipline. It does not replace judgment.

- A passing test can still be a weak test.
- An LLM review can still make a bad call.
- Overrides are sometimes necessary.
- The gate is deliberately lenient outside of SPEC -- it steers via the system prompt rather than blocking tool calls, because over-blocking disrupts natural agent flow.

The goal is not perfect enforcement. The goal is to make agent behavior more test-driven, more observable, and harder to let drift into unsupported code changes.

## License

MIT
