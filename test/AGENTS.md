# Test Guidelines

## Test design

- Write focused tests that each verify one clearly named behavior. Keep unrelated behavior in separate tests and group test files by domain.
- Add or update a test first for every behavior change, confirm it fails for the expected reason, then implement the change.
- Prefer deterministic setup and assertions over long random simulations. Use the shared fixtures in `support/` where appropriate.
- Each test should ideally complete in less than one second. If a test takes longer, first look for a smaller deterministic setup or a more focused assertion. Keep slower integration tests only when they cover behavior that cannot be tested efficiently another way.
- Test observable behavior and failure recovery, not implementation details that may change without affecting users.

## Running tests

- Run the focused test file while iterating, then run `npm test` before finishing.
- Keep test names descriptive so a failed assertion makes the broken behavior clear.
