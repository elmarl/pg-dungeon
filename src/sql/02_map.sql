-- The cave: which cells exist, which you can walk on, which the hero has seen.
create schema map;

comment on schema map is 'The cave: cells, walls, and the cells the hero has seen.';

create table map.settings (
  width int not null,
  height int not null,
  dig_steps int not null
);

create unique index settings_single_row on map.settings ((true));

insert into
  map.settings
values
  (48, 22, 900);

create table map.cell (
  x int,
  y int,
  walkable boolean not null,
  primary key (x, y),
  unique (x, y, walkable) -- Lets the game check that creatures stand on walkable cells.
);

-- Cells the hero has seen once. Walls stay drawn after you walk away.
create table map.seen (x int, y int, primary key (x, y));

-- Make the cave by taking random steps from the center. Return the starting point.
create function map.dig (seed float8) returns point language plpgsql as $$
declare
  w int := (select width from map.settings);
  h int := (select height from map.settings);
  steps int := (select dig_steps from map.settings);
begin
  perform setseed(seed);

  insert into map.cell
  select x, y, false from generate_series(0, w - 1) x, generate_series(0, h - 1) y;

  with recursive walk (i, x, y) as (
    select 0, w / 2, h / 2
    union all
    select i + 1,
           least(greatest(x + d.dx, 1), w - 2),
           least(greatest(y + d.dy, 1), h - 2)
    from walk,
         lateral (select (array[1, -1, 0, 0])[k] as dx, (array[0, 0, 1, -1])[k] as dy
                  from (select 1 + floor(random() * 4)::int as k) pick) d
    where i < steps
  )
  update map.cell set walkable = true
  from walk where (cell.x, cell.y) = (walk.x, walk.y);

  -- Remove unseen rock with no walkable neighbor. Missing cells mark the map edge.
  delete from map.cell c
  where not c.walkable
    and not exists (select 1 from map.cell n
                    where n.walkable and abs(n.x - c.x) <= 1 and abs(n.y - c.y) <= 1);

  return point(w / 2, h / 2);
end $$;