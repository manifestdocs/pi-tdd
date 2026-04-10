# pi-tdd

`pi-tdd` is a TDD phase gate for [Pi](https://pi.dev/), the terminal coding agent by Mario Zechner. It keeps an agent inside a deliberate `SPEC -> RED -> GREEN -> REFACTOR` loop instead of letting it drift straight into broad implementation.

The extension injects phase-specific instructions into the agent prompt, gates tool calls against the current phase, runs LLM-backed pre-flight and post-flight reviews at cycle boundaries, watches test runs, and persists TDD state across the session.

In a hurry? Jump to [Quick Start](#quick-start).

## Quick Start

### 1. Install Pi

```bash
npm install -g @mariozechner/pi-coding-agent
```

Then authenticate:

```bash
pi
```

Inside Pi, run `/login`, or set your provider API key before launching Pi.

### 2. Install `pi-tdd`

Install into the current project:

```bash
pi install -l git:git@github.com:manifestdocs/pi-tdd.git
```

That writes to the project's `.pi/settings.json`.

Install globally for your user instead:

```bash
pi install git:git@github.com:manifestdocs/pi-tdd.git
```

That writes to `~/.pi/agent/settings.json`.

You can also install the current checkout during local development:

```bash
npm run pi:install
```

Or install the current checkout globally:

```bash
npm run pi:install:global
```

If Pi is already running, execute:

```text
/reload
```

### 3. Start Using The Gate

`pi-tdd` is **dormant by default**. A fresh session does not gate anything, so investigation, navigation, branch checkouts, code review, and other non-feature work all flow normally.

The gate engages in three ways:

1. **The agent calls `tdd_engage`** when it recognises feature or bug-fix work. This is the natural path: you can prompt with normal language like "fix the off-by-one in pagination" and the agent will engage TDD on its own before making any code changes.
2. **A configured task-management tool fires** (e.g., `mcp__manifest__start_feature`). See `engageOnTools` below.
3. **You run an explicit `/tdd` phase command** like `/tdd spec` or `/tdd red`. These both engage TDD and switch to that phase.

A worked example using slash commands directly:

```text
/tdd status
/tdd spec
/tdd spec-set "rejects checkout when the cart is empty" "shows a clear message explaining that at least one item is required" "allows checkout once the cart contains an item"
/tdd red
```

Then prompt the agent normally, for example:

```text
User story: as a shopper, I should not be able to check out with an empty cart.
Acceptance criteria:
1. Checkout fails when the cart has no items.
2. The user sees a clear validation message.
3. Checkout succeeds once at least one item is present.

Write the first failing test only. Do not implement the fix yet.
```

After the failing test is confirmed, let the agent make the minimal implementation change. Once the test passes, the extension can move the session into `REFACTOR`. When the work is finished or you switch to investigation, run `/tdd disengage` (or let the agent call `tdd_disengage`).

## Pi

Pi is a terminal coding agent. You open it in a project, talk to it in natural language, and it can read files, edit code, and run shell commands on your behalf.

If you already understand tools like Codex CLI, Claude Code, or Aider, Pi sits in the same category. The difference is that Pi is intentionally small and highly extensible. This package plugs into Pi as an extension.

Official Pi quick start:

```bash
npm install -g @mariozechner/pi-coding-agent
pi
```

You can authenticate either with `/login` inside Pi or with a provider API key in your shell environment.

## TDD

TDD means:

1. Write a test that expresses the next behavior you want.
2. Run it and confirm that it fails.
3. Write the smallest amount of code that makes that test pass.
4. Refactor without changing behavior.
5. Repeat.

That test does not have to be a unit test. Use the cheapest test that can actually prove the next behavior. For isolated domain logic, that is often a unit test. For boundaries such as persistence, HTTP contracts, CLI wiring, serialization, or interactions between components, the first honest RED test is often an integration test.

The point is not ceremony. The point is to make progress measurable. Instead of saying "the code looks done," you have a failing test, then a passing test, then a cleanup step.

Before that loop starts, you need to be explicit about the feature itself:

- the user story: what this enables for the user
- the need: what problem it solves
- the acceptance criteria: how you know the feature is done

If you skip that step, you can still do "strict TDD" and get very little value from it. You will just spend tokens proving that the agent implemented something consistently, not necessarily the right thing.

## Why this matters for coding agents

Coding agents are fast, but they also tend to:

- implement before specifying behavior
- change too much at once
- mix feature work with refactors
- declare success from plausibility instead of proof

Those problems are exactly what TDD is good at controlling.

`pi-tdd` makes that discipline operational for an agent:

- It tells the model which kind of work is allowed right now.
- It blocks or challenges out-of-phase tool calls.
- It treats test output as the main transition signal.
- It keeps the cycle visible to the human operator through status and commands.
- It gives you an override path when the gate is too strict, instead of silently letting the agent improvise.

For agents, that usually means less thrash, smaller diffs, better reviewability, and fewer "it seemed reasonable" changes.

## Why `SPEC` Exists

`SPEC` is an optional preflight step. It is not there for vague brainstorming. It exists to set the user's request up for success by making sure the test work is tied to a feature contract.

The intended flow is:

1. State the user story clearly.
2. Capture the acceptance criteria in observable terms.
3. Translate those criteria into test cases and decide whether each one needs unit proof, integration proof, or both.
4. Move into `RED` and implement one criterion at a time.

That mapping matters. If the specified tests do not come from the user story and acceptance criteria, the loop becomes expensive theater. The agent may still produce red tests, green tests, and refactors, but it is not converging on the right feature.

The name is intentional. `SPEC` lines up with specification-oriented testing styles in the RSpec and Vitest mold: tests are there to specify externally meaningful behavior, not just to exercise code paths.

Use `SPEC` when the request needs to be sharpened into something testable. Skip it when the requested behavior and acceptance criteria are already clear enough to go straight into `RED`.

## What The Extension Does

- Adds a `/tdd` command inside Pi.
- Registers `tdd_engage`, `tdd_disengage`, `tdd_preflight`, and `tdd_postflight` tools the agent can call directly.
- Tracks the current phase: `SPEC`, `RED`, `GREEN`, or `REFACTOR`.
- Injects phase-specific system prompt guidance on every turn (only while engaged).
- Gates phase-sensitive tool calls and runs LLM-backed reviews at cycle boundaries: a **pre-flight** check on the spec checklist before entering `RED`, and a **post-flight** check on the delivered work before disengaging.
- Detects common test commands such as `npm test`, `pnpm test`, `pytest`, `cargo test`, `go test`, `vitest`, `jest`, and `rspec`.
- Auto-advances from `RED -> GREEN` after a failing test signal and from `GREEN -> REFACTOR` after a passing test signal.
- Persists phase state in the Pi session so the cycle survives within-session navigation.

Important behavior details:

- **TDD is dormant by default.** Fresh sessions do not gate anything until the agent or user engages TDD. This keeps investigation, navigation, code review, and other non-feature work unconstrained.
- The agent engages TDD by calling `tdd_engage(phase, reason)`. Phase defaults to `SPEC`; pass `RED` when acceptance criteria are already clear.
- You can also engage by running an explicit `/tdd spec`, `/tdd red`, `/tdd green`, or `/tdd refactor` command.
- Configurable lifecycle hooks can auto-engage when known task-management tools fire (see `engageOnTools` / `disengageOnTools` below).
- `SPEC` does not auto-advance. You move out of it with `/tdd red`.
- In the default config, `REFACTOR -> RED` is user-controlled, so you explicitly start the next cycle.
- Read-only exploration is allowed in all phases by default.
- The intended use of `SPEC` is to translate the user's request into a feature spec with concrete, testable acceptance checks.

## `/tdd` Commands

- `/tdd status`: show current phase, test status, and cycle count
- `/tdd spec`: engage TDD and switch to `SPEC`
- `/tdd red`: engage TDD and switch to `RED`
- `/tdd green`: engage TDD and switch to `GREEN`
- `/tdd refactor`: engage TDD and switch to `REFACTOR`
- `/tdd spec-set "Criterion 1" "Criterion 2"`: store the feature spec checklist
- `/tdd spec-show`: show the active spec checklist
- `/tdd spec-done`: mark the current spec item complete
- `/tdd preflight`: run the pre-flight review on the current spec checklist
- `/tdd postflight`: run the post-flight review on the current cycle
- `/tdd history`: show phase transitions
- `/tdd engage` (alias `/tdd on`): engage TDD without changing phase
- `/tdd disengage` (alias `/tdd off`): disengage TDD for investigation/navigation (runs post-flight first if eligible)

Legacy `/tdd plan`, `/tdd plan-set`, `/tdd plan-show`, and `/tdd plan-done` aliases still work for compatibility.

## Agent Tools

The extension registers four LLM-callable tools so the agent can manage TDD on its own:

- `tdd_engage(phase?, reason)`: engage the gate at the start of feature or bug-fix work. `phase` defaults to `SPEC`; pass `RED` if acceptance criteria are already clear enough to write the first failing test. Pre-flight runs automatically when entering `RED` and blocks the transition if the spec checklist is weak.
- `tdd_disengage(reason)`: disengage when leaving feature work. Post-flight runs automatically when there is a spec checklist and a recent passing test run, surfacing any gaps before the gate releases.
- `tdd_preflight(userStory?)`: run the pre-flight review on the current spec checklist explicitly. Normally not needed — pre-flight fires on its own when transitioning into `RED`.
- `tdd_postflight(userStory?)`: run the post-flight review on the current cycle explicitly. Normally not needed — post-flight fires on its own when disengaging.

The agent is instructed to call these via the tool's prompt guidelines. You generally do not need to call them yourself — they exist so natural-language workflows can flow without slash-command interruptions.

## Recommended Workflow

For people new to both Pi and TDD, this is the simplest usable loop:

1. Start by writing down the user story and the acceptance criteria.
2. Use `SPEC` when needed to turn the request and acceptance criteria into concrete test cases.
3. Move to `RED` and ask the agent to write one failing test for one acceptance criterion.
   Pick the right proof level: unit for isolated logic, integration when the behavior crosses a boundary or contract.
4. Run the test and confirm it fails for the expected reason.
5. Let the agent make the smallest possible code change.
6. Run the test again and confirm it passes.
7. Use `REFACTOR` only for cleanup that keeps the same behavior.
8. Use `/tdd red` to begin the next acceptance criterion.

If the agent tries to jump ahead, the gate is there to slow it down on purpose.

If you cannot explain what user need the feature serves and how to tell when it is done, stop before `RED`. Otherwise you are likely testing the wrong thing.

## Configuration

Configure `pi-tdd` in either:

- `~/.pi/agent/settings.json` for global defaults
- `.pi/settings.json` for project-local settings

Example:

```json
{
  "tddGate": {
    "enabled": true,
    "defaultEngaged": false,
    "startInSpecMode": true,
    "persistPhase": true,
    "autoTransition": true,
    "refactorTransition": "user",
    "allowReadInAllPhases": true,
    "temperature": 0,
    "maxDiffsInContext": 5,
    "engageOnTools": [
      "mcp__manifest__start_feature"
    ],
    "disengageOnTools": [
      "mcp__manifest__complete_feature"
    ]
  }
}
```

Useful options:

- `defaultEngaged`: if `true`, every fresh session starts with TDD engaged (legacy always-on behavior). Default `false` — sessions start dormant and only engage on `tdd_engage`, an `engageOnTools` hook, or an explicit `/tdd` phase command.
- `startInSpecMode`: when TDD engages, begin in `SPEC` instead of `RED`
- `engageOnTools`: list of tool names that auto-engage TDD when the agent calls them. Useful for hooking task or feature management tools (e.g., manifest's `start_feature`, a Linear `start_issue` tool) into the TDD lifecycle without relying on the agent to remember `tdd_engage`.
- `disengageOnTools`: list of tool names that auto-disengage TDD. Pair with `engageOnTools` to close out a feature lifecycle (e.g., manifest's `complete_feature`).
- `persistPhase`: keep the phase state in the Pi session history (engagement is intentionally not persisted across sessions; every session starts dormant)
- `autoTransition`: allow the extension to move phases from observed test signals
- `refactorTransition`: choose how `REFACTOR -> RED` happens; default is `"user"`
- `reviewProvider` and `reviewModel`: use a specific model for the pre-flight and post-flight reviews instead of the current active model (legacy `judgeProvider` / `judgeModel` keys are still accepted)
- `runPreflightOnRed`: if `true` (default), pre-flight runs automatically when transitioning into `RED` and blocks the transition on failure
- `guidelines`: override or supply custom spec, test, implementation, refactor, universal, and security guidance blocks. The built-in defaults stay focused on TDD workflow; broader coding preferences should come from the repository's instructions (for example `AGENTS.md`) or your own system prompt.

Legacy `startInPlanMode` and `guidelines.plan` are still accepted for compatibility, but `startInSpecMode` and `guidelines.spec` are the preferred names.

## Local Development

If you want to work on this extension itself:

```bash
git clone git@github.com:manifestdocs/pi-tdd.git
cd pi-tdd
npm install
npm run pi:install
```

`npm run pi:install` builds the package and installs the current working tree into the local project's `.pi/settings.json`.

For a user-scope install instead:

```bash
npm run pi:install:global
```

That writes to `~/.pi/agent/settings.json`.

Because this repository declares a Pi package manifest, Pi can load it directly from the current directory, a local path, or from Git.

## Limits

This package improves discipline. It does not replace judgment.

- A passing test can still be a weak test.
- An LLM review can still make a bad call.
- Overrides are sometimes necessary.

The goal is not perfect enforcement. The goal is to make agent behavior more test-driven, more observable, and harder to let drift into unsupported code changes.
