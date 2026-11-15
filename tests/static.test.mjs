import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, mkdtemp, copyFile, writeFile, access, rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const json = async relative => JSON.parse(await readFile(path.join(root, relative), 'utf8'));
const exists = async relative => access(path.join(root, relative)).then(() => true, () => false);
const metadataPromise = json('data/characters.json');

function localAsset(reference, owner = 'index.html') {
  const url = new URL(reference, new URL(owner, 'https://moxi.invalid/'));
  assert.equal(url.origin, 'https://moxi.invalid', reference);
  const absolute = path.resolve(root, decodeURIComponent(url.pathname).slice(1));
  const back = path.relative(root, absolute);
  assert.ok(back && back !== '..' && !back.startsWith('..' + path.sep) && !path.isAbsolute(back), reference);
  return { absolute, url };
}

function validSvgPath(value) {
  assert.equal(typeof value, 'string');
  const tokens = value.match(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g) || [];
  assert.equal(value.replace(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?|[\s,]/g, ''), '');
  assert.match(tokens[0] || '', /^[Mm]$/);
  const arity = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };
  let position = 0;
  while (position < tokens.length) {
    const command = tokens[position++].toLowerCase();
    assert.ok(Object.hasOwn(arity, command), `Expected SVG command: ${command}`);
    const start = position;
    while (position < tokens.length && !/^[a-z]$/i.test(tokens[position])) {
      const coordinate = Number(tokens[position++]);
      assert.ok(Number.isFinite(coordinate) && Math.abs(coordinate) < 1e6);
    }
    const count = position - start;
    if (arity[command] === 0) assert.equal(count, 0);
    else assert.ok(count >= arity[command] && count % arity[command] === 0, `Invalid parameter count for ${command}`);
  }
}

test('every character record keeps complete provenance and honest unknown structure fields', async () => {
  const metadata = await metadataPromise;
  assert.ok(Object.keys(metadata).length > 0);
  for (const [character, record] of Object.entries(metadata)) {
    assert.equal(Array.from(character).length, 1, character);
    assert.ok(Number.isInteger(record.strokesCount) && record.strokesCount > 0, character);
    for (const field of ['radical', 'decomposition', 'structure', 'source', 'sourceUrl', 'glyphLabel']) assert.ok(typeof record[field] === 'string' && record[field].trim(), `${character}: ${field}`);
    assert.equal(typeof record.reviewed, 'boolean');
    assert.match(record.source, /Make Me a Hanzi/);
    assert.match(record.sourceUrl, /^https:\/\/github\.com\/skishore\/makemeahanzi(?:\/|$)/);
    assert.ok(Array.isArray(record.licenses) && record.licenses.some(x => /LGPL/i.test(x)) && record.licenses.some(x => /Arphic/i.test(x)), character);
    assert.match(record.glyphLabel, /(?:非|不是).*真迹/);
    if (/[？?]/.test(record.decomposition) && !/待核对|未知|不确定/.test(record.structure)) {
      assert.equal(record.structure, '独体字', character);
      assert.match(record.structureSource || '', /参考校正/, character);
      assert.match(record.reviewNotes || '', /原始IDS/, character);
    }
  }
});

test('all packaged SVG strokes and medians match the metadata one for one', async () => {
  const metadata = await metadataPromise;
  const names = await readdir(path.join(root, 'data/characters'), { withFileTypes: true });
  assert.ok(names.every(item => item.isFile() && item.name.endsWith('.json')), 'Character directory must not contain other assets or subdirectories');
  assert.deepEqual(names.map(item => item.name.slice(0, -5)).sort(), Object.keys(metadata).sort());
  for (const [character, entry] of Object.entries(metadata)) {
    const geometry = await json(`data/characters/${character}.json`);
    assert.equal(geometry.strokes.length, entry.strokesCount, character);
    assert.equal(geometry.medians.length, geometry.strokes.length, character);
    for (const stroke of geometry.strokes) validSvgPath(stroke);
    assert.ok(geometry.medians.every(points => Array.isArray(points) && points.length >= 2 && points.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))), character);
  }
});

