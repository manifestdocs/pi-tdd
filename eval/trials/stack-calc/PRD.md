# Stack Calculator

A stack-based calculator library. Push numbers, apply operators, get results.

## User Stories

### US-1: Push and peek
- Push numbers onto the stack
- Peek returns the top value without removing it
- Peek on empty stack throws/returns an error

### US-2: Binary operators
- Apply +, -, *, / operators
- Each operator pops two values, computes the result, and pushes it
- Stack underflow (fewer than 2 values) returns an error

### US-3: Error handling
- Division by zero returns a descriptive error
- Invalid operator returns an error
- Errors do not corrupt the stack state
