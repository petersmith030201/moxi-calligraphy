import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, mkdtemp, copyFile, writeFile, access, rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const json = async relative => JSON.parse(await readFile(path.join(root, relative), 'utf8'));

test('three local textbook versions account for 132 PDF pages', async () => {
  const books = await json('data/books.json');
  assert.equal(books.length, 3);
  assert.equal(new Set(books.map(book => book.id)).size, 3);
  assert.equal(books.reduce((sum, book) => sum + book.pageCount, 0), 132);
  for (const book of books) {
    assert.equal(book.localOnly, true, book.id);
    assert.match(book.sha256, /^[a-f0-9]{64}$/);
    assert.ok(book.fileName.endsWith('.pdf'));
    assert.ok(!book.url && !book.pdfUrl, 'Textbooks must not acquire a remote download link');
    assert.ok(Array.isArray(book.reviewedPages));
    for (const page of book.reviewedPages) assert.ok(Number.isInteger(page) && page >= 1 && page <= book.pageCount);
  }
});

test('every published teaching claim resolves to a reviewed page of a known book', async () => {
  const books = new Map((await json('data/books.json')).map(book => [book.id, book]));
  const files = (await readdir(path.join(root, 'data'))).filter(name => name.endsWith('-rules.json'));
  assert.ok(files.length >= 3, 'All three textbook extracts must be present before publishing');
  const ids = new Set();
  const representedBooks = new Set();
  for (const file of files) {
    const rules = await json(`data/${file}`);
    assert.ok(Array.isArray(rules) && rules.length > 0, file);
    for (const rule of rules) {
      assert.equal(ids.has(rule.id), false, `Duplicate source id: ${rule.id}`);
      ids.add(rule.id);
      const book = books.get(rule.bookId);
      assert.ok(book, `Unknown book in ${rule.id}`);
      representedBooks.add(rule.bookId);
      assert.ok(Number.isInteger(rule.pdfPage) && rule.pdfPage >= 1 && rule.pdfPage <= book.pageCount, rule.id);
      assert.ok(book.reviewedPages.includes(rule.pdfPage), `Unreviewed source page in ${rule.id}`);
      assert.ok(['paraphrase', 'observation'].includes(rule.kind), `Unsupported evidence type in ${rule.id}`);
      assert.equal(rule.reviewed, true);
      for (const field of ['title', 'text', 'practice', 'conditions', 'sourceNote']) assert.ok(typeof rule[field] === 'string' && rule[field].trim(), `${rule.id}: ${field}`);
      for (const field of ['topics', 'structures', 'components', 'characters']) assert.ok(Array.isArray(rule[field]), `${rule.id}: ${field}`);
      assert.ok(rule.printedPage === null || typeof rule.printedPage === 'string' || typeof rule.printedPage === 'number');
    }
  }
  assert.equal(representedBooks.size, 3);
});

test('available character metadata matches the self-hosted stroke data, independently of the book title 5000', async () => {
  const characters = await json('data/characters.json');
  const names = await readdir(path.join(root, 'data/characters'));
  assert.ok(Object.keys(characters).length > 0);
  assert.equal(names.filter(name => name.endsWith('.json')).length, Object.keys(characters).length);
  for (const [character, entry] of Object.entries(characters)) {
    const geometry = await json(`data/characters/${character}.json`);
    assert.equal(entry.strokesCount, geometry.strokes.length, character);
    assert.equal(geometry.medians.length, geometry.strokes.length, character);
    assert.ok(geometry.strokes.every(stroke => typeof stroke === 'string' && stroke.length > 0), character);
    assert.ok(geometry.medians.every(points => Array.isArray(points) && points.length >= 2 && points.every(p => p.length === 2 && p.every(Number.isFinite))), character);
    assert.match(entry.source, /Make Me a Hanzi/);
    assert.ok(entry.licenses.length > 0);
    assert.match(entry.glyphLabel, /非.*真迹/);
  }
});

