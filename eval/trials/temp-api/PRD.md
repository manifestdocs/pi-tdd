# Temperature Conversion API

An HTTP API for converting between Celsius, Fahrenheit, and Kelvin.

## User Stories

### US-1: Single conversion
- GET /convert?from=C&to=F&value=100 returns the converted value
- Support all 6 direction pairs (C/F/K in any combination)
- Response: `{ "from": "C", "to": "F", "input": 100, "result": 212 }`

### US-2: Input validation
- Return 400 for invalid scale names (not C, F, or K)
- Return 400 for non-numeric or missing value
- Return 400 for missing from/to parameters
- Error response: `{ "error": "Invalid scale: X" }`

### US-3: Batch conversion
- POST /convert accepts a JSON array of conversion requests
- Each item: `{ "from": "C", "to": "F", "value": 100 }`
- Returns array of results in same order
- Individual failures don't block others -- return error inline
