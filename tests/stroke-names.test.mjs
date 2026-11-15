import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const names = JSON.parse(await readFile(new URL('../data/stroke-names.json', import.meta.url), 'utf8'));

test('optional name mapping stays limited, sourced and independently licensed', async () => {
  assert.equal(names.schemaVersion, 1);
  assert.equal(names.source.version, '3.2.6');
  assert.equal(names.source.license, 'MIT');
  assert.equal(names.source.url, 'https://github.com/theajack/cnchar');
  assert.deepEqual(Object.keys(names.characters), Array.from('一二三十土王木本大天人口日月中上下干工川手千小永水'));
  assert.match(names.source.notice, /不同数据源/);
  assert.ok(names.source.caveats.some(value => /未收录/.test(value)));
  assert.ok(names.source.caveats.some(value => /自动推断/.test(value)));
  for (const item of names.source.packages) {
    assert.equal(item.version, '3.2.6');
    assert.match(item.url, /^https:\/\/registry\.npmjs\.org\/cnchar/);
    assert.match(item.archiveSha256, /^[a-f0-9]{64}$/);
    assert.match(item.codeSha256, /^[a-f0-9]{64}$/);
  }
  const license = await readFile(new URL('../licenses/Cnchar-MIT.txt', import.meta.url), 'utf8');
  assert.match(license, /Copyright \(c\) 2017 - present theajack/);
  assert.match(license, /The MIT License/);
});

test('each name sequence is tied to the exact bundled glyph snapshot and stroke count', async () => {
  for (const [character, sequence] of Object.entries(names.characters)) {
    const bytes = await readFile(new URL(`../data/characters/${character}.json`, import.meta.url));
    const glyph = JSON.parse(bytes.toString('utf8'));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), names.source.glyphSha256[character], `Review ${character} after a glyph update`);
    assert.equal(glyph.character, character);
    assert.equal(glyph.strokes.length, sequence.length, character);
    assert.equal(glyph.medians.length, sequence.length, character);
    assert.ok(sequence.every(name => name === null || /^[\p{Script=Han}]{1,20}$/u.test(name)), character);
  }
  assert.equal(names.characters.橋, undefined, 'Unreviewed characters must not get inferred names');
});

test('reviewed basic names follow their source sequence and ambiguous source slots stay blank', () => {
  assert.deepEqual(names.characters.木, ['横', '竖', '撇', '捺']);
  assert.deepEqual(names.characters.王, ['横', '横', '竖', '横']);
  assert.deepEqual(names.characters.手, ['撇', '横', '横', '竖钩']);
  assert.deepEqual(names.characters.永, ['点', '横折钩', null, '撇', '捺']);
  assert.deepEqual(names.characters.水, ['竖钩', null, '撇', '捺']);
  assert.equal(Object.values(names.characters).flat().filter(value => value === null).length, 2);
});