test('browser and AI service share the same published evidence identities and source content', async () => {
  const knowledge = await json('data/knowledge.json');
  assert.ok(typeof knowledge.version === 'string' && knowledge.version.length > 0);
  const sourceRules = new Map();
  for (const name of (await readdir(path.join(root, 'data'))).filter(name => name.endsWith('-rules.json'))) {
    for (const rule of await json(`data/${name}`)) sourceRules.set(rule.id, rule);
  }
  assert.equal(knowledge.rules.length, sourceRules.size);
  assert.equal(new Set(knowledge.rules.map(rule => rule.id)).size, knowledge.rules.length);
  for (const rule of knowledge.rules) assert.deepEqual(rule, sourceRules.get(rule.id), rule.id);
  assert.deepEqual(knowledge.books, await json('data/books.json'));
});

test('HTML and CSS load static assets without a public CDN', async () => {
  const html = await readFile(path.join(root, 'index.html'), 'utf8');
  const css = await readFile(path.join(root, 'styles.css'), 'utf8');
  assert.doesNotMatch(html, /<(?:script|img|iframe|source|link)\b[^>]*(?:src|href)\s*=\s*["'](?:https?:)?\/\//i);
  assert.doesNotMatch(css, /(?:url\(\s*["']?|@import\s*["'])(?:https?:)?\/\//i);
});

async function withBuildFixture(action) {
  const fixtureParent = path.join(root, 'work');
  await mkdir(fixtureParent, { recursive: true });
  const fixture = await mkdtemp(path.join(fixtureParent, 'static-build-test-'));
  try {
    await mkdir(path.join(fixture, 'tools'));
    await copyFile(path.join(root, 'tools/build-static.mjs'), path.join(fixture, 'tools/build-static.mjs'));
    for (const directory of ['data', 'vendor', 'licenses']) await mkdir(path.join(fixture, directory));
    for (const name of ['index.html', 'styles.css', 'app.js', 'pdf-local.js']) await writeFile(path.join(fixture, name), name === 'index.html' ? '<!doctype html><html></html>' : '');
    await writeFile(path.join(fixture, 'data/example.json'), '[]');
    await writeFile(path.join(fixture, 'vendor/example.mjs'), 'export const example = true;');
    await writeFile(path.join(fixture, 'licenses/LICENSE'), 'Fixture only.');
    await action(fixture, () => spawnSync(process.execPath, ['tools/build-static.mjs'], { cwd: fixture, encoding: 'utf8' }));
  } finally {
    const canonicalParent = await realpath(fixtureParent);
    const canonicalFixture = await realpath(fixture);
    assert.ok(path.dirname(canonicalFixture) === canonicalParent && path.basename(canonicalFixture).startsWith('static-build-test-'));
    await rm(canonicalFixture, { recursive: true });
  }
}

test('repeated builds remove stale output and publish only the approved tree', async () => {
  await withBuildFixture(async (fixture, build) => {
    await writeFile(path.join(fixture, 'private-textbook.pdf'), '%PDF-1.7\n');
    await writeFile(path.join(fixture, '.env'), 'PRIVATE_TOKEN=fixture');
    let result = build();
    assert.equal(result.status, 0, result.stderr);
    await writeFile(path.join(fixture, 'dist/stale.txt'), 'This old file must not remain public.');
    result = build();
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual((await readdir(path.join(fixture, 'dist'))).sort(), ['.nojekyll', 'app.js', 'data', 'index.html', 'licenses', 'pdf-local.js', 'styles.css', 'vendor']);
    await assert.rejects(access(path.join(fixture, 'dist/stale.txt')));
    await assert.rejects(access(path.join(fixture, 'dist/private-textbook.pdf')));
    await assert.rejects(access(path.join(fixture, 'dist/.env')));
  });
});

test('contaminated publishable folders fail before replacing the last successful artifact', async () => {
  await withBuildFixture(async (fixture, build) => {
    assert.equal(build().status, 0);
    await writeFile(path.join(fixture, 'data/page.png'), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    let result = build();
    assert.notEqual(result.status, 0);
    await access(path.join(fixture, 'dist/index.html'));
    await rm(path.join(fixture, 'data/page.png'));
    const fakeCredential = 'sk-' + 'TEST_NOT_A_REAL_CREDENTIAL'.repeat(3);
    await writeFile(path.join(fixture, 'data/example.json'), JSON.stringify({ fakeCredential }));
    result = build();
    assert.notEqual(result.status, 0);
    assert.equal(await readFile(path.join(fixture, 'dist/data/example.json'), 'utf8'), '[]');
  });
});
