# pg-dungeon

A small cave crawler where Postgres is the game engine. It runs in your browser on [PGlite](https://electric-sql.com/product/pglite), which is Postgres 18 compiled to WebAssembly. Every rule, every number and every decision about what appears on screen is in SQL. The JavaScript sends key presses and prints the `screen` views.

```
npm install
npm run dev
npm test
npm run lint
```

## Layout

The game is split into parts, and each part is its own Postgres schema with its own file. Each schema uses only the ones above it in this list.

| Schema | File | Holds |
|---|---|---|
| `clock` | [`01_clock.sql`](src/sql/01_clock.sql) | Turn counter, message log, rewind counter |
| `map` | [`02_map.sql`](src/sql/02_map.sql) | Map settings, cells, walls, cells seen, cave digging |
| `creature` | [`03_creature.sql`](src/sql/03_creature.sql) | Species, bodies, sight, monster AI, combat |
| `screen` | [`04_screen.sql`](src/sql/04_screen.sql) | Views the browser prints: tiles, status line, messages |
| `game` | [`05_game.sql`](src/sql/05_game.sql) | `new_game`, `move`, `rewound`, fog of war, and what the `player` role may do |

The TypeScript side:

| File | Does |
|---|---|
| [`db.ts`](src/db.ts) | Boots PGlite, loads the SQL files in order, records statements for the history panel |
| [`session.ts`](src/session.ts) | One transaction per game, one savepoint per turn, rewind |
| [`render.ts`](src/render.ts) | Prints `screen.tiles`, `screen.status`, `screen.messages` |
| [`input.ts`](src/input.ts) | Keys to moves |
| [`console/`](src/console) | The SQL console, psql commands, statement history |

`session.ts` is the one piece of game logic outside SQL. A Postgres function can't run `SAVEPOINT` or `ROLLBACK TO`, so the client has to send them.

## Each mechanic is a Postgres feature

| Mechanic | Postgres feature |
|---|---|
| Walls | A composite foreign key from `creature.thing (x, y, on_floor)` to `map.cell (x, y, walkable)`. Walking into rock is a `foreign_key_violation`. |
| Attacking | `exclude using gist (pos with ~=)`, so two bodies can't share a point. Walking into a monster raises `exclusion_violation`, and the handler for it is the attack. |
| Fog of war | Row-level security. The `player` role cannot read cells or monsters outside the hero's sight. |
| What's on screen | Views created `with (security_invoker = true)`. A plain view runs as its owner and would skip the fog. |
| Map memory | `map.seen`, which the fog policy also lets through. Monsters are not remembered. |
| Cave generation | A drunkard's walk written as a recursive CTE, seeded with `setseed`. |
| Monster AI | One breadth-first search from the hero (recursive CTE with `UNION` to keep it bounded), stored in a materialized view. Every monster steps downhill on it. |
| Turn counter | A one-row table. `ROLLBACK TO SAVEPOINT` rewinds it with everything else. |
| Rewind counter | A sequence. Sequences ignore rollbacks, so it is the one number that remembers you cheated. |
| The only legal actions | `game.move` and `game.rewound` are `security definer`. The player has no `INSERT`, `UPDATE` or `DELETE` anywhere. |

## Explore it, try to cheat

The page has a console that runs SQL as `player`. `select * from creature.thing` returns only what the hero can see. `update creature.thing set hp = 999` gets `permission denied`.

To find your way around, type `\dn` and click down from schema to table to function. The console understands a few psql commands, rewritten as catalog queries in [`console/psql.js`](src/console/psql.js): `\dn`, `\dt`, `\d`, `\df` and `\sf`. They run as `player` too, so you can read how the fog works and read `game.move`'s source, but not the map behind the fog.

One limit: PGlite runs a single session as superuser and plays the role through `SET ROLE`. A real `player` login could never get out of that role, but here `reset role` would work. The console refuses role and transaction statements before they reach Postgres. Postgres rejects everything else.

## Things I learned building it

- `REFRESH MATERIALIZED VIEW` runs with a locked-down `search_path` from Postgres 17 on. Functions the view calls need their tables schema-qualified or `search_path` pinned.
- One failed statement aborts the whole open transaction. The console wraps each attempt in a savepoint so a typo doesn't end the game.
