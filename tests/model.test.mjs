import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  normalizeNote, normalizeOverride, analyzeCharacter, matchNotes,
  makeBackup, planImport, applyImport,
} from '../model.js';

const stamp = '2026-11-15T00:00:00.000Z';
const metadata = JSON.parse(await readFile(new URL('../data/characters.json', import.meta.url), 'utf8'));
const fixture = {
  森: { decomposition: '⿱木⿰木木', structure: '上下结构', radical: '木', source: '测试夹具' },
  河: { decomposition: '⿰氵可', structure: '左右结构', radical: '氵', source: '测试夹具' },
  打: { decomposition: '⿰扌丁', structure: '左右结构', radical: '扌', source: '测试夹具' },
  困: { decomposition: '⿴囗木', structure: '全包围结构', radical: '囗', source: '测试夹具' },
};

function note(id, fields = {}) {
  return normalizeNote({
    id, title: '观察记录', kind: 'character', target: '桥', position: 'any', scope: 'top',
    conditions: '', content: '先观察，再按自己确认的规则练习。', examples: [], source: '个人观察',
    createdAt: stamp, updatedAt: stamp, ...fields,
  });
}
function correction(fields = {}) {
  return normalizeOverride({
    character: '河', radical: '氵', decomposition: '⿰氵可', structure: '左右结构',
    components: [{ name: '氵', position: 'left' }, { name: '可', position: 'right' }],
    updatedAt: stamp, ...fields,
  });
}
function resultIds(result, group) { return result[group].map(item => item.note.id).sort(); }
function allIds(result) { return ['exact', 'applicable', 'candidates'].flatMap(group => resultIds(result, group)).sort(); }

test('normalization preserves the user body, conditions and source byte-for-byte', () => {
  const body = '  第一行：不要替我改写。\n\n第二行 <b>只是记录</b>\t  ';
  const conditions = '  仅在这一例中适用\n待复核  ';
  const source = '  自己的课堂笔记，第3页\n';
  const normalized = note('raw-text', { content: body, conditions, source });
  assert.equal(normalized.content, body);
  assert.equal(normalized.conditions, conditions);
  assert.equal(normalized.source, source);
  assert.throws(() => note('empty', { content: ' \n\t' }), /正文/);
  assert.throws(() => note('two-characters', { target: '桥梁' }), /一个/);
  assert.throws(() => note('bad-date', { updatedAt: '2020-01-01T00:00:00Z' }), /不能早于/);
});

test('bridge character notes distinguish simplified 桥 and traditional 橋 in the actual dataset', () => {
  const notes = [note('simple-bridge'), note('traditional-bridge', { target: '橋' })];
  for (const [character, expected] of [['桥', 'simple-bridge'], ['橋', 'traditional-bridge']]) {
    assert.ok(metadata[character], `${character} must have its own source record`);
    const result = matchNotes(character, analyzeCharacter(character, metadata), notes);
    assert.deepEqual(resultIds(result, 'exact'), [expected]);
    assert.deepEqual(allIds(result), [expected]);
  }
});

test('water and hand component variants are not automatically merged', () => {
  const notes = [
    note('water', { kind: 'component', target: '水' }),
    note('water-side', { kind: 'component', target: '三点水', position: 'left' }),
    note('hand', { kind: 'component', target: '手' }),
    note('hand-side', { kind: 'component', target: '提手旁', position: 'left' }),
  ];
  assert.equal(notes[1].target, '氵');
  assert.equal(notes[3].target, '扌');
  assert.deepEqual(allIds(matchNotes('河', analyzeCharacter('河', fixture), notes)), ['water-side']);
  assert.deepEqual(allIds(matchNotes('打', analyzeCharacter('打', fixture), notes)), ['hand-side']);
});

test('component position is relative to its parent and top scope excludes nested parts', () => {
  const analysis = analyzeCharacter('森', fixture);
  const result = matchNotes('森', analysis, [
    note('top-left', { kind: 'component', target: '木', position: 'left', scope: 'top' }),
    note('top-top', { kind: 'component', target: '木', position: 'top', scope: 'top' }),
    note('nested-left', { kind: 'component', target: '木', position: 'left', scope: 'any-depth' }),
    note('nested-right', { kind: 'component', target: '木', position: 'right', scope: 'any-depth' }),
  ]);
  assert.deepEqual(resultIds(result, 'applicable'), ['nested-left', 'nested-right', 'top-top']);
  assert.deepEqual(resultIds(result, 'candidates'), []);
  const nested = result.applicable.find(item => item.note.id === 'nested-left');
  assert.ok(nested.reasons.some(reason => /父部件/.test(reason)), 'Nested matches must not imply a whole-character left position');
});

