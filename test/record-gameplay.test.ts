import assert from "node:assert/strict";
import test from "node:test";

import { type GameState, planNextAction } from "../scripts/gameplay-plan.js";

const state: GameState = {
  hero: { id: 1, x: 2, y: 2, hp: 30 },
  swordKillCount: 0,
  cells: [
    { x: 1, y: 2, walkable: true, visible: true },
    { x: 2, y: 2, walkable: true, visible: true },
    { x: 3, y: 2, walkable: true, visible: true },
    { x: 4, y: 2, walkable: true, visible: true },
  ],
  creatures: [],
  items: [{ id: 7, kind: "shortbow", x: 3, y: 2, holder_id: null }],
};

test("the gameplay plan picks up an item within reach", () => {
  assert.deepEqual(planNextAction(state), { type: "pick-up", itemId: 7 });
});

test("the gameplay plan attacks a visible rat with the shortbow", () => {
  const combatState: GameState = {
    ...state,
    swordKillCount: 1,
    items: [{ id: 8, kind: "shortbow", x: null, y: null, holder_id: 1 }],
    creatures: [{ id: 2, kind: "rat", x: 4, y: 2, hp: 4 }],
  };

  assert.deepEqual(planNextAction(combatState), {
    type: "attack",
    weaponId: 8,
    targetId: 2,
  });
});

test("the gameplay plan closes in for its first rat kill with the sword", () => {
  const combatState: GameState = {
    ...state,
    creatures: [{ id: 2, kind: "rat", x: 4, y: 2, hp: 4 }],
    items: [
      { id: 8, kind: "shortbow", x: null, y: null, holder_id: 1 },
      { id: 9, kind: "sword", x: null, y: null, holder_id: 1 },
    ],
  };

  assert.deepEqual(planNextAction(combatState), {
    type: "move",
    dx: 1,
    dy: 0,
  });
});

test("the gameplay plan swings the sword at an adjacent rat before its first kill", () => {
  const combatState: GameState = {
    ...state,
    creatures: [{ id: 2, kind: "rat", x: 3, y: 2, hp: 4 }],
    items: [
      { id: 8, kind: "shortbow", x: null, y: null, holder_id: 1 },
      { id: 9, kind: "sword", x: null, y: null, holder_id: 1 },
    ],
  };

  assert.deepEqual(planNextAction(combatState), {
    type: "attack",
    weaponId: 9,
    targetId: 2,
  });
});

test("the gameplay plan resumes using the bow after it has killed with the sword", () => {
  const combatState: GameState = {
    ...state,
    swordKillCount: 1,
    creatures: [{ id: 2, kind: "rat", x: 4, y: 2, hp: 4 }],
    items: [
      { id: 8, kind: "shortbow", x: null, y: null, holder_id: 1 },
      { id: 9, kind: "sword", x: null, y: null, holder_id: 1 },
    ],
  };

  assert.deepEqual(planNextAction(combatState), {
    type: "attack",
    weaponId: 8,
    targetId: 2,
  });
});
