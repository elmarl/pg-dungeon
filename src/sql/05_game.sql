-- The only actions the player may take and the game details they may read.

create schema game;
comment on schema game is 'The only door in: game actions, new game, rewind, and the player role''s permissions.';

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
  insert into item.items (kind, holder_id)
  select starting.kind, hero.id
  from (values ('sword'), ('shortbow'), ('healing_potion')) starting(kind)
  cross join lateral (select (creature.hero()).id as id) hero;
  perform item.spawn_loot(start);
  perform game.remember_seen_cells();
  perform clock.say('You wake up in a cave. Something is breathing.');
end $$;

create function game.finish_turn() returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform clock.tick();
  perform game.remember_seen_cells();
  perform creature.monsters_act();
end $$;

-- Return false when a move does not use a turn, such as hitting a wall or moving while dead.
create function game.move(dx int, dy int) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  me creature.creatures := creature.hero();
begin
  if me.hp <= 0 then return false; end if;

  begin
    update creature.creatures set x = x + dx, y = y + dy where id = me.id;
  exception
    when foreign_key_violation then
      return false;
    when exclusion_violation then
      perform creature.hit(me, (select t from creature.creatures t where (t.x, t.y) = (me.x + dx, me.y + dy)));
  end;

  perform game.finish_turn();
  return true;
end $$;
comment on function game.move(int, int) is
  'Attempt to move by dx and dy map cells, for example game.move(1, 0) moves east. A successful move costs a turn.';

create function game.pick_up(item_id int) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  me creature.creatures := creature.hero();
  found_item item.items;
begin
  if me.hp <= 0 then raise exception 'You cannot pick up items while dead.'; end if;

  select item.* into found_item
  from item.items item
  where item.id = item_id and item.holder_id is null
    and abs(item.x - me.x) + abs(item.y - me.y) <= 1;
  if not found then raise exception 'That item is not within reach.'; end if;

  update item.items
  set holder_id = me.id, x = null, y = null
  where id = item_id;
  perform clock.say(format('You pick up the %s.', (select name from item.kind where kind = found_item.kind)));
  perform game.finish_turn();
end $$;
comment on function game.pick_up(int) is
  'Pick up a floor item next to the hero. Query item.items with holder_id IS NULL and creature.in_sight(x, y) to find its ID.';

create function game.drink_potion(item_id int) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  me creature.creatures := creature.hero();
  potion item.kind;
begin
  if me.hp <= 0 then raise exception 'You cannot use items while dead.'; end if;

  select kind.* into potion
  from item.items item join item.kind kind using (kind)
  where item.id = item_id and item.holder_id = me.id and kind.category = 'potion';
  if not found then raise exception 'That is not a potion in your inventory.'; end if;

  update creature.creatures
  set hp = least((select species.hp from creature.species species where species.kind = 'hero'), hp + potion.healing)
  where id = me.id;
  delete from item.items where id = item_id;
  perform clock.say(format('You drink a %s.', potion.name));
  perform game.finish_turn();
end $$;
comment on function game.drink_potion(int) is
  'Drink a carried potion. Query item.items where holder_id = (SELECT id FROM creature.creatures WHERE kind = ''hero'') and kind = ''healing_potion'' to find its ID.';

create function game.attack(weapon_id int, target_id int) returns int
language plpgsql security definer set search_path = ''
as $$
declare
  me creature.creatures := creature.hero();
  weapon item.kind;
  victim creature.creatures;
  affected creature.creatures;
  hits int := 0;
  target_distance numeric;
begin
  if me.hp <= 0 then raise exception 'You cannot attack while dead.'; end if;

  select kind.* into weapon
  from item.items item join item.kind kind using (kind)
  where item.id = weapon_id and item.holder_id = me.id and kind.category <> 'potion';
  if not found then raise exception 'That weapon is not in your inventory.'; end if;

  select target.* into victim from creature.creatures target where target.id = target_id and target.kind <> 'hero';
  if not found or not creature.in_sight(victim.x, victim.y) then
    raise exception 'That target is not visible.';
  end if;

  target_distance := point(victim.x, victim.y) <-> me.pos;
  if weapon.category = 'melee' and abs(victim.x - me.x) + abs(victim.y - me.y) <> 1 then
    raise exception 'That weapon only reaches an adjacent target.';
  elsif weapon.category <> 'melee' and target_distance > weapon.reach then
    raise exception 'That target is out of range.';
  end if;

  if weapon.category = 'area' then
    for affected in
      select target.* from creature.creatures target
      where target.kind <> 'hero'
        and creature.in_sight(target.x, target.y)
        and point(target.x, target.y) <-> point(victim.x, victim.y) <= weapon.blast_radius
      order by target.id
    loop
      perform creature.hit(me, affected, weapon.damage);
      hits := hits + 1;
    end loop;
  else
    perform creature.hit(me, victim, weapon.damage);
    hits := 1;
  end if;

  if weapon.consumable then
    delete from item.items where id = weapon_id;
  end if;

  perform game.finish_turn();
  return hits;
end $$;
comment on function game.attack(int, int) is
  'Attack a visible target with a carried weapon. Query item.items where holder_id = (SELECT id FROM creature.creatures WHERE kind = ''hero'') to find weapon IDs; query creature.creatures where kind <> ''hero'' and creature.in_sight(x, y) to find targets.';

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
-- The player can read only cells the hero has seen, and creatures and floor items within sight.

alter table map.cell       enable row level security;
alter table creature.creatures enable row level security;

create policy fog on map.cell for select to player
  using (creature.in_sight(x, y)
         or exists (select 1 from map.seen s where (s.x, s.y) = (cell.x, cell.y)));

create policy fog on creature.creatures for select to player
  using (creature.in_sight(x, y));

create policy visible_item_entities on item.items for select to player
  using (
    holder_id = (select (creature.hero()).id)
    or (holder_id is null and creature.in_sight(x, y))
  );

-- ── The player may use game actions and read what is needed to play ─────────

revoke execute on all functions in schema clock, map, creature, item, game from public;

grant usage on schema clock, map, creature, item, screen, game to player;
grant execute on function game.move(int, int), game.pick_up(int), game.drink_potion(int),
                          game.attack(int, int), game.rewound(),
                          creature.hero(), creature.in_sight(int, int) to player;
grant select on map.cell, map.seen, map.settings,
                creature.creatures, creature.species,
                item.kind, item.items,
                clock.turn, clock.log, clock.rewinds,
                screen.tiles, screen.status, screen.messages to player;