test('additional conditions and uncertain analysis produce candidates rather than automatic applicability', () => {
  const conditional = note('conditional', { kind: 'component', target: '氵', position: 'left', conditions: '仅当右部较繁密时。' });
  const known = matchNotes('河', analyzeCharacter('河', fixture), [conditional]);
  assert.deepEqual(resultIds(known, 'applicable'), []);
  assert.deepEqual(resultIds(known, 'candidates'), ['conditional']);
  assert.equal(known.candidates[0].note.content, conditional.content);
  assert.ok(known.candidates[0].reasons.some(reason => reason.includes(conditional.conditions)));
  const uncertain = analyzeCharacter('泽', { 泽: { decomposition: '⿰氵？', radical: '氵' } });
  const unqualified = note('uncertain', { kind: 'component', target: '氵', position: 'left' });
  assert.deepEqual(resultIds(matchNotes('泽', uncertain, [unqualified]), 'candidates'), ['uncertain']);
});

test('structure notes use known structure while allowing general enclosing notes', () => {
  const notes = [
    note('enclosing', { kind: 'structure', target: '包围' }),
    note('full-enclosing', { kind: 'structure', target: '全包围结构' }),
    note('left-right', { kind: 'structure', target: '左右' }),
  ];
  assert.deepEqual(resultIds(matchNotes('困', analyzeCharacter('困', fixture), notes), 'applicable'), ['enclosing', 'full-enclosing']);
  const unknown = analyzeCharacter('泽', { 泽: { decomposition: '？', structure: '左右结构' } });
  assert.deepEqual(allIds(matchNotes('泽', unknown, notes)), []);
});

test('unknown and incomplete IDS stay uncertain while 永 has an explicitly attributed reference correction', () => {
  for (const decomposition of ['？', '⿰氵', 'not an IDS']) {
    const unknown = analyzeCharacter('泽', { 泽: { decomposition, structure: '左右结构', source: '开源参考' } });
    assert.equal(unknown.structure, '结构待核对');
    assert.equal(unknown.uncertain, true);
    assert.deepEqual(unknown.components, []);
  }
  const before = JSON.stringify(metadata['永']);
  const analysis = analyzeCharacter('永', metadata);
  assert.equal(analysis.structure, '独体字');
  assert.match(analysis.structureSource, /参考校正/);
  assert.equal(analysis.decomposition, metadata['永'].decomposition, 'Reference correction must not rewrite the original IDS');
  assert.equal(analysis.userEdited, false);
  assert.equal(JSON.stringify(metadata['永']), before);
});

test('an explicit empty user component list clears source-derived components', () => {
  assert.ok(analyzeCharacter('河', fixture).components.length > 0);
  const override = correction({ components: [] });
  const original = JSON.stringify(override);
  const analysis = analyzeCharacter('河', fixture, [override]);
  assert.deepEqual(analysis.components, []);
  assert.equal(analysis.userEdited, true);
  assert.match(analysis.source, /用户修订/);
  const water = note('water-side', { kind: 'component', target: '氵' });
  assert.deepEqual(allIds(matchNotes('河', analysis, [water])), []);
  assert.equal(JSON.stringify(override), original);
});

test('independent reference glyphs are not split into teaching parts, including when used as a radical', () => {
  for (const character of ['木', '永', '水', '天']) {
    const analysis = analyzeCharacter(character, metadata);
    assert.equal(analysis.structure, '独体字');
    assert.equal(analysis.decomposition, metadata[character].decomposition);
    assert.deepEqual(analysis.components, [], character);
  }
  const bridge = analyzeCharacter('桥', {
    桥: { decomposition: '⿰木乔', structure: '左右结构', radical: '木' },
    木: { decomposition: '⿻十人', structure: '独体字', radical: '木' },
  });
  assert.deepEqual(bridge.components.map(part => part.name).sort(), ['乔', '木']);
  assert.ok(bridge.components.some(part => part.name === '木' && part.position === 'left'));
  const spurious = [note('ten-inside-wood', { kind: 'component', target: '十', scope: 'any-depth' })];
  assert.deepEqual(allIds(matchNotes('桥', bridge, spurious)), []);
});

