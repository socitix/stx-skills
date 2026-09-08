#!/usr/bin/env node
/**
 * ============================================================================
 *  relevance-card.test.mjs — failing tests for /stx-fix "relevance-section"
 * ============================================================================
 *
 *  Covers:
 *    issue-1 — stale "Coming Soon" pill + card linking to the June harness
 *              audit; must become a "Relevance · As of Fable 5.1" card that
 *              links to docs/stx-approach-validity-study-AUG2026.html.
 *    issue-2 — the card carries no relevance statement / reasons; must gain
 *              a <ul> of exactly 5 <li> items hitting five anchor phrases,
 *              and index.html must remain a byte-identical mirror of
 *              .claude/skills/stx-help-html/help.html.
 *
 *  Runner:  node --test tests/relevance-card.test.mjs
 *  Uses Node's built-in node:test + node:assert/strict — the repo has no
 *  vitest / playwright and adding dev deps is out of scope. Plain fs reads
 *  plus regex parsing; no HTML parser dependency.
 *
 *  This file is owned by the QA agent. The Coder must not edit it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const FILES = {
  help: path.join(REPO_ROOT, '.claude', 'skills', 'stx-help-html', 'help.html'),
  index: path.join(REPO_ROOT, 'index.html'),
};

const EXPECTED_HREF = 'docs/stx-approach-validity-study-AUG2026.html';
const EXPECTED_PILL = 'Relevance · As of Fable 5.1';
const ANCHOR_PHRASES = [
  'first-party canon',
  'reward-hacking',
  '2026 mainstream',
  '7 of 10',
  'choreography',
];

/** Decode the handful of entities that matter for these comparisons. */
function decodeEntities(s) {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#160;/g, ' ')
    .replace(/&#xa0;/gi, ' ')
    .replace(/&middot;/gi, '·')
    .replace(/&#183;/g, '·')
    .replace(/&#xb7;/gi, '·')
    .replace(/&amp;/gi, '&')
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–');
}

/** Strip tags, decode entities, collapse whitespace. */
function textOf(html) {
  return decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** Extract the `<a class="fable5-feature" …>…</a>` block (outer HTML). */
function extractCard(html, label) {
  const m = html.match(/<a\s[^>]*class="[^"]*\bfable5-feature\b[^"]*"[^>]*>[\s\S]*?<\/a>/i);
  assert.ok(m, `${label}: could not find <a class="fable5-feature"> card`);
  return m[0];
}

function readFile(key) {
  const p = FILES[key];
  assert.ok(fs.existsSync(p), `${key}: missing file ${p}`);
  return fs.readFileSync(p, 'utf8');
}

// ─────────────────────────────────────────────────────────────────────────────
// issue-1 — stale "Coming Soon" pill + card link to the June harness audit
// ─────────────────────────────────────────────────────────────────────────────
test('issue-1: no "Coming Soon"; pill reads "Relevance · As of Fable 5.1"; href points at the AUG2026 validity study', () => {
  for (const key of Object.keys(FILES)) {
    const html = readFile(key);
    const label = path.relative(REPO_ROOT, FILES[key]);

    // (a) No "Coming Soon" anywhere — case-insensitive, tolerate &nbsp; between words.
    const normalized = decodeEntities(html);
    const comingSoon = normalized.match(/coming\s+soon/i);
    const found = comingSoon ? comingSoon[0] : null;
    assert.equal(
      found,
      null,
      `${label}: still contains "Coming Soon" (found: ${JSON.stringify(found)} at offset ${comingSoon ? comingSoon.index : -1})`,
    );

    // (b) Pill text is exactly "Relevance · As of Fable 5.1" after entity normalization.
    const card = extractCard(html, label);
    const pill = card.match(/<span\s[^>]*class="[^"]*\bf5-pill\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
    assert.ok(pill, `${label}: card has no .f5-pill element`);
    assert.equal(textOf(pill[1]), EXPECTED_PILL, `${label}: .f5-pill text mismatch`);

    // (c) Card href is the AUG2026 validity study (file must exist in the worktree).
    const href = card.match(/<a\s[^>]*\bhref="([^"]*)"/i);
    assert.ok(href, `${label}: card has no href attribute`);
    assert.equal(href[1], EXPECTED_HREF, `${label}: card href mismatch`);
    assert.ok(
      fs.existsSync(path.join(REPO_ROOT, EXPECTED_HREF)),
      `${label}: linked study ${EXPECTED_HREF} does not exist in the repo`,
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// issue-2 — card carries no relevance statement / concise reasons
// ─────────────────────────────────────────────────────────────────────────────
test('issue-2: card has a <ul> with exactly 5 <li> hitting the five anchor phrases; index.html mirrors help.html byte-for-byte', () => {
  for (const key of Object.keys(FILES)) {
    const html = readFile(key);
    const label = path.relative(REPO_ROOT, FILES[key]);
    const card = extractCard(html, label);

    // (a) Exactly one <ul> inside the card.
    const uls = card.match(/<ul\b[^>]*>[\s\S]*?<\/ul>/gi) || [];
    assert.equal(uls.length, 1, `${label}: expected exactly 1 <ul> inside the card, found ${uls.length}`);

    // (b) Exactly 5 <li> items.
    const lis = uls[0].match(/<li\b[^>]*>[\s\S]*?<\/li>/gi) || [];
    assert.equal(lis.length, 5, `${label}: expected exactly 5 <li> items, found ${lis.length}`);

    // (c) Combined text contains each anchor phrase (case-insensitive substring).
    const combined = textOf(uls[0]).toLowerCase();
    for (const phrase of ANCHOR_PHRASES) {
      assert.ok(
        combined.includes(phrase.toLowerCase()),
        `${label}: bullet list is missing anchor phrase "${phrase}"\n  list text: ${combined}`,
      );
    }
  }

  // (d) index.html is a generated mirror of help.html — must be byte-identical.
  const helpBuf = fs.readFileSync(FILES.help);
  const indexBuf = fs.readFileSync(FILES.index);
  assert.ok(
    helpBuf.equals(indexBuf),
    'index.html is not byte-identical to .claude/skills/stx-help-html/help.html (run `npm run build`)',
  );
});
