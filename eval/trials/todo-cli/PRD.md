# Todo CLI

A command-line todo manager that persists items to a JSON file.

## User Stories

### US-1: Add and list
- Add a todo with a text description; it gets a unique numeric ID
- List all todos showing ID, description, and status (active/completed)
- New todos default to active status

### US-2: Complete and delete
- Mark a todo as completed by ID
- Delete a todo by ID
- Return an error for unknown IDs

### US-3: Filter and persist
- Filter todos: all, active, or completed
- Persist todos to a JSON file on every mutation
- Load from the JSON file on startup (create if missing)
