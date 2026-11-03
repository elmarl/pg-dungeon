-- What the player sees. The browser prints these views and decides nothing.
-- security_invoker makes each view run as whoever reads it, so fog of war still applies.
-- (A plain view runs as its owner and would skip row-level security.)

create schema screen;
comment on schema screen is 'What the player sees: tiles, status line, messages. Views run as the viewer.';

-- One row per visible tile. A creature hides the floor under it.
create view screen.tiles with (security_invoker = true) as
select distinct on (x, y) x, y, glyph, style
from (
  select t.x, t.y, s.glyph, t.kind as style, 0 as layer
  from creature.thing t join creature.species s using (kind)
  union all
  select c.x, c.y,
         case when c.walkable then '·' else '#' end,
         case when creature.in_sight(c.x, c.y) then 'lit' else 'remembered' end,
         1
  from map.cell c
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
