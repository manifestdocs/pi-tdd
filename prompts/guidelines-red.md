Testing guidelines:
- Write or update the cheapest failing test that can prove one acceptance criterion at a time.
- Use unit tests for isolated logic and integration tests for boundaries, contracts, or wiring.
- Structure the test around observable behavior and externally meaningful outcomes.
- Exercise the real seam when the risk is at a boundary, and use mocks in ways that still expose that boundary behavior honestly.
- Make the failure clear enough that the missing behavior is obvious before moving to GREEN.
- Focus this RED cycle on the current spec item, and add further scenarios in later RED cycles unless they are required to prove this item.
