import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  normalizeNote, normalizeOverride, analyzeCharacter, matchNotes, matchStrokeNotes,
  matchCharacterStrokeNotes, matchRadicalNotes, matchLayoutNotes, elementOptions, LAYOUT_TAGS,
  makeBackup, planImport, applyImport,
} from '../model.js';

test('layout records round trip in v4 while v1 v2 v3 records retain all legacy fields', () => {
  const record = normalizeNote({kind:'structure',target:'左窄右宽',content:'  观察原文\n第二行。  '});
  assert.equal(makeBackup([record], []).schemaVersion,4);
  assert.deepEqual(applyImport(planImport(makeBackup([record],[]),[],[])).notes,[record]);
  const legacy = normalizeNote({kind:'component',target:'三点水',position:'left',scope:'any-depth',category:'课堂',conditions:'原条件',content:'原文',title:'原标题'});
  for(const version of [1,2,3]) assert.deepEqual(applyImport(planImport({...makeBackup([legacy],[]),schemaVersion:version},[],[])).notes,[legacy]);
  assert.throws(()=>normalizeOverride({character:'河',structure:'左窄右宽',radical:'氵',decomposition:'',components:[]}));
});
test('AI layout matching uses only recognized tags and preserves saved text and identity', () => {
  const left=normalizeNote({kind:'structure',target:'左窄右宽',content:'  左窄原文  '}), other=normalizeNote({kind:'structure',target:'左宽右窄',content:'另一个标签'});
  const result=matchLayoutNotes([{name:'左窄右宽',reason:'比较两侧宽度，需核对。'},{name:'左窄右宽',reason:'重复'}],[left,left,other]);
  assert.equal(result.length,1);assert.equal(result[0].note.content,'  左窄原文  ');assert.match(result[0].reasons.join(''),/AI 匹配参考/);
  assert.deepEqual(matchLayoutNotes([], [left]),[]);assert.deepEqual(matchLayoutNotes([{name:'任意编造',reason:'未知'}],[left]),[]);
  assert.ok(elementOptions('structure').includes('左右结构'));assert.ok(elementOptions('structure').includes('左窄右宽'));assert.ok(LAYOUT_TAGS.length>0);
});

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
  assert.ok(nested.reasons.some(reason => /父偏旁/.test(reason)), 'Nested matches must not imply a whole-character left position');
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
  assert.throws(() => note('unrecognized-alias', { kind: 'component', target: '小水旁' }), /偏旁/);
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

test('new v3 exports and imports preserve categories and body whitespace exactly', () => {
  const categorized = note('categorized-round-trip', {
    category: '课堂笔记 / 偏旁', content: '  氵：第一行\r\n\n  第二行。\t  ',
  });
  const backup = makeBackup([categorized], []);
  assert.equal(backup.schemaVersion, 4);
  assert.equal(backup.notes[0].category, categorized.category);
  const imported = applyImport(planImport(JSON.stringify(backup), [], []));
  assert.deepEqual(imported.notes, [categorized]);
  assert.deepEqual(Buffer.from(imported.notes[0].content), Buffer.from(categorized.content));
});