test('JSON export/import round trips preserve personal records and repeated import is idempotent', () => {
  const notes = [note('round-trip', { content: '  保留换行\n和空格。  ', examples: ['桥', '橋'] })];
  const overrides = [correction({ components: [] })];
  const aliases = [{ alias: '小水旁', target: '氵' }];
  const backup = makeBackup(notes, overrides, aliases);
  const imported = applyImport(planImport(JSON.stringify(backup), [], [], []));
  assert.deepEqual(imported, { notes, overrides, aliases });
  const reimport = planImport(JSON.stringify(makeBackup(imported.notes, imported.overrides, imported.aliases)), imported.notes, imported.overrides, imported.aliases);
  assert.equal(reimport.duplicates.length, 1);
  assert.equal(reimport.overrideDuplicates.length, 1);
  assert.equal(reimport.aliasDuplicates.length, 1);
  assert.equal(reimport.newNotes.length + reimport.conflicts.length + reimport.newOverrides.length + reimport.overrideConflicts.length, 0);
  assert.deepEqual(applyImport(reimport), imported);
  assert.equal(Object.hasOwn(backup, 'characters'), false);
  assert.equal(Object.hasOwn(backup, 'strokes'), false);
});

test('same-ID conflicts preserve local by default and allow incoming or independent copy', () => {
  const local = note('conflict', { content: '本地原文。' });
  const incoming = note('conflict', { content: '导入原文，另有观点。' });
  const current = [local];
  const original = JSON.stringify(current);
  const plan = planImport(makeBackup([incoming], []), current, []);
  assert.equal(plan.conflicts.length, 1);
  assert.equal(applyImport(plan).notes[0].content, local.content);
  assert.equal(applyImport(plan, { notes: { conflict: 'incoming' } }).notes[0].content, incoming.content);
  const copied = applyImport(plan, { notes: { conflict: 'copy' } }).notes;
  assert.equal(copied.length, 2);
  assert.equal(new Set(copied.map(row => row.id)).size, 2);
  assert.deepEqual(copied.map(row => row.content).sort(), [local.content, incoming.content].sort());
  assert.equal(JSON.stringify(current), original);
});

test('different IDs with the same note content are deduplicated without altering local text', () => {
  const local = note('existing', { examples: ['桥', '橋'] });
  const incoming = note('another-id', { examples: ['橋', '桥'] });
  const plan = planImport(makeBackup([incoming], []), [local], []);
  assert.equal(plan.duplicates.length, 1);
  assert.equal(plan.newNotes.length, 0);
  assert.equal(plan.conflicts.length, 0);
  assert.deepEqual(applyImport(plan).notes, [local]);
});

test('override conflicts need a per-character incoming choice; local clear remains the default', () => {
  const local = correction({ components: [] });
  const incoming = correction();
  const plan = planImport(makeBackup([], [incoming]), [], [local]);
  assert.equal(plan.overrideConflicts.length, 1);
  assert.deepEqual(applyImport(plan).overrides, [local]);
  assert.deepEqual(applyImport(plan, { overrides: { 河: 'incoming' } }).overrides, [incoming]);
});

test('invalid JSON, unsupported backups and malformed records leave the caller data unchanged', () => {
  const local = [note('safe-local')];
  const before = JSON.stringify(local);
  const badInputs = [
    '{not JSON', '[]', JSON.stringify({ application: 'moxi', schemaVersion: 1 }),
    JSON.stringify({ ...makeBackup([], []), schemaVersion: 99 }),
    JSON.stringify({ ...makeBackup([], []), notes: [{ id: 'incomplete' }] }),
    JSON.stringify({ ...makeBackup([], []), unexpected: true }),
  ];
  for (const input of badInputs) assert.throws(() => planImport(input, local, []));
  assert.equal(JSON.stringify(local), before);
});

test('prototype-related JSON keys are rejected at nested levels without pollution', () => {
  const local = [note('safe-local')];
  const before = JSON.stringify(local);
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const incoming = makeBackup([note('incoming')], []);
    Object.defineProperty(incoming.notes[0], key, { value: { moxiPolluted: true }, enumerable: true });
    assert.throws(() => planImport(JSON.stringify(incoming), local, []), /不允许/);
  }
  assert.equal(({}).moxiPolluted, undefined);
  assert.equal(JSON.stringify(local), before);
});

test('reserved aliases survive backups and conflicts but never change component matching', () => {
  const localAliases = [{ alias: '水', target: '氵' }];
  const plan = planImport(makeBackup([], [], localAliases), [], [], []);
  const imported = applyImport(plan);
  assert.deepEqual(imported.aliases, localAliases);
  const water = note('independent-water', { kind: 'component', target: '水' });
  assert.deepEqual(allIds(matchNotes('河', analyzeCharacter('河', fixture), [water])), []);
  assert.throws(() => note('unrecognized-alias', { kind: 'component', target: '小水旁' }), /部件/);
  const conflict = planImport(makeBackup([], [], [{ alias: '水', target: '冫' }]), [], [], localAliases);
  assert.equal(conflict.aliasConflicts.length, 1);
  assert.deepEqual(applyImport(conflict).aliases, localAliases);
  assert.deepEqual(applyImport(conflict, { aliases: { 水: 'incoming' } }).aliases, [{ alias: '水', target: '冫' }]);
});

