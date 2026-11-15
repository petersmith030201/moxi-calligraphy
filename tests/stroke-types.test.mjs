import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const bytes = await readFile(new URL('../data/stroke-types.json', import.meta.url));
const types = JSON.parse(bytes.toString('utf8'));
const metadataBytes = await readFile(new URL('../data/characters.json', import.meta.url));
const metadata = JSON.parse(metadataBytes.toString('utf8'));
const sha256 = value => createHash('sha256').update(value).digest('hex');

test('whole-character types preserve pinned CNChar sources, license and conversion provenance', async () => {
  assert.equal(types.schemaVersion, 1);
  assert.equal(types.source.version, '3.2.6');
  assert.equal(types.source.license, 'MIT');
  assert.equal(types.source.referenceMode, 'character-types-only');
  assert.equal(types.source.mapsToAnimationStrokeIndex, false);
  assert.match(types.source.notice, /不对应动画第几笔/);
  assert.match(types.source.caveats.join('\n'), /多个名称/);
  assert.match(types.source.caveats.join('\n'), /不表示它们一定同时出现/);
  assert.equal(types.source.inputMetadataSha256, sha256(metadataBytes));
  assert.deepEqual(types.source.conversions.normalizedLabels, { 点2: '点' });
  assert.equal(types.source.conversions.normalizedPoint2Occurrences, 1706);
  const license = await readFile(new URL('../licenses/Cnchar-MIT.txt', import.meta.url));
  assert.deepEqual(types.source.packages.map(item => item.name), ['cnchar', 'cnchar-order', 'cnchar-trad']);
  assert.deepEqual(types.source.packages.map(item => item.archiveSha256), [
    '4d02768878d178b5944b54b1bb92b319111d06082e3978347ab2305902af6d92',
    '98112307108d5815203d6eeafae05fac332f2040433f006782e305e96e729d58',
    '89904ebd94780c89be07f39f67be3c1734314a0fbb08e7f8388e5b3b907231f4',
  ]);
  for (const item of types.source.packages) {
    assert.equal(item.version, '3.2.6');
    assert.equal(item.licenseSha256, sha256(license));
    assert.match(item.codeSha256, /^[a-f0-9]{64}$/);
    assert.equal(item.url, `https://registry.npmjs.org/${item.name}/-/${item.name}-3.2.6.tgz`);
  }
});

test('coverage is explicit and each recognized type is a unique legal label from a bundled character', () => {
  const coverage = types.source.coverage;
  assert.equal(coverage.queriedCharacters, Object.keys(metadata).length);
  assert.equal(coverage.queriedCharacters, 9574);
  assert.equal(coverage.coveredCharacters, Object.keys(types.characters).length);
  assert.equal(coverage.coveredCharacters, 8776);
  assert.equal(coverage.missingCharacters, 798);
  assert.equal(coverage.rejectedCharacters, 0);
  assert.equal(coverage.coveredCharacters + coverage.missingCharacters + coverage.rejectedCharacters, coverage.queriedCharacters);
  assert.equal(coverage.ambiguousCharacters, Object.keys(types.ambiguousTypes).length);
  assert.equal(coverage.ambiguousOccurrences, 3323);
  for (const [character, names] of Object.entries(types.characters)) {
    assert.ok(Object.hasOwn(metadata, character));
    assert.ok(Array.isArray(names) && names.length > 0);
    assert.equal(new Set(names).size, names.length, character);
    assert.ok(names.every(name => /^[\p{Script=Han}]{1,20}$/u.test(name)), character);
  }
  assert.ok(bytes.length < 2 * 1024 * 1024);
});

test('simple and traditional characters have independent whole-character type lists', () => {
  assert.deepEqual(types.characters.木, ['横', '竖', '撇', '捺']);
  assert.deepEqual(types.characters.三, ['横']);
  assert.deepEqual(types.characters.桥, ['横', '竖', '撇', '点', '捺']);
  assert.deepEqual(types.characters.橋, ['横', '竖', '撇', '点', '捺', '横折', '横折钩']);
  assert.deepEqual(types.characters.马, ['横折', '竖折折钩', '横']);
  assert.deepEqual(types.characters.馬, ['横', '竖', '横折钩', '点']);
  assert.deepEqual(types.characters.鸟, ['撇', '横折钩', '点', '竖折折钩', '横']);
  assert.deepEqual(types.characters.鳥, ['撇', '竖', '横折', '横', '横折钩', '点']);
});

test('ambiguous names are preserved and marked as candidate alternatives, not animation index labels', () => {
  assert.deepEqual(types.characters.永, ['点', '横折钩', '横撇', '横钩', '撇', '捺']);
  assert.deepEqual(types.ambiguousTypes.永, ['横撇', '横钩']);
  assert.deepEqual(types.ambiguousTypes.水, ['横撇', '横钩']);
  assert.equal(types.ambiguousTypes.木, undefined);
  assert.deepEqual(types.source.conversions.ambiguousLabels['横撇|横钩'], ['横撇', '横钩']);
  for (const [character, candidates] of Object.entries(types.ambiguousTypes)) {
    assert.ok(candidates.length > 1);
    assert.equal(candidates.length, new Set(candidates).size);
    assert.ok(candidates.every(name => types.characters[character].includes(name)));
  }
});

test('characters missing from the name source stay unfilled even when animation metadata exists', () => {
  assert.ok(Object.hasOwn(metadata, '⺀'));
  assert.equal(types.characters['⺀'], undefined);
  assert.equal(types.ambiguousTypes['⺀'], undefined);
  for (const character of ['𠮷', '𰻞', '龘']) {
    assert.equal(types.characters[character], undefined);
    assert.equal(types.ambiguousTypes[character], undefined);
  }
});