test('v2 requires category while v1 migration still validates every other field', () => {
  const incomplete = { ...note('required-category') };
  delete incomplete.category;
  assert.throws(() => planImport({ ...makeBackup([], []), schemaVersion: 2, notes: [incomplete] }, [], []), /category/);
  delete incomplete.content;
  assert.throws(() => planImport({ ...makeBackup([], []), schemaVersion: 1, notes: [incomplete] }, [], []), /content/);
  for (const schemaVersion of [0, 5, '3']) {
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

test('stroke notes accept bounded custom Chinese names without certifying their terminology', () => {
  for (const target of ['横', '竖提', '横折钩', '卧钩', '挑', '自己命名的横画']) {
    assert.equal(note(`stroke-${target}`, { id: `stroke-${target.length}-${target.codePointAt(0)}`, kind: 'stroke', target }).target, target);
  }
  for (const target of ['', '横/竖', 'horizontal', '横'.repeat(21), null]) {
    assert.throws(() => note('invalid-stroke-name', { kind: 'stroke', target }), /笔画名称/);
  }
});

test('横 returns every literal category match across note kinds, plus exact stroke targets', () => {
  const notes = [
    note('horizontal-character', { category: '长横练习' }),
    note('horizontal-component', { kind: 'component', target: '木', category: '横折关联' }),
    note('horizontal-structure', { kind: 'structure', target: '左右结构', category: '短横对照' }),
    note('horizontal-stroke', { kind: 'stroke', target: '横', category: '' }),
    note('other-stroke-category', { kind: 'stroke', target: '竖', category: '横竖比较' }),
    note('ordinary-character-target', { target: '横', category: '' }),
    note('unrelated-category', { category: '撇的练习' }),
  ];
  const result = matchStrokeNotes('横', notes);
  assert.deepEqual(result.map(row => row.note.id), notes.slice(0, 5).map(row => row.id));
  assert.deepEqual(result[0].matchedKeywords, ['横']);
  assert.deepEqual(result[3].matchedKeywords, []);
  assert.ok(result[3].reasons.some(reason => /名称精确匹配/.test(reason)));
  assert.ok(result[1].reasons.some(reason => /分类文字匹配/.test(reason)));
  assert.ok(result.every(row => row.reasons.some(reason => /不判断实际笔画长短/.test(reason))));
});

test('compound stroke names match any contained keyword and label them as text candidates', () => {
  const notes = [
    note('category-horizontal', { category: '横' }),
    note('category-turn', { category: '折笔' }),
    note('category-hook', { category: '钩的练习' }),
    note('category-all', { category: '横折折钩钩' }),
    note('category-vertical', { category: '竖' }),
    note('body-only', { category: '', content: '横折钩只出现在正文，不应被分类检索命中。' }),
    note('title-only', { category: '', title: '横折钩' }),
  ];
  const result = matchStrokeNotes('横折钩', notes);
  assert.deepEqual(result.map(row => row.note.id), notes.slice(0, 4).map(row => row.id));
  assert.deepEqual(result[3].matchedKeywords, ['横', '折', '钩']);
  assert.ok(result.every(row => row.reasons.some(reason => /相关候选/.test(reason))));
  assert.deepEqual(matchStrokeNotes('竖提', [note('lift', { category: '提按' })])[0].matchedKeywords, ['提']);
});

test('each basic stroke retrieves every matching category without depending on the note purpose', () => {
  const cases = [
    ['横', '长横练习', '短横观察'], ['竖', '悬针竖练习', '垂露竖观察'],
    ['撇', '长撇练习', '短撇观察'], ['捺', '平捺练习', '斜捺观察'],
    ['点', '右点练习', '左点观察'], ['提', '提画练习', '提笔观察'],
    ['折', '横折练习', '竖折观察'], ['钩', '竖钩练习', '横钩观察'],
  ];
  for (const [index, [strokeName, firstCategory, secondCategory]] of cases.entries()) {
    const records = [
      note(`all-basic-first-${index}`, { kind: 'character', category: firstCategory }),
      note(`all-basic-second-${index}`, { kind: 'component', target: '氵', category: secondCategory }),
      note('all-basic-unrelated', { kind: 'structure', target: '左右结构', category: '结构练习', content: `${strokeName}只在正文中出现。` }),
    ];
    const results = matchStrokeNotes(strokeName, records);
    assert.deepEqual(results.map(row => row.note.id), records.slice(0, 2).map(row => row.id), strokeName);
    assert.ok(results.every(row => row.reasons.some(reason => /相关候选/.test(reason))), strokeName);
  }
});

test('stroke target names are exact rather than an implicit basic-versus-compound applicability rule', () => {
  const basic = note('target-horizontal', { kind: 'stroke', target: '横' });
  const compound = note('target-compound', { kind: 'stroke', target: '横折钩' });
  assert.deepEqual(matchStrokeNotes('横', [basic, compound]).map(row => row.note.id), ['target-horizontal']);
  assert.deepEqual(matchStrokeNotes('横折钩', [basic, compound]).map(row => row.note.id), ['target-compound']);
  const custom = note('custom-stroke-target', { kind: 'stroke', target: '挑' });
  assert.deepEqual(matchStrokeNotes('挑', [custom]).map(row => row.note.id), ['custom-stroke-target']);
});

test('ordinary character component and structure matching never consumes stroke notes', () => {
  const notes = [
    note('stroke-not-a-character', { kind: 'stroke', target: '横' }),
    note('stroke-not-a-structure', { kind: 'stroke', target: '左右结构' }),
  ];
  const analysis = { character: '横', structure: '左右结构', uncertain: false, components: [{ name: '横', position: 'left', depth: 1, path: '0' }] };
  assert.deepEqual(matchNotes('横', analysis, notes), { exact: [], applicable: [], candidates: [] });
});

test('stroke retrieval keeps raw text and every related category result rather than a small top list', () => {
  const body = '  用户原始横画笔记\r\n\n含首尾空白。\t  ';
  const notes = Array.from({ length: 20 }, (_, index) => note(`many-horizontal-${index}`, { category: `横画分类${index}`, content: body }));
  const original = JSON.stringify(notes);
  const result = matchStrokeNotes('横', notes);
  assert.equal(result.length, 20);
  assert.ok(result.every(row => row.note.content === body));
  assert.equal(JSON.stringify(notes), original);
});

test('empty stroke selection is safe and malformed nonempty names fail readably', () => {
  for (const value of [null, undefined, '', '  ']) assert.deepEqual(matchStrokeNotes(value, []), []);
  for (const value of ['<横>', '横'.repeat(21), 1]) assert.throws(() => matchStrokeNotes(value, []), /笔画名称/);
  assert.deepEqual(matchStrokeNotes('横', null), []);
});

test('v3 backs up stroke notes while v1 and v2 notebooks remain importable', () => {
  const strokeNote = note('stroke-backup', { kind: 'stroke', target: '横折钩', category: '横折类', content: '  仍保留原文\r\n  ' });
  const backup = makeBackup([strokeNote], []);
  assert.equal(backup.schemaVersion, 4);
  assert.deepEqual(applyImport(planImport(JSON.stringify(backup), [], [])).notes, [strokeNote]);
  const v2Note = note('v2-existing-category', { category: '旧分类' });
  const v2Backup = { ...makeBackup([v2Note], []), schemaVersion: 2 };
  assert.deepEqual(applyImport(planImport(v2Backup, [], [])).notes, [v2Note]);
  const v1Note = { ...note('v1-still-supported') };
  delete v1Note.category;
  const v1Backup = { ...makeBackup([], []), schemaVersion: 1, notes: [v1Note] };
  assert.equal(applyImport(planImport(v1Backup, [], [])).notes[0].category, '');
});

test('whole-character stroke references include long and short targets even in a generic category', () => {
  const records = [
    note('character-long-horizontal', { kind: 'stroke', target: '长横', category: '基本笔画' }),
    note('character-short-horizontal', { kind: 'stroke', target: '短横', category: '基本笔画' }),
    note('character-hook', { kind: 'stroke', target: '竖钩' }),
    note('character-category-turn', { kind: 'structure', target: '左右结构', category: '折画练习' }),
    note('character-category-dot', { kind: 'component', target: '氵', category: '点的呼应' }),
    note('character-unrelated-vertical', { kind: 'stroke', target: '悬针竖', category: '基本笔画' }),
    note('character-title-only', { title: '横折钩', category: '无关分类', content: '正文也有横折钩。' }),
    note('character-whole-target-only', { kind: 'character', target: '横', category: '' }),
  ];
  const result = matchCharacterStrokeNotes(['点', '横折钩', '撇', '横折钩'], records);
  assert.deepEqual(result.map(row => row.note.id), records.slice(0, 5).map(row => row.id));
  assert.deepEqual(result[0].matchedKeywords, ['横']);
  assert.deepEqual(result[2].matchedKeywords, ['钩']);
  assert.ok(result.every(row => row.reasons.some(reason => /不按动画轨迹推断长短/.test(reason))));
  // The older single-stroke API keeps its original exact-target semantics.
  assert.deepEqual(matchStrokeNotes('横', records.slice(0, 2)), []);
});

test('whole-character stroke categories span every note purpose and all eight basic keywords', () => {
  const records = [
    note('all-types-horizontal', { kind: 'character', category: '横画练习' }),
    note('all-types-vertical', { kind: 'component', target: '木', category: '竖画练习' }),
    note('all-types-left', { kind: 'structure', target: '左右结构', category: '撇画练习' }),
    note('all-types-right', { kind: 'stroke', target: '捺', category: '捺画练习' }),
    note('all-types-dot', { category: '点画练习' }),
    note('all-types-lift', { category: '提画练习' }),
    note('all-types-turn', { category: '折画练习' }),
    note('all-types-hook', { category: '钩画练习' }),
  ];
  const result = matchCharacterStrokeNotes(['横折钩', '竖提', '撇', '捺', '点'], records);
  assert.deepEqual(result.map(row => row.note.id), records.map(row => row.id));
  assert.ok(result.every(row => row.reasons.some(reason => /相关候选/.test(reason))));
});

test('whole-character stroke retrieval deduplicates identity without truncating or rewriting notes', () => {
  const content = '  长横和短横的原始观察\r\n\n请保留空白。\t  ';
  const records = Array.from({ length: 40 }, (_, index) => note(`all-strokes-many-${index}`, { kind: 'stroke', target: '长横', category: '横竖对照', content }));
  const before = JSON.stringify(records);
  const result = matchCharacterStrokeNotes(['横', '横折', '竖'], [...records, records[0], records[0]]);
  assert.equal(result.length, 40);
  assert.ok(result.every(row => row.note.content === content));
  assert.deepEqual(result[0].matchedKeywords, ['横', '竖']);
  assert.equal(JSON.stringify(records), before);
});

test('missing stroke inventories do not guess types while explicit custom names retain exact matching', () => {
  const record = note('inventory-custom', { kind: 'stroke', target: '挑', category: '自定义笔画' });
  for (const types of [[], null, undefined]) assert.deepEqual(matchCharacterStrokeNotes(types, [record]), []);
  assert.deepEqual(matchCharacterStrokeNotes(['挑'], [record]).map(row => row.note.id), ['inventory-custom']);
  assert.deepEqual(matchCharacterStrokeNotes(['挑'], [note('lift-not-inferred', { kind: 'stroke', target: '提' })]), []);
  for (const types of ['横', ['横|横钩'], ['点2'], Array(101).fill('横')]) assert.throws(() => matchCharacterStrokeNotes(types, []), /笔画/);
});

test('radical references include every known location and depth while keeping original restrictions visible', () => {
  const analysis = {
    radical: '木', uncertain: true,
    components: [{ name: '氵', position: 'right', depth: 3 }, { name: '氵', position: 'left', depth: 1 }],
  };
  const records = [
    note('radical-anywhere', { kind: 'component', target: '三点水', position: 'outside', scope: 'top', conditions: '仅在包围位置时使用。' }),
    note('radical-dictionary', { kind: 'component', target: '木', position: 'bottom', scope: 'top' }),
  ];
  const result = matchRadicalNotes(analysis, records);
  assert.deepEqual(result.map(row => row.note.id), records.map(row => row.id));
  assert.ok(result[0].reasons.some(reason => /未按位置或层级筛除/.test(reason)));
  assert.ok(result[0].reasons.some(reason => /外部/.test(reason)));
  assert.ok(result[0].reasons.some(reason => /内层偏旁/.test(reason)));
  assert.ok(result[1].reasons.some(reason => /字典部首/.test(reason)));
  assert.ok(result.every(row => row.reasons.some(reason => /不确定/.test(reason))));
  assert.equal(result[0].note.conditions, records[0].conditions);
});

test('radical categories match actual glyphs and fixed names across note purposes without merging variants', () => {
  const analysis = { radical: '氵', components: [{ name: '扌', position: 'left', depth: 1 }] };
  const records = [
    note('radical-category-glyph', { kind: 'character', category: '氵的练习' }),
    note('radical-category-name', { kind: 'structure', target: '左右结构', category: '三点水观察' }),
    note('radical-category-hand', { kind: 'stroke', target: '横', category: '提手旁观察' }),
    note('radical-target-water-side', { kind: 'component', target: '氵' }),
    note('radical-target-hand-side', { kind: 'component', target: '扌' }),
    note('radical-water-not-inferred', { kind: 'component', target: '水' }),
    note('radical-hand-not-inferred', { kind: 'component', target: '手' }),
    note('radical-water-category-not-inferred', { category: '水的练习' }),
    note('radical-body-only', { category: '基础练习', content: '三点水和提手旁只在正文。' }),
  ];
  const result = matchRadicalNotes(analysis, records);
  assert.deepEqual(result.map(row => row.note.id), records.slice(0, 5).map(row => row.id));
  assert.deepEqual(result[1].matchedKeywords, ['三点水']);
  assert.ok(result.every(row => row.reasons.some(reason => /相关候选/.test(reason))));
});

test('radical retrieval ignores unknown descriptions and deduplicates known references without truncation', () => {
  const content = '  三点水偏旁笔记\r\n保持原样。\t  ';
  const records = Array.from({ length: 35 }, (_, index) => note(`radical-many-${index}`, { kind: 'component', target: '氵', category: '三点水·氵', content }));
  for (const analysis of [null, {}, { radical: '？', decomposition: '⿰氵可', components: [] }]) assert.deepEqual(matchRadicalNotes(analysis, records), []);
  const analysis = { radical: '三点水', components: [{ name: '氵', depth: 1 }, { name: '氵', depth: 4 }, { name: '？' }] };
  const before = JSON.stringify({ analysis, records });
  const result = matchRadicalNotes(analysis, [...records, records[0]]);
  assert.equal(result.length, 35);
  assert.ok(result.every(row => row.note.content === content));
  assert.deepEqual(result[0].matchedKeywords, ['氵', '三点水']);
  assert.equal(JSON.stringify({ analysis, records }), before);
});

test('fixed radical names do not leak their internal characters into a different glyph match', () => {
  for (const [independent, variant, alias] of [['水', '氵', '三点水'], ['手', '扌', '提手旁'], ['人', '亻', '单人旁']]) {
    const categoryOnly = note('radical-alias-with-internal-glyph', { category: `${alias}练习` });
    const variantTarget = note('radical-variant-only', { kind: 'component', target: variant });
    assert.deepEqual(matchRadicalNotes({ radical: independent }, [categoryOnly, variantTarget]), []);
    assert.deepEqual(matchRadicalNotes({ radical: variant }, [categoryOnly, variantTarget]).map(row => row.note.id), [categoryOnly.id, variantTarget.id]);
    const comparison = note('radical-explicit-comparison', { category: `${independent}与${alias}比较` });
    assert.deepEqual(matchRadicalNotes({ radical: independent }, [comparison])[0].matchedKeywords, [independent]);
  }
});

test('user-facing validation names components as 偏旁 without changing backup component keys', () => {
  for (const invalid of [
    () => note('bad-radical-target', { kind: 'component', target: '未知偏旁名' }),
    () => note('bad-radical-position', { position: 'unknown' }),
    () => normalizeOverride({ character: '河', components: [null] }),
  ]) assert.throws(invalid, (error) => /偏旁/.test(error.message) && !/部件|构件/.test(error.message));
  const original = note('old-component-keys', { kind: 'component', target: '氵', content: '原始部件笔记：不要改字。' });
  const backup = makeBackup([original], [correction()]);
  const restored = applyImport(planImport(backup, [], []));
  assert.equal(restored.notes[0].kind, 'component');
  assert.equal(restored.notes[0].content, original.content);
  assert.ok(Array.isArray(restored.overrides[0].components));
});
