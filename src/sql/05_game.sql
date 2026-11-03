-- The only actions the player may take and the game details they may read.

create schema game;
comment on schema game is 'The only door in: new game, move, rewind, and the player role''s permissions.';

create role player;

-- Keep track of every cell the hero can see.
create function game.remember_seen_cells() returns void
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
  perform game.remember_seen_cells();
  perform clock.say('You wake up in a cave. Something is breathing.');
end $$;

-- Return false when a move does not use a turn, such as hitting a wall or moving while dead.
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
  perform game.remember_seen_cells();
  perform creature.monsters_act();
  return true;
end $$;

-- After a rewind, the game restores the turn, hero, and monsters.
-- This separate counter still increases, so the game remembers the rewind.
create function game.rewound() returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform nextval('clock.rewinds');
  perform clock.say(format('Time folds. You are back at turn %s.', (select n from clock.turn)));
end $$;

-- ── Keep the player from seeing places the hero has not seen ────────────────
-- The player can read only cells the hero has seen and creatures within sight.

alter table map.cell       enable row level security;
alter table creature.thing enable row level security;

create policy fog on map.cell for select to player
  using (creature.in_sight(x, y)
         or exists (select 1 from map.seen s where (s.x, s.y) = (cell.x, cell.y)));

create policy fog on creature.thing for select to player
  using (creature.in_sight(x, y));

-- ── The player may move and rewind, and read what is needed to play ─────────

revoke execute on all functions in schema clock, map, creature, game from public;

grant usage on schema clock, map, creature, screen, game to player;
grant execute on function game.move(int, int), game.rewound(),
                          creature.hero(), creature.in_sight(int, int) to player;
grant select on map.cell, map.seen, map.settings,
                creature.thing, creature.species,
                clock.turn, clock.log, clock.rewinds,
                screen.tiles, screen.status, screen.messages to player;