test('source manifest identifies the snapshot and independent dictionary/graphics licenses', async () => {
  const manifest = await json('data/source-manifest.json');
  const metadata = await metadataPromise;
  assert.match(manifest.retrievedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(manifest.metadataCount, Object.keys(metadata).length);
  assert.ok(typeof manifest.coverageNote === 'string' && manifest.coverageNote.length > 0);
  assert.ok(manifest.dataset);
  assert.ok(manifest.licenses);
  assert.ok(Array.isArray(manifest.resources) && manifest.resources.length >= 3);
  for (const resource of manifest.resources) {
    assert.ok(resource.file);
    assert.match(resource.sha256, /^[a-f0-9]{64}$/);
    assert.doesNotMatch(resource.file, /pdfjs/i);
  }
  assert.ok(manifest.resources.some(x => x.file === 'dictionary.txt'));
  assert.ok(manifest.resources.some(x => x.file === 'graphics.txt'));
  for (const name of ['makemeahanzi-COPYING', 'makemeahanzi-LGPL', 'ARPHICPL.TXT', 'hanzi-writer-LICENSE', 'Moxi-Book-Serif-OFL.txt']) await access(path.join(root, 'licenses', name));
  const font = await readFile(path.join(root, 'vendor/fonts/moxi-book-serif.woff2'));
  assert.equal(font.subarray(0, 4).toString(), 'wOF2');
  assert.ok(font.length > 1000);
});

test('active entry points have no legacy PDF/AI payloads or remote static/CDN imports', async () => {
  const html = await readFile(path.join(root, 'index.html'), 'utf8');
  const css = await readFile(path.join(root, 'styles.css'), 'utf8');
  assert.doesNotMatch(html, /<(?:script|img|iframe|source|link)\b[^>]*(?:src|href)\s*=\s*["'](?:https?:)?\/\//i);
  assert.doesNotMatch(css, /(?:url\(\s*["']?|@import\s*["'])(?:https?:)?\/\//i);
  for (const tag of html.matchAll(/<(?:script|link)\b[^>]*>/gi)) {
    const reference = tag[0].match(/\b(?:src|href)\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!reference) continue;
    const asset = localAsset(reference);
    await access(asset.absolute);
    if (['/app.js', '/styles.css'].includes(asset.url.pathname)) assert.equal(asset.url.searchParams.get('v'), '0.3.0', reference);
  }
  const activeNames = ['index.html', 'styles.css', 'app.js', 'model.js'];
  if (await exists('store.js')) activeNames.push('store.js');
  for (const name of activeNames) {
    const contents = await readFile(path.join(root, name), 'utf8');
    assert.doesNotMatch(contents, /(?:pdf-local\.js|pdf\.worker\.mjs|data\/(?:knowledge|books|(?:atlas|strokes|structure)-rules)\.json)/i, name);
    assert.doesNotMatch(contents, /(?:import\s+(?:[^;]*?\sfrom\s*)?|import\(|fetch\()\s*["'](?:https?:)?\/\//i, name);
    if (name.endsWith('.js')) {
      for (const match of contents.matchAll(/\bfrom\s*["'](\.\.?\/[^"']+)["']/g)) {
        const asset = localAsset(match[1], name);
        await access(asset.absolute);
        if (name === 'app.js' && ['/model.js', '/store.js'].includes(asset.url.pathname)) assert.equal(asset.url.searchParams.get('v'), '0.3.0', match[1]);
      }
    }
  }
});

test('knowledge library is the sole new-note entry and offers collapsed first-use and component help', async () => {
  const html = await readFile(path.join(root, 'index.html'), 'utf8');
  const app = await readFile(path.join(root, 'app.js'), 'utf8');
  const notebook = html.match(/<section\b[^>]*\bid=["']page-notebook["'][^>]*>([\s\S]*?)<\/section>/i)?.[1];
  assert.ok(notebook, 'Knowledge library section must exist');
  assert.equal([...html.matchAll(/<button\b[^>]*\bid=["']new-note["'][^>]*>/gi)].length, 1);
  assert.match(notebook, /<button\b[^>]*\bid=["']new-note["']/i);
  assert.doesNotMatch(html + app, /add-character-note|add-structure-note/);
  for (const id of ['component-help', 'first-use-help']) {
    const pattern = new RegExp(`<details\\b([^>]*\\bid=["']${id}["'][^>]*)>([\\s\\S]*?)<\\/details>`, 'i');
    const details = html.match(pattern);
    assert.ok(details, `${id} must exist`);
    assert.doesNotMatch(details[1], /\bopen(?:\s|=|$)/i, `${id} should start collapsed`);
    assert.match(details[2], /<summary\b[^>]*>[^<]+<\/summary>/i);
    const text = details[2].replace(/<[^>]*>/g, ' ');
    for (const character of ['河', '氵']) assert.ok(text.includes(character), `${id}: ${character}`);
    if (id === 'component-help') assert.ok(text.includes('可'));
    if (id === 'first-use-help') {
      assert.match(text, /不是教材原文/);
      assert.match(text, /分类/);
      assert.match(text, /导出/);
    }
  }
});

async function withBuildFixture(action) {
  const fixtureParent = path.join(root, 'work');
  await mkdir(fixtureParent, { recursive: true });
  const fixture = await mkdtemp(path.join(fixtureParent, 'static-build-test-'));
  try {
    for (const directory of ['tools', 'data/characters', 'vendor/fonts', 'licenses', 'worker']) await mkdir(path.join(fixture, directory), { recursive: true });
    await copyFile(path.join(root, 'tools/build-static.mjs'), path.join(fixture, 'tools/build-static.mjs'));
    for (const name of ['index.html', 'styles.css', 'app.js', 'model.js']) await writeFile(path.join(fixture, name), name === 'index.html' ? '<!doctype html><html></html>' : '');
    for (const name of ['data/characters.json', 'data/source-manifest.json', 'data/characters/一.json']) await writeFile(path.join(fixture, name), '{}');
    await writeFile(path.join(fixture, 'vendor/hanzi-writer.min.js'), '/* fixture */');
    await writeFile(path.join(fixture, 'vendor/fonts/moxi-book-serif.woff2'), 'wOF2fixture');
    await writeFile(path.join(fixture, 'licenses/LICENSE'), 'Fixture only.');
    for (const name of ['data/knowledge.json', 'data/books.json', 'data/atlas-rules.json', 'data/strokes-rules.json', 'data/structure-rules.json', 'pdf-local.js', 'vendor/pdf.mjs', 'vendor/pdf.worker.mjs', 'worker/index.js']) await writeFile(path.join(fixture, name), 'LEGACY_NOT_PUBLIC');
    await action(fixture, () => spawnSync(process.execPath, ['tools/build-static.mjs'], { cwd: fixture, encoding: 'utf8' }));
  } finally {
    const canonicalParent = await realpath(fixtureParent);
    const canonicalFixture = await realpath(fixture);
    assert.ok(path.dirname(canonicalFixture) === canonicalParent && path.basename(canonicalFixture).startsWith('static-build-test-'));
    await rm(canonicalFixture, { recursive: true });
  }
}

test('repeated builds remove stale output, preserve source files and exclude legacy payloads', async () => {
  await withBuildFixture(async (fixture, build) => {
    await writeFile(path.join(fixture, 'private-textbook.pdf'), '%PDF-1.7\n');
    await writeFile(path.join(fixture, '.env'), 'PRIVATE_TOKEN=fixture');
    let result = build();
    assert.equal(result.status, 0, result.stderr);
    await writeFile(path.join(fixture, 'dist/stale.txt'), 'This old file must not remain public.');
    await writeFile(path.join(fixture, 'store.js'), 'export const store = {};');
    result = build();
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual((await readdir(path.join(fixture, 'dist'))).sort(), ['.nojekyll', 'app.js', 'data', 'index.html', 'licenses', 'model.js', 'store.js', 'styles.css', 'vendor']);
    assert.deepEqual((await readdir(path.join(fixture, 'dist/data'))).sort(), ['characters', 'characters.json', 'source-manifest.json']);
    assert.deepEqual((await readdir(path.join(fixture, 'dist/vendor'))).sort(), ['fonts', 'hanzi-writer.min.js']);
    assert.deepEqual(await readdir(path.join(fixture, 'dist/vendor/fonts')), ['moxi-book-serif.woff2']);
    await assert.rejects(access(path.join(fixture, 'dist/stale.txt')));
    await assert.rejects(access(path.join(fixture, 'dist/private-textbook.pdf')));
    await assert.rejects(access(path.join(fixture, 'dist/.env')));
    await access(path.join(fixture, 'data/knowledge.json'));
    await access(path.join(fixture, 'worker/index.js'));
  });
});

test('contaminated character assets fail before replacing a successful build', async () => {
  await withBuildFixture(async (fixture, build) => {
    assert.equal(build().status, 0);
    await writeFile(path.join(fixture, 'data/characters/page.png'), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    let result = build();
    assert.notEqual(result.status, 0);
    await access(path.join(fixture, 'dist/index.html'));
    await rm(path.join(fixture, 'data/characters/page.png'));
    const fakeCredential = 'sk-' + 'TEST_NOT_A_REAL_CREDENTIAL'.repeat(3);
    await writeFile(path.join(fixture, 'data/characters/一.json'), JSON.stringify({ fakeCredential }));
    result = build();
    assert.notEqual(result.status, 0);
    assert.equal(await readFile(path.join(fixture, 'dist/data/characters/一.json'), 'utf8'), '{}');
  });
});
