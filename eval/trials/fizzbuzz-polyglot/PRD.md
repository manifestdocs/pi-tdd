# FizzBuzz

A FizzBuzz implementation with configurable rules.

## User Stories

### US-1: Classic FizzBuzz
- Return "Fizz" for multiples of 3
- Return "Buzz" for multiples of 5
- Return "FizzBuzz" for multiples of both
- Return the number as a string otherwise

### US-2: Range output
- Accept a start and end number (inclusive)
- Return an array/list of results for the range
- Start defaults to 1 if not provided

### US-3: Custom rules
- Accept custom divisor-word pairs (e.g. 7: "Bazz")
- Multiple rules combine in divisor order (lowest first)
- Custom rules replace the default 3/5 rules entirely
