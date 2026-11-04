# pg-dungeon

A small cave crawler where PostgreSQL is the game engine. It runs in your browser on [PGlite](https://electric-sql.com/product/pglite), which is Postgres compiled to WebAssembly. Game rules, actions, and the data shown on screen live in SQL; TypeScript connects the browser to the database and renders its views.

```sh
npm install
npm run dev
npm test
npm run lint
```

Tests live in `test/`, split by domain. Each test names one behavior; shared database setup is in `test/support/`.

## Play through SQL

Use the console to inspect the game and choose actions. Press Enter to run a query or Alt+Enter to add a newline for a multiline query. The game has no keyboard movement controls:

```sql
select target.id, target.kind, species.glyph, target.hp, target.x, target.y,
       point(target.x, target.y) <-> (select (creature.hero()).pos) as distance_to_player
from creature.creatures target
join creature.species species using (kind)
where target.kind <> 'hero'
  and creature.in_sight(target.x, target.y);
select id, kind, name
from item.items join item.kind using (kind)
where holder_id = (select id from creature.creatures where kind = 'hero');

select game.move(1, 0);
select game.drink_potion((
  select id from item.items
  where kind = 'healing_potion'
    and holder_id = (select id from creature.creatures where kind = 'hero')
  limit 1
));
```

Items all live in `item.items`. To find visible floor items, write a query that filters for unheld items and visible coordinates:

```sql
select item.id, item.kind, kind.name, item.x, item.y
from item.items item join item.kind kind using (kind)
where item.holder_id is null
  and creature.in_sight(item.x, item.y)
order by item.id;
```

To find only items within pickup range (including the item ID and name), use:

```sql
select item.id, item.kind, kind.name
from item.items item
join item.kind kind using (kind)
cross join creature.hero() hero
where item.holder_id is null
  and abs(item.x - hero.x) + abs(item.y - hero.y) <= 1;
```

Use the returned ID in `select game.pick_up(ID);`. If an item is farther away, move toward its `(x, y)` coordinates with `game.move(dx, dy)` first. `holder_id IS NULL` selects floor items; `holder_id = (select id from creature.creatures where kind = 'hero')` selects carried items. The map shows floor item glyphs. `\df` shows function descriptions and target guidance.

Weapons are items in `item.items`; filter by the hero's `holder_id` and the desired `kind`. Query targets by joining `creature.creatures` and `creature.species`, then filter to visible non-hero creatures with `creature.in_sight(x, y)`. A sword must be used next to its target, a bow attacks one visible enemy at range, and a firebomb damages enemies around its selected target:

```sql
select game.attack(
  (select id from item.items
   where kind = 'shortbow'
     and holder_id = (select id from creature.creatures where kind = 'hero')
   limit 1),
  (select target.id from creature.creatures target
   where target.kind = 'rat'
     and creature.in_sight(target.x, target.y)
   limit 1)
);
```

Inventory is queryable through SQL, not shown in a separate visual panel. `item.items` holds every item entity: `holder_id` identifies carried items, while `(x, y)` locates floor items. Write your own filters to select one group or the other; picking up an item updates its holder and keeps its ID. Defeated monsters can drop items. The player starts with a sword, a shortbow, and a healing potion.

Row-level security limits floor items in `item.items` to those within the hero's sight; carried items remain visible to the hero. Starting floor loot is split between nearby items and items placed beyond the initial sight radius.

Use `\?` in the console for psql-style inspection commands, `\dn` to list schemas, and `\df` to inspect available functions. Successful actions persist, while read-only queries do not spend a turn. A failed statement is rolled back to its savepoint so a typo or illegal action does not abort the game session. Use `\rewind` to undo the most recent game turn.

## Layout

The game is split into domain schemas. Each part uses only schemas defined before it in this list.

| Schema | File | Holds |
|---|---|---|
| `clock` | [`01_clock.sql`](src/sql/01_clock.sql) | Turn counter, message log, rewind counter |
| `map` | [`02_map.sql`](src/sql/02_map.sql) | Map settings, cells, walls, cells seen, cave digging |
| `creature` | [`03_creature.sql`](src/sql/03_creature.sql) | Species, bodies, sight, monster AI, combat |
| `item` | [`03_item.sql`](src/sql/03_item.sql) | Item types and item entities, carried or on the floor |
| `screen` | [`04_screen.sql`](src/sql/04_screen.sql) | Views the browser prints: tiles, status, messages |
| `game` | [`05_game.sql`](src/sql/05_game.sql) | Game actions, new game, rewind, and player permissions |

The TypeScript side:

| File | Does |
|---|---|
| [`db.ts`](src/db.ts) | Boots PGlite, loads the SQL files in order, records statements for the history panel |
| [`session.ts`](src/session.ts) | Starts the game transaction, recovers failed actions, and rewinds turns |
| [`render.ts`](src/render.ts) | Prints the `screen` views |
| [`console/`](src/console) | Runs player SQL, psql-style commands, and statement history |

The game uses one long-lived database transaction because rewind relies on PostgreSQL savepoints: each successful turn keeps its savepoint so it can be restored. Committing after every action would discard those earlier states and make rewind impossible. Read-only queries release their savepoint; a failed action rolls back only to its own savepoint, preserving the rest of the game.

## Each mechanic is a Postgres feature

| Mechanic | Postgres feature |
|---|---|
| Walls | A composite foreign key from `creature.creatures (x, y, on_floor)` to `map.cell (x, y, walkable)`. Walking into rock is a `foreign_key_violation`. |
| Attacking | An exclusion constraint prevents two creatures from sharing a point; an attack updates the selected enemy in SQL. |
| Fog of war | Row-level security. The `player` role cannot read cells or monsters outside the hero's sight. |
| What's on screen | Views created `with (security_invoker = true)`. A plain view runs as its owner and could skip the fog. |
| Map memory | `map.seen`, which the fog policy also lets through. Monsters are not remembered. |
| Cave generation | A drunkard's walk written as a recursive CTE, seeded with `setseed`. |
| Monster AI | A breadth-first search from the hero (recursive CTE with `UNION` to keep it bounded), stored in a materialized view. Every monster steps downhill on it. |
| Turn counter | A one-row table. Rolling back to a turn savepoint restores it with the rest of the game state. |
| Rewind counter | A sequence. Sequences ignore rollbacks, so it remembers how often you rewound. |
| Player actions | `game` functions are the controlled entry points; the `player` role has no direct `INSERT`, `UPDATE`, or `DELETE` permission. |

## Explore it, try to cheat

The console runs SQL as `player`. `select * from creature.creatures` returns only creatures the hero can see. `update creature.creatures set hp = 999` gets `permission denied`.

Use `\dn` and click down from schema to table or function. The psql-style commands are rewritten as catalog queries in [`psql.ts`](src/console/psql.ts): `\dn`, `\dt`, `\d`, `\df`, and `\sf`. They run as `player` too, so you can inspect the game functions and the fog policy without reading hidden map data.

One limit: PGlite runs a single session as superuser and plays the role through `SET ROLE`. A real `player` login could never get out of that role, but here `reset role` would work. The console refuses role and transaction statements before they reach Postgres.

## Things I learned building it

- `REFRESH MATERIALIZED VIEW` runs with a locked-down `search_path` from Postgres 17 on. Functions the view calls need their tables schema-qualified or `search_path` pinned.
- A failed statement aborts the current transaction. The console uses a savepoint around each entered command so a typo or invalid move can be rolled back without ending the game.
