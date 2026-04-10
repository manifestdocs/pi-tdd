Specification guidelines:
- Treat SPEC as an optional preflight step for turning the user's request into testable behavior.
- Translate the request into a user story, concrete acceptance criteria, and the tests that will prove them.
- Decide for each spec item whether the proof should start with a unit test, an integration test, or both.
- Keep spec items observable and tied to user-visible behavior rather than implementation details.
- Boundary and contract behavior should usually name integration proof explicitly.
- Break broad requests into atomic checks that can be proven one RED/GREEN cycle at a time.
- Tighten vague, overlapping, or untestable items before moving into RED.
