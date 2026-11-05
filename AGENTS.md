# Project Guidelines

## Code style

- Always use braces for `if` statements. ESLint enforces this.
- Use descriptive identifiers; do not use one-character variable or parameter names. ESLint enforces a minimum identifier length of two.
- Give each function one clear responsibility, and name it to describe what it does.
- Write comments in plain language. Avoid jargon and explain technical terms when they are needed.
- Comments should only describe the non-obvious 'why', not repeat the code.

## Architecture

- Preserve the project's domain-driven design: keep game concepts organized in their existing Postgres schemas (`clock`, `map`, `creature`, `item`, `screen`, and `game`), and respect the dependency order between them.
- SQL is a core game mechanic, not just persistence. Implement game rules and behavior in SQL when practical; use TypeScript for browser interaction and work PostgreSQL cannot perform, rather than duplicating game logic in TypeScript.
- Demo automation may choose actions in TypeScript, but it should play through the browser's existing player commands and use only player-visible game state. Keep game rules in SQL and do not make the recorder write directly to the database.
- Keep each action recoverable: wrap database actions in savepoints and roll back to the action's savepoint on failure before surfacing the error, so a failed statement cannot leave the long-lived game transaction aborted. Preserve the turn savepoints used for rewind.
- See the README's layout and Postgres mechanics sections for the current domain boundaries and examples.

## Tests

- For behavior changes, add or update a focused test first and confirm it fails for the expected reason before implementing the change.
- Run the relevant tests after implementation.
- Keep tests under `test/`, grouped into separate files by domain (for example, gameplay, session recovery, permissions, and SQL console commands). Put reusable setup in `test/support/`.
- Each test should assert one clearly named behavior so a failure identifies what broke. Avoid a single long script that mixes unrelated checks.
- Follow the detailed test-writing and runtime guidance in [test/AGENTS.md](test/AGENTS.md).

## Checks

- Run `npm run lint`, `npm test`, and `npx tsc --noEmit` for TypeScript changes.
- When intentionally changing the README gameplay demo, regenerate it with `npm run record:gameplay`, review the animation, and include the updated `recordings/gameplay.gif` with the change.

## Commits

- Before committing, format staged supported files with Prettier using its default settings. The pre-commit hook runs `lint-staged` to format them, then runs `npm test` and `npx tsc --noEmit`. Do not commit if formatting, tests, or compilation fail.
