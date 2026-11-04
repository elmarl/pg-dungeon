import assert from 'node:assert/strict'
import test from 'node:test'
import { isRefusedCommand } from '../src/console/console.js'

test('SQL comments are refused so they cannot hide transaction commands', () => {
  assert.equal(isRefusedCommand('/* note */ rollback'), true)
})

test('transaction commands in later SQL statements are refused', () => {
  assert.equal(isRefusedCommand("select 'safe'; rollback"), true)
})

test('transaction words inside SQL string literals are allowed', () => {
  assert.equal(isRefusedCommand("select 'rollback'"), false)
})

test('a trailing semicolon is allowed', () => {
  assert.equal(isRefusedCommand('select 1;'), false)
})