test('legacy local notes default to unclassified and category names have a bounded length', () => {
  const oldLocal = { ...note('legacy-local') };
  delete oldLocal.category;
  assert.equal(normalizeNote(oldLocal).category, '');
  assert.equal(note('category-name', { category: '  左右结构观察  ' }).category, '左右结构观察');
  assert.equal(note('category-limit', { category: '类'.repeat(50) }).category.length, 50);
  assert.throws(() => note('category-too-long', { category: '类'.repeat(51) }), /分类/);
  assert.throws(() => note('category-not-text', { category: null }), /分类/);
});

test('v1 notebook backups migrate a missing category without changing original input or body', () => {
  const original = note('legacy-backup', { content: '  原始输入\r\n第二行\n\t  ' });
  const oldRecord = { ...original };
  delete oldRecord.category;
  const legacy = { ...makeBackup([], []), schemaVersion: 1, notes: [oldRecord] };
  const before = JSON.stringify(legacy);
  const imported = applyImport(planImport(legacy, [], []));
  assert.equal(imported.notes[0].category, '');
  assert.equal(imported.notes[0].content, original.content);
  assert.equal(JSON.stringify(legacy), before, 'Import planning must not rewrite the legacy backup');
});

test('new v2 exports and imports preserve categories and body whitespace exactly', () => {
  const categorized = note('categorized-round-trip', {
    category: '课堂笔记 / 偏旁', content: '  氵：第一行\r\n\n  第二行。\t  ',
  });
  const backup = makeBackup([categorized], []);
  assert.equal(backup.schemaVersion, 2);
  assert.equal(backup.notes[0].category, categorized.category);
  const imported = applyImport(planImport(JSON.stringify(backup), [], []));
  assert.deepEqual(imported.notes, [categorized]);
  assert.deepEqual(Buffer.from(imported.notes[0].content), Buffer.from(categorized.content));
});

test('v2 requires category while v1 migration still validates every other field', () => {
  const incomplete = { ...note('required-category') };
  delete incomplete.category;
  assert.throws(() => planImport({ ...makeBackup([], []), notes: [incomplete] }, [], []), /category/);
  delete incomplete.content;
  assert.throws(() => planImport({ ...makeBackup([], []), schemaVersion: 1, notes: [incomplete] }, [], []), /content/);
  for (const schemaVersion of [0, 3, '2']) {
    assert.throws(() => planImport({ ...makeBackup([], []), schemaVersion }, [], []), /版本/);
  }
});

test('same-ID category-only changes are conflicts, with local incoming and copy choices preserved', () => {
  const local = note('category-conflict', { category: '已复习' });
  const incoming = note('category-conflict', { category: '待复习' });
  const plan = planImport(makeBackup([incoming], []), [local], []);
  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.duplicates.length, 0);
  assert.equal(applyImport(plan).notes[0].category, '已复习');
  assert.equal(applyImport(plan, { notes: { 'category-conflict': 'incoming' } }).notes[0].category, '待复习');
  assert.deepEqual(applyImport(plan, { notes: { 'category-conflict': 'copy' } }).notes.map(row => row.category).sort(), ['已复习', '待复习'].sort());
});

test('semantic deduplication keeps otherwise identical notes in different categories', () => {
  const local = note('category-local', { category: '课堂' });
  const otherCategory = note('category-other', { category: '自学' });
  const sameCategory = note('category-same', { category: '课堂' });
  const plan = planImport(makeBackup([otherCategory, sameCategory], []), [local], []);
  assert.deepEqual(plan.newNotes.map(row => row.id), ['category-other']);
  assert.equal(plan.duplicates.length, 1);
  assert.equal(plan.duplicates[0].incoming.id, 'category-same');
  assert.deepEqual(applyImport(plan).notes.map(row => row.category).sort(), ['课堂', '自学'].sort());
});

test('category does not alter component matching, including the distinct 氵 glyph', () => {
  const original = note('categorized-water', { kind: 'component', target: '氵', position: 'left', category: '' });
  const changed = normalizeNote({ ...original, category: '偏旁练习' });
  const analysis = analyzeCharacter('河', fixture);
  const before = matchNotes('河', analysis, [original]);
  const after = matchNotes('河', analysis, [changed]);
  assert.deepEqual(resultIds(before, 'applicable'), ['categorized-water']);
  assert.deepEqual(resultIds(after, 'applicable'), resultIds(before, 'applicable'));
  assert.deepEqual(after.applicable[0].reasons, before.applicable[0].reasons);
  assert.equal(after.applicable[0].note.category, '偏旁练习');
  assert.deepEqual(allIds(matchNotes('水', analyzeCharacter('水', metadata), [changed])), []);
});
