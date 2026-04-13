# Notes App (Monorepo)

A monorepo with two packages: an API server and a shared validation library.

## Structure

```
api/          -- Express REST API (has its own package.json and tests)
shared/       -- Validation utility library (has its own package.json and tests)
```

## User Stories

### US-1: Note validation (shared/)
- Validate note title: required, 1-100 characters
- Validate note body: required, 1-10000 characters
- Sanitize input: trim whitespace, strip HTML tags
- Return structured validation errors with field name and message

### US-2: CRUD notes (api/)
- POST /api/notes -- create a note (title, body), validate with shared lib, return 201 or 422
- GET /api/notes -- list all notes, return 200 with JSON array
- Use in-memory storage (no database)

### US-3: Filter by tag (api/)
- Notes can have an optional tags array
- GET /api/notes?tag=foo -- filter notes by tag
- Tags must be non-empty strings, validated via shared lib
