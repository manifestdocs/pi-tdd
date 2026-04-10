Testing guidelines:
- Write or update the cheapest failing test that can prove one acceptance criterion at a time.
- Use unit tests for isolated logic and integration tests for boundaries, contracts, or wiring.
- Structure the test around observable behavior, not implementation details.
- Do not hide boundary bugs behind mocks when the risk is at the seam.
- Make the failure clear enough that the missing behavior is obvious before moving to GREEN.
- Leave additional scenarios for later RED cycles unless the current spec item requires them.
