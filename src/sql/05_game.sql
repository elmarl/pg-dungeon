-- The game's only door: what the player role may call, and what it may read.

create schema game;
comment on schema game is 'The only door in: new game, move, rewind, and the player role''s permissions.';

create role player;

-- Remember every cell the hero can see right now.
create function game.look() returns void
language sql
as $$
  insert into map.seen select x, y from map.cell where creature.in_sight(x, y)
  on conflict do nothing
$$;

create function game.new_game(seed float8 default random() * 2 - 1) returns void
language plpgsql
as $$
declare
  start point := map.dig(seed);
begin
  perform creature.spawn_hero(start);
  perform creature.spawn_monsters(10, start);
  perform game.look();
  perform clock.say('You wake up in a cave. Something is breathing.');
end $$;

-- Returns false when the move cost no turn (bumped a wall, or dead).
create function game.move(dx int, dy int) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  me creature.thing := creature.hero();
begin
  if me.hp <= 0 then return false; end if;

  begin
    update creature.thing set x = x + dx, y = y + dy where id = me.id;
  exception
    when foreign_key_violation then
      return false;
    when exclusion_violation then
      perform creature.hit(me, (select t from creature.thing t where (t.x, t.y) = (me.x + dx, me.y + dy)));
  end;

  perform clock.tick();
  perform game.look();
  perform creature.monsters_act();
  return true;
end $$;

-- The browser calls this right after ROLLBACK TO SAVEPOINT, which already restored
-- the turn, the hero and the monsters. Only the sequence survived the rollback.
create function game.rewound() returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform nextval('clock.rewinds');
  perform clock.say(format('Time folds. You are back at turn %s.', (select n from clock.turn)));
end $$;

-- ── Fog of war is row-level security ───────────────────────────────────────
-- The player role cannot read rows the hero can't see.

alter table map.cell       enable row level security;
alter table creature.thing enable row level security;

create policy fog on map.cell for select to player
  using (creature.in_sight(x, y)
         or exists (select 1 from map.seen s where (s.x, s.y) = (cell.x, cell.y)));

create policy fog on creature.thing for select to player
  using (creature.in_sight(x, y));

-- ── Permissions: the player can look and can move. That's it. ──────────────

revoke execute on all functions in schema clock, map, creature, game from public;

grant usage on schema clock, map, creature, screen, game to player;
grant execute on function game.move(int, int), game.rewound(),
                          creature.hero(), creature.in_sight(int, int) to player;
grant select on map.cell, map.seen, map.settings,
                creature.thing, creature.species,
                clock.turn, clock.log, clock.rewinds,
                screen.tiles, screen.status, screen.messages to player;
