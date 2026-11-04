create schema item;
comment on schema item is 'Item types and item entities, whether carried by a creature or lying on the map.';

create table item.kind (
  kind          text primary key,
  name          text not null,
  category      text not null check (category in ('potion', 'melee', 'ranged', 'area')),
  glyph         text not null,
  healing       int,
  damage        int,
  reach         numeric,
  blast_radius  numeric,
  consumable    boolean not null default false,
  check ((category = 'potion' and healing is not null and damage is null)
      or (category <> 'potion' and healing is null and damage is not null)),
  check ((category = 'area') = (blast_radius is not null))
);

insert into item.kind (kind, name, category, glyph, healing, damage, reach, blast_radius, consumable) values
  ('healing_potion', 'Healing potion', 'potion', '!', 12, null, null, null, true),
  ('sword', 'Cave sword', 'melee', '/', null, 6, 1, null, false),
  ('shortbow', 'Short bow', 'ranged', ')', null, 3, 4, null, false),
  ('firebomb', 'Fire bomb', 'area', '*', null, 3, 5, 1.5, true);

create table item.thing (
  id        serial primary key,
  kind      text not null references item.kind,
  holder_id int references creature.thing,
  x         int,
  y         int,
  on_floor  boolean not null default true check (on_floor),
  check ((holder_id is not null and x is null and y is null)
      or (holder_id is null and x is not null and y is not null)),
  foreign key (x, y, on_floor) references map.cell (x, y, walkable)
);
comment on table item.thing is
  'Every item entity. A non-null holder_id means it is carried; otherwise x and y locate it on the map.';

alter table item.thing enable row level security;

create function item.spawn_loot(origin point) returns void
language sql
as $$
  insert into item.thing (kind, x, y)
  select case when n % 3 = 0 then 'firebomb' else 'healing_potion' end, cell.x, cell.y
  from (
    select cell.x, cell.y, row_number() over () as n
    from map.cell cell
    where cell.walkable
      and point(cell.x, cell.y) <-> origin between 3 and 6
      and not exists (
        select 1 from creature.thing creature
        where (creature.x, creature.y) = (cell.x, cell.y)
      )
    order by random()
    limit 8
  ) cell
$$;

create function item.drop_loot() returns trigger
language plpgsql
as $$
begin
  if old.kind <> 'hero' and random() < 0.35 then
    insert into item.thing (kind, x, y)
    values (
      case when random() < 0.5 then 'healing_potion' else 'firebomb' end,
      old.x,
      old.y
    );
  end if;
  return old;
end $$;

create trigger creature_drops_item
after delete on creature.thing
for each row execute function item.drop_loot();
