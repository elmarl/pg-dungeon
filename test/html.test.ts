import assert from "node:assert/strict";
import test from "node:test";
import { escapeHtml } from "../src/html.js";

test("escapeHtml replaces HTML-sensitive characters", () => {
  assert.equal(
    escapeHtml(`<tag attr="value">&`),
    "&#60;tag attr=&#34;value&#34;&#62;&#38;",
  );
});

test("escapeHtml converts nullish values to an empty string", () => {
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(undefined), "");
});

test("escapeHtml stringifies other values", () => {
  assert.equal(escapeHtml(42), "42");
  assert.equal(escapeHtml(false), "false");
});
