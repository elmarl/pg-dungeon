# Project Guidelines

## Code style

- Always use braces for `if` statements. ESLint enforces this.
- Use descriptive identifiers; do not use one-character variable or parameter names. ESLint enforces a minimum identifier length of two.
- Give each function one clear responsibility, and name it to describe what it does.
- Write comments in plain language. Avoid jargon and explain technical terms when they are needed.

## Architecture

- Preserve the project's domain-driven design: keep game concepts organized in their existing Postgres schemas (`clock`, `map`, `creature`, `screen`, and `game`), and respect the dependency order between them.
- SQL is a core game mechanic, not just persistence. Implement game rules and behavior in SQL when practical; use TypeScript for browser interaction and work PostgreSQL cannot perform, rather than duplicating game logic in TypeScript.
- Keep each action recoverable: wrap database actions in savepoints and roll back to the action's savepoint on failure before surfacing the error, so a failed statement cannot leave the long-lived game transaction aborted. Preserve the turn savepoints used for rewind.
- See the README's layout and Postgres mechanics sections for the current domain boundaries and examples.

## Tests

- For every code change, add or update a focused test first and confirm it fails for the expected reason before implementing the change.
- Run the relevant tests after implementation.

## Checks

- Run `npm run lint`, `npm test`, and `npx tsc --noEmit` for TypeScript changes.
