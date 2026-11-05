type Cell = { x: number; y: number; walkable: boolean; visible: boolean };
type Hero = { id: number; x: number; y: number; hp: number };
type Creature = { id: number; kind: string; x: number; y: number; hp: number };
type Item = {
  id: number;
  kind: string;
  x: number | null;
  y: number | null;
  holder_id: number | null;
};

export type GameState = {
  hero: Hero;
  swordKillCount: number;
  cells: Cell[];
  creatures: Creature[];
  items: Item[];
};

export type Action =
  | { type: "pick-up"; itemId: number }
  | { type: "attack"; weaponId: number; targetId: number }
  | { type: "drink"; itemId: number }
  | { type: "move"; dx: number; dy: number }
  | { type: "stop" };

function distanceBetween(
  first: { x: number; y: number },
  second: { x: number; y: number },
): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function findPath(state: GameState, goal: (cell: Cell) => boolean): Cell[] {
  const blocked = new Set(
    state.creatures.map((creature) => `${creature.x},${creature.y}`),
  );
  const knownWalkable = new Map(
    state.cells
      .filter((cell) => cell.walkable && !blocked.has(`${cell.x},${cell.y}`))
      .map((cell) => [`${cell.x},${cell.y}`, cell]),
  );
  const startKey = `${state.hero.x},${state.hero.y}`;
  const queue = [knownWalkable.get(startKey)].filter(
    (cell): cell is Cell => cell !== undefined,
  );
  const previous = new Map<string, string | null>([[startKey, null]]);
  let destination: Cell | undefined;

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    if (goal(current)) {
      destination = current;
      break;
    }
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const neighborKey = `${current.x + dx},${current.y + dy}`;
      const neighbor = knownWalkable.get(neighborKey);
      if (neighbor && !previous.has(neighborKey)) {
        previous.set(neighborKey, `${current.x},${current.y}`);
        queue.push(neighbor);
      }
    }
  }

  if (!destination) {
    return [];
  }
  const reversedPath: Cell[] = [];
  let cursorKey: string | null = `${destination.x},${destination.y}`;
  while (cursorKey && cursorKey !== startKey) {
    const [coordinateX, coordinateY] = cursorKey.split(",").map(Number);
    reversedPath.push({
      x: coordinateX,
      y: coordinateY,
      walkable: true,
      visible: false,
    });
    cursorKey = previous.get(cursorKey) ?? null;
  }
  return reversedPath.reverse();
}

function firstStepToward(
  state: GameState,
  goal: (cell: Cell) => boolean,
): Action | null {
  const path = findPath(state, goal);
  const nextCell = path[0];
  return nextCell
    ? {
        type: "move",
        dx: nextCell.x - state.hero.x,
        dy: nextCell.y - state.hero.y,
      }
    : null;
}

export function planNextAction(state: GameState): Action {
  const carried = state.items.filter(
    (item) => item.holder_id === state.hero.id,
  );
  const potion = carried.find((item) => item.kind === "healing_potion");
  if (potion && state.hero.hp <= 17) {
    return { type: "drink", itemId: potion.id };
  }

  const sword = carried.find((item) => item.kind === "sword");
  const visibleRat = state.creatures
    .filter((creature) => creature.kind === "rat")
    .sort(
      (first, second) =>
        distanceBetween(state.hero, first) -
        distanceBetween(state.hero, second),
    )[0];
  if (state.swordKillCount === 0 && sword && visibleRat) {
    const adjacentDistance =
      Math.abs(visibleRat.x - state.hero.x) +
      Math.abs(visibleRat.y - state.hero.y);
    if (adjacentDistance === 1) {
      return { type: "attack", weaponId: sword.id, targetId: visibleRat.id };
    }
    const swordStep = firstStepToward(
      state,
      (cell) =>
        Math.abs(visibleRat.x - cell.x) + Math.abs(visibleRat.y - cell.y) === 1,
    );
    if (swordStep) {
      return swordStep;
    }
  }

  const reachableItem = state.items
    .filter(
      (item) =>
        item.holder_id === null &&
        item.x !== null &&
        item.y !== null &&
        Math.abs(item.x - state.hero.x) + Math.abs(item.y - state.hero.y) <= 1,
    )
    .sort((first, second) => first.id - second.id)[0];
  if (reachableItem) {
    return { type: "pick-up", itemId: reachableItem.id };
  }

  const bow = carried.find((item) => item.kind === "shortbow");
  if (
    bow &&
    visibleRat &&
    state.swordKillCount > 0 &&
    distanceBetween(state.hero, visibleRat) <= 4
  ) {
    return { type: "attack", weaponId: bow.id, targetId: visibleRat.id };
  }

  const floorItems = state.items
    .filter(
      (item) => item.holder_id === null && item.x !== null && item.y !== null,
    )
    .sort(
      (first, second) =>
        distanceBetween(state.hero, { x: first.x ?? 0, y: first.y ?? 0 }) -
        distanceBetween(state.hero, { x: second.x ?? 0, y: second.y ?? 0 }),
    );
  for (const item of floorItems) {
    if (item.x === null || item.y === null) {
      continue;
    }
    const step = firstStepToward(
      state,
      (cell) => Math.abs(cell.x - item.x!) + Math.abs(cell.y - item.y!) <= 1,
    );
    if (step) {
      return step;
    }
  }

  if (bow && visibleRat) {
    const step = firstStepToward(
      state,
      (cell) => distanceBetween(cell, visibleRat) <= 3.5,
    );
    if (step) {
      return step;
    }
  }

  const knownCoordinates = new Set(
    state.cells.map((cell) => `${cell.x},${cell.y}`),
  );
  const frontierCells = state.cells.filter(
    (cell) =>
      cell.walkable &&
      cell.visible &&
      [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].some(
        ([dx, dy]) => !knownCoordinates.has(`${cell.x + dx},${cell.y + dy}`),
      ),
  );
  frontierCells.sort(
    (first, second) =>
      distanceBetween(state.hero, first) - distanceBetween(state.hero, second),
  );
  for (const frontier of frontierCells) {
    const step = firstStepToward(
      state,
      (cell) => cell.x === frontier.x && cell.y === frontier.y,
    );
    if (step) {
      return step;
    }
  }

  return { type: "stop" };
}
