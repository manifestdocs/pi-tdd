---
name: pi-tdd
description: Use pi-tdd's SPEC, RED, GREEN, and REFACTOR workflow to translate user requests into testable specifications and implement behavior one acceptance criterion at a time.
---

# pi-tdd

Use this skill when the task is being handled inside `pi-tdd` or when the user wants help working in a strict TDD loop with Pi.

## Purpose

`pi-tdd` is not just about "write a failing test first". Its value comes from making sure the requested feature is translated into testable behavior before implementation starts.

Use the repository's own instructions, such as `AGENTS.md` or the active system prompt, for broader coding conventions. This skill only adds TDD workflow guidance.

Use `SPEC` as an optional preflight step when the user's request can't yet be translated directly into a failing test — the user story, expected behavior, or acceptance criteria need to be pinned down first.

## SPEC Workflow

When the request needs sharpening:

1. Restate the user request in plain language.
2. Identify the user story:
   What does this enable for the user?
3. Identify the need:
   What problem or pain point is being solved?
4. Write observable acceptance criteria:
   How will we know the feature is done?
5. Translate each acceptance criterion into one or more test cases and decide whether the proof should start at the unit level, the integration level, or both.
6. Capture those checks as the `SPEC` list.
7. Move into `RED` only after the requested behavior is testable.

If you cannot explain the user-visible behavior and the acceptance criteria, do not rush into `RED`.

## Phase Semantics

### SPEC

- Clarify the request.
- Produce a user story, acceptance criteria, and testable specifications.
- Do not edit files.
- Do not do implementation planning unrelated to testable behavior.

### RED

- Add or modify the cheapest failing test for a single acceptance criterion.
- Use unit tests for isolated logic and integration tests when the bug or feature lives at a boundary, contract, or wiring seam.
- Confirm the test fails for the expected reason.
- Do not implement the fix yet.

### GREEN

- Write the smallest correct code for the behavior the failing test asserts.
- Stay scoped to the current failing test. Save cleanup and broader changes for REFACTOR.

### REFACTOR

- Refine the code from this cycle without changing behavior: naming, readability, duplication, structure.
- If a test breaks, you changed behavior — revert and try a different approach.
- Stay scoped to this cycle's work.

## Command Surface

Primary commands:

- `/tdd status`
- `/tdd spec`
- `/tdd spec-set "Criterion 1" "Criterion 2"`
- `/tdd spec-show`
- `/tdd spec-done`
- `/tdd red`
- `/tdd green`
- `/tdd refactor`

Legacy compatibility aliases still exist:

- `/tdd plan`
- `/tdd plan-set`
- `/tdd plan-show`
- `/tdd plan-done`

## Good Output Shape In SPEC

When producing a spec, prefer this structure:

1. User story
2. Acceptance criteria
3. Testable specification list

Example:

```text
User story:
As a shopper, I want checkout to reject an empty cart so I do not place an invalid order.

Acceptance criteria:
1. Checkout fails when the cart has no items.
2. The user sees a clear validation message.
3. Checkout succeeds once at least one item is present.

Testable specification:
1. rejects checkout when the cart is empty
2. shows a clear validation message for an empty cart
3. allows checkout when the cart contains at least one item
```

## Guardrails

- Do not treat `SPEC` as vague brainstorming.
- Do not treat passing tests as success unless the tests actually prove the requested behavior.
- Do not rely on mocked unit tests alone when the real risk is at a boundary between units.
- Prefer one acceptance criterion per RED/GREEN cycle when possible.
- When uncertain, tighten the specification before writing more code.
