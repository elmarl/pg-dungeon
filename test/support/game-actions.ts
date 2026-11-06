import type { GameDatabase } from "../../src/db.js";
import type { Session } from "../../src/session.js";

export async function moveHeroOneCell(
  db: GameDatabase,
  session: Session,
): Promise<void> {
  const [{ dx, dy }] = await db.rows<{ dx: number; dy: number }>(`
    select cell.x - hero.x as dx, cell.y - hero.y as dy
    from creature.creatures hero
    join map.cell cell
      on cell.walkable
     and abs(cell.x - hero.x) + abs(cell.y - hero.y) = 1
    where hero.kind = 'hero'
      and not exists (
        select 1
        from creature.creatures occupant
        where (occupant.x, occupant.y) = (cell.x, cell.y)
      )
    limit 1
  `);
  await session.executeCommand(() => db.rows(`select game.move(${dx}, ${dy})`));
}
