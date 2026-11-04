-- Time: what turn it is, what happened, and how often the player rewound.

create schema clock;
comment on schema clock is 'Time: the turn counter, the message log, and how often you rewound.';

create table clock.turn (n int not null);
create unique index turn_single_row on clock.turn ((true));   -- Keep one current turn.
insert into clock.turn values (0);

create table clock.log (
  id   serial primary key,
  turn int  not null,
  msg  text not null
);

-- Rewinding restores the game, but does not restore this counter.
create sequence clock.rewinds;

create function clock.tick() returns void
language sql
as $$ update clock.turn set n = n + 1 $$;

create function clock.say(m text) returns void
language sql
as $$ insert into clock.log (turn, msg) select n, m from clock.turn $$;
