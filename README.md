# pi-tdd

`pi-tdd` is a TDD phase gate for [Pi](https://pi.dev/), the terminal coding agent by Mario Zechner. It keeps an agent inside a deliberate `SPEC -> RED -> GREEN -> REFACTOR` loop instead of letting it drift straight into broad implementation.

The extension injects phase-specific instructions into the agent prompt, judges tool calls against the current phase, watches test runs, and persists TDD state across the session.

## Pi

Pi is a terminal coding agent. You open it in a project, talk to it in natural language, and it can read files, edit code, and run shell commands on your behalf.

If you already understand tools like Codex CLI, Claude Code, or Aider, Pi sits in the same category. The difference is that Pi is intentionally small and highly extensible. This package plugs into Pi as an extension.

Official Pi quick start:

```bash
npm install -g @mariozechner/pi-coding-agent
pi
```

You can authenticate either with `/login` inside Pi or with a provider API key in your shell environment.

## TDD, in plain English

TDD means:

1. Write a test that expresses the next behavior you want.
2. Run it and confirm that it fails.
3. Write the smallest amount of code that makes that test pass.
4. Refactor without changing behavior.
5. Repeat.

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
3. Translate those criteria into test cases.
4. Move into `RED` and implement one criterion at a time.

That mapping matters. If the specified tests do not come from the user story and acceptance criteria, the loop becomes expensive theater. The agent may still produce red tests, green tests, and refactors, but it is not converging on the right feature.

The name is intentional. `SPEC` lines up with specification-oriented testing styles in the RSpec and Vitest mold: tests are there to specify externally meaningful behavior, not just to exercise code paths.

Use `SPEC` when the request needs to be sharpened into something testable. Skip it when the requested behavior and acceptance criteria are already clear enough to go straight into `RED`.

## What The Extension Does

- Adds a `/tdd` command inside Pi.
- Tracks the current phase: `SPEC`, `RED`, `GREEN`, or `REFACTOR`.
- Injects phase-specific system prompt guidance on every turn.
- Uses an LLM judge to approve or block phase-sensitive tool calls.
- Detects common test commands such as `npm test`, `pnpm test`, `pytest`, `cargo test`, `go test`, `vitest`, `jest`, and `rspec`.
- Auto-advances from `RED -> GREEN` after a failing test signal and from `GREEN -> REFACTOR` after a passing test signal.
- Persists state in the Pi session so the phase survives restarts and branch navigation.

Important behavior details:

- By default, the extension starts in `RED`, not `SPEC`.
- `SPEC` does not auto-advance. You move out of it with `/tdd red`.
- In the default config, `REFACTOR -> RED` is user-controlled, so you explicitly start the next cycle.
- Read-only exploration is allowed in all phases by default.
- The intended use of `SPEC` is to translate the user's request into a feature spec with concrete, testable acceptance checks.

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

### 2. Install `pi-tdd` Into a Project

From the project where you want TDD gating:

```bash
pi install -l git:git@github.com:manifestdocs/pi-tdd.git
```

`-l` writes the package to the project's `.pi/settings.json`, so the whole repo can share the same setup.

If Pi is already running, execute:

```text
/reload
```

### 3. Start Using The Gate

Open Pi in your project and try:

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

After the failing test is confirmed, let the agent make the minimal implementation change. Once the test passes, the extension can move the session into `REFACTOR`.

## `/tdd` Commands

- `/tdd status`: show current phase, test status, and cycle count
- `/tdd spec`: switch to `SPEC`
- `/tdd red`: switch to `RED`
- `/tdd green`: switch to `GREEN`
- `/tdd refactor`: switch to `REFACTOR`
- `/tdd spec-set "Criterion 1" "Criterion 2"`: store the feature spec checklist
- `/tdd spec-show`: show the active spec checklist
- `/tdd spec-done`: mark the current spec item complete
- `/tdd history`: show phase transitions
- `/tdd off`: disable enforcement for the current session
- `/tdd on`: re-enable enforcement

Legacy `/tdd plan`, `/tdd plan-set`, `/tdd plan-show`, and `/tdd plan-done` aliases still work for compatibility.

## Recommended Workflow

For people new to both Pi and TDD, this is the simplest usable loop:

1. Start by writing down the user story and the acceptance criteria.
2. Use `SPEC` when needed to turn the request and acceptance criteria into concrete test cases.
3. Move to `RED` and ask the agent to write one failing test for one acceptance criterion.
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
    "startInSpecMode": true,
    "persistPhase": true,
    "autoTransition": true,
    "refactorTransition": "user",
    "allowReadInAllPhases": true,
    "temperature": 0,
    "maxDiffsInContext": 5
  }
}
```

Useful options:

- `startInSpecMode`: begin each session in `SPEC` instead of `RED`
- `persistPhase`: keep the phase state in the Pi session history
- `autoTransition`: allow the extension to move phases from observed test signals
- `refactorTransition`: choose how `REFACTOR -> RED` happens; default is `"user"`
- `judgeProvider` and `judgeModel`: use a specific model for the gate instead of the current active model
- `guidelines`: override the default spec, test, implementation, refactor, universal, and security guidance blocks

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
- An LLM judge can still make a bad call.
- Overrides are sometimes necessary.

The goal is not perfect enforcement. The goal is to make agent behavior more test-driven, more observable, and harder to let drift into unsupported code changes.
