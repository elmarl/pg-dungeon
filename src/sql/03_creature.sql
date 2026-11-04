-- Creatures: the hero and the monsters, how they see, smell, move and fight.

create schema creature;
comment on schema creature is 'The hero and the monsters: bodies, sight, the monster AI, and combat.';

create table creature.species (
  kind  text primary key,
  glyph text not null,
  hp    int  not null,
  dmg   int  not null,
  sight int  not null
);

insert into creature.species values
  ('hero', '@', 30, 4, 6),
  ('rat',  'r',  4, 1, 0),
  ('ogre', 'O', 12, 3, 0);

create table creature.thing (
  id       serial primary key,
  kind     text not null references creature.species,
  hp       int  not null,
  x        int  not null,
  y        int  not null,
  pos      point generated always as (point(x, y)) stored,
  on_floor boolean not null default true check (on_floor),

  -- A creature can stand only on a cell that exists and can be walked on.
  foreign key (x, y, on_floor) references map.cell (x, y, walkable),

  -- Two creatures cannot occupy the same spot.
  -- Trying to move onto an occupied spot is how the game handles an attack.
  exclude using gist (pos with ~=)
);

-- The game can always find the hero, even when the player cannot see it.
create function creature.hero() returns creature.thing
language sql stable security definer set search_path = ''
as $$ select * from creature.thing where kind = 'hero' $$;

create function creature.in_sight(cx int, cy int) returns boolean
language sql stable security definer set search_path = ''
as $$
  -- <-> measures straight-line distance between PostgreSQL points.
  select point(cx, cy) <-> hero.pos <= species.sight
  from creature.thing hero join creature.species species using (kind)
  where hero.kind = 'hero'
$$;
comment on function creature.in_sight(int, int) is
  'True when a map coordinate is within the hero''s sight radius, measured as straight-line distance.';

create function creature.spawn_hero(at point) returns void
language sql
as $$
  insert into creature.thing (kind, hp, x, y)
  select kind, hp, at[0]::int, at[1]::int from creature.species where kind = 'hero'
$$;

create function creature.spawn_monsters(how_many int, away_from point) returns void
language sql
as $$
  insert into creature.thing (kind, hp, x, y)
  select s.kind, s.hp, c.x, c.y
  from (select x, y, (array['rat', 'rat', 'ogre'])[1 + floor(random() * 3)::int] as kind
        from map.cell
        where walkable and point(x, y) <-> away_from > 10
        order by random()
        limit how_many) c
  join creature.species s using (kind)
$$;

-- Find how many steps each reachable cell is from the hero. All monsters use
-- these distances to find their way. Skip repeated cell-and-distance pairs.
create materialized view creature.scent as
with recursive flood (x, y, d) as (
  select (creature.hero()).x, (creature.hero()).y, 0
  union
  select c.x, c.y, f.d + 1
  from flood f
  join map.cell c on c.walkable and abs(c.x - f.x) + abs(c.y - f.y) = 1
  where f.d < 15
)
select x, y, min(d) as d from flood group by x, y
with no data;

create function creature.hit(attacker creature.thing, victim creature.thing, weapon_damage int default null) returns void
language plpgsql
as $$
declare
  dmg     int := coalesce(weapon_damage, (select s.dmg from creature.species s where s.kind = attacker.kind));
  hp_left int;
begin
  update creature.thing set hp = hp - dmg where id = victim.id returning hp into hp_left;

  if victim.kind = 'hero' then
    perform clock.say(format('The %s hits you for %s.', attacker.kind, dmg));
    if hp_left <= 0 then perform clock.say('You die. Use \rewind to turn back time.'); end if;
  elsif hp_left > 0 then
    perform clock.say(format('You hit the %s.', victim.kind));
  else
    delete from creature.thing where id = victim.id;
    perform clock.say(format('You kill the %s.', victim.kind));
    if not exists (select 1 from creature.thing where kind <> 'hero') then
      perform clock.say('The cave is quiet. You win.');
    end if;
  end if;
end $$;

create function creature.monsters_act() returns void
language plpgsql
as $$
declare
  m    creature.thing;
  step record;
begin
  refresh materialized view creature.scent;

  for m in select * from creature.thing where kind <> 'hero' order by id loop
    exit when (creature.hero()).hp <= 0;

    if abs(m.x - (creature.hero()).x) + abs(m.y - (creature.hero()).y) = 1 then
      perform creature.hit(m, creature.hero());
      continue;
    end if;

    select n.x, n.y into step
    from creature.scent here
    join creature.scent n on abs(n.x - here.x) + abs(n.y - here.y) = 1
    where (here.x, here.y) = (m.x, m.y) and n.d < here.d
    order by n.d, random()
    limit 1;

    continue when not found;            -- The monster is not close enough to find a path yet.

    begin
      update creature.thing set x = step.x, y = step.y where id = m.id;
    exception when exclusion_violation then
      null;                             -- Another monster is in the way, so wait a turn.
    end;
  end loop;
end $$;
