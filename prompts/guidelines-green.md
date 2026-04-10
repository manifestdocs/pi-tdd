Implementation guidelines:
- Implement only the behavior required to make the current failing test pass.
- Prefer the smallest correct change that gets the cycle back to green.
- Preserve the intent of the chosen proof level; if the RED test exercises a boundary, make the real boundary behavior pass.
- Keep cleanup, refactors, and unrelated scope for REFACTOR or a later cycle.
