-- These are the game details shown on screen. The browser displays them but does not choose them.
-- Run each query with the reader's permissions so hidden areas stay hidden.
-- Otherwise, it would run with the view owner's permissions and could reveal hidden areas.

create schema screen;
comment on schema screen is 'What the player sees: tiles, visible targets, status, and messages. Views run as the viewer.';

-- One row per visible tile. A creature covers the floor beneath it.
create view screen.tiles with (security_invoker = true) as
select distinct on (x, y) x, y, glyph, style
from (
  select t.x, t.y, s.glyph, t.kind as style, 0 as layer
  from creature.creatures t join creature.species s using (kind)
  union all
  select c.x, c.y,
         case when c.walkable then '·' else '#' end,
         case when creature.in_sight(c.x, c.y) then 'lit' else 'remembered' end,
         2
  from map.cell c
  union all
  select item.x, item.y, kind.glyph, 'item', 1
  from item.items item join item.kind kind using (kind)
  where item.holder_id is null
) layers
order by x, y, layer;

create view screen.status with (security_invoker = true) as
select greatest(h.hp, 0)                                as hp,
       t.n                                              as turn,
       case when r.is_called then r.last_value else 0 end as rewinds,
       m.width,
       m.height
from creature.hero() h, clock.turn t, clock.rewinds r, map.settings m;

create view screen.messages with (security_invoker = true) as
select msg from clock.log order by id desc limit 6;
