# Word Frequency Counter

A library that counts word frequencies in text.

## User Stories

### US-1: Basic counting
- Count word frequencies in a string
- Return a map/dictionary of word to count
- Split on whitespace and punctuation

### US-2: Options
- Case-insensitive mode (default on): "The" and "the" count as one
- Configurable stop-word list: words to exclude from results
- Default stop words: a, an, the, is, at, of, in, on, to

### US-3: Top-N results
- Return top N words sorted by frequency (descending)
- Break ties alphabetically (ascending)
- N defaults to 10; return all if fewer than N unique words
