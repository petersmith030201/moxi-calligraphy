// Pure notebook logic. No DOM, storage, network, or AI rewriting.
// Reserved backup aliases are preserved but do not participate in matching.
const POSITIONS = new Set(['any', 'left', 'right', 'top', 'bottom', 'inside', 'outside', 'center', 'standalone']);
const POSITION_LABELS = {any:'不限位置',left:'左侧',right:'右侧',top:'上方',bottom:'下方',inside:'内部',outside:'外部',center:'中间',standalone:'独立成字'};
const KINDS = new Set(['character', 'component', 'structure']);
const SCOPES = new Set(['top', 'any-depth']);
const COMMON_INDEPENDENT = new Set(Array.from('永天大木水火人一二三十上下口日月田目山川中土工小'));
const UNSAFE = new Set(['__proto__', 'prototype', 'constructor']);
const NOTE_KEYS = new Set(['id', 'title', 'kind', 'target', 'position', 'scope', 'conditions', 'content', 'examples', 'source', 'createdAt', 'updatedAt']);
const OVERRIDE_KEYS = new Set(['character', 'radical', 'decomposition', 'structure', 'components', 'updatedAt']);
const STRUCTURES = new Map([
  ['左右', '左右结构'], ['左右结构', '左右结构'], ['上下', '上下结构'], ['上下结构', '上下结构'],
  ['左中右', '左中右结构'], ['左中右结构', '左中右结构'], ['上中下', '上中下结构'], ['上中下结构', '上中下结构'],
  ['包围', '包围结构'], ['包围结构', '包围结构'], ['全包围', '全包围结构'], ['全包围结构', '全包围结构'],
  ['半包围', '半包围结构'], ['半包围结构', '半包围结构'], ['交叠', '交叠结构'], ['交叠结构', '交叠结构'],
  ['独体', '独体字'], ['独体字', '独体字'], ['独体结构', '独体字'], ['单体', '独体字'],
  ['未知', '结构待核对'], ['待核对', '结构待核对'], ['结构待核对', '结构待核对'],
]);
const IDS = {
  '⿰': { structure: '左右结构', positions: ['left', 'right'] },
  '⿱': { structure: '上下结构', positions: ['top', 'bottom'] },
  '⿲': { structure: '左中右结构', positions: ['left', 'center', 'right'] },
  '⿳': { structure: '上中下结构', positions: ['top', 'center', 'bottom'] },
  '⿴': { structure: '全包围结构', positions: ['outside', 'inside'] },
  '⿵': { structure: '半包围结构', positions: ['outside', 'inside'] },
  '⿶': { structure: '半包围结构', positions: ['outside', 'inside'] },
  '⿷': { structure: '半包围结构', positions: ['outside', 'inside'] },
  '⿸': { structure: '半包围结构', positions: ['outside', 'inside'] },
  '⿹': { structure: '半包围结构', positions: ['outside', 'inside'] },
  '⿺': { structure: '半包围结构', positions: ['outside', 'inside'] },
  '⿻': { structure: '交叠结构', positions: ['center', 'center'] },
};
const COMPONENT_NAMES = new Map(Object.entries({
  三点水: '氵', 两点水: '冫', 提手旁: '扌', 木字旁: '木', 单人旁: '亻', 双人旁: '彳',
  草字头: '艹', 竹字头: '⺮', 言字旁: '讠', 绞丝旁: '纟', 口字旁: '口', 女字旁: '女',
  金字旁: '钅', 竖心旁: '忄', 心字底: '心', 走之旁: '辶', 示字旁: '礻', 衣字旁: '衤',
  宝盖头: '宀', 秃宝盖: '冖', 病字旁: '疒', 四点底: '灬', 人字头: '人', 八字头: '八',
  立刀旁: '刂', 王字旁: '王', 土字旁: '土', 日字旁: '日', 月字旁: '月', 山字旁: '山',
  火字旁: '火', 食字旁: '饣', 反犬旁: '犭', 虫字旁: '虫', 马字旁: '马', 牛字旁: '牜',
}));

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function safe(value, depth = 0, seen = new WeakSet()) {
  if (!value || typeof value !== 'object') return;
  if (depth > 24 || seen.has(value)) throw new Error('数据嵌套过深或包含循环引用。');
  if (!Array.isArray(value) && !object(value)) throw new Error('数据必须由普通JSON对象组成。');
  seen.add(value);
  for (const key of Object.keys(value)) {
    if (UNSAFE.has(key)) throw new Error(`不允许的数据字段：${key}。`);
    safe(value[key], depth + 1, seen);
  }
  seen.delete(value);
}
function onlyKeys(value, allowed, label) {
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`${label}包含未知字段：${key}。`);
}
function text(value, label, max, trim = true) {
  if (typeof value !== 'string' || value.length > max) throw new Error(`${label}须为不超过${max}个字符的文字。`);
  return trim ? value.trim() : value;
}
function glyph(value) {
  if (typeof value !== 'string' || Array.from(value).length !== 1) return false;
  const code = value.codePointAt(0);
  return /^\p{Script=Han}$/u.test(value) || (code >= 0x2e80 && code <= 0x2fdf)
    || (code >= 0x31c0 && code <= 0x31ef);
}
function character(value, label = '汉字') {
  const result = text(value, label, 4);
  if (!glyph(result)) throw new Error(`${label}请填写一个汉字或汉字部件字符。`);
  return result;
}
function component(value) {
  const result = text(value, '部件', 32);
  if (glyph(result)) return result;
  if (COMPONENT_NAMES.has(result)) return COMPONENT_NAMES.get(result);
  throw new Error('部件请填写实际部件字符，或已知名称（如三点水、木字旁、提手旁）；不自动合并水与氵。');
}
function structure(value, optional = false) {
  const result = text(value, '结构', 32);
  if (!result && optional) return '';
  if (!STRUCTURES.has(result)) throw new Error('请选择规范结构名称，如左右结构、上下结构、半包围结构或独体字。');
  return STRUCTURES.get(result);
}
function timestamp(value, fallback, label) {
  if (value === undefined && fallback) return fallback;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label}不是有效的ISO日期时间。`);
  }
  return new Date(value).toISOString();
}
function identifier(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value) || UNSAFE.has(value)) {
    throw new Error('笔记ID格式无效。');
  }
  return value;
}
function newId() {
  return globalThis.crypto?.randomUUID?.() || `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
function normalize(raw, strict = false) {
  safe(raw);
  if (!object(raw)) throw new Error('笔记必须是一个对象。');
  if (strict) {
    onlyKeys(raw, NOTE_KEYS, '笔记');
    for (const key of NOTE_KEYS) if (!Object.hasOwn(raw, key)) throw new Error(`笔记缺少字段：${key}。`);
  }
  if (!KINDS.has(raw.kind)) throw new Error('笔记类型须为汉字、部件或结构。');
  const target = raw.kind === 'character' ? character(raw.target) : raw.kind === 'component' ? component(raw.target) : structure(raw.target);
  const position = raw.position ?? 'any';
  const scope = raw.scope ?? 'top';
  if (!POSITIONS.has(position)) throw new Error('部件位置无效。');
  if (!SCOPES.has(scope)) throw new Error('匹配范围须为一级部件或任意层级。');
  const content = text(raw.content, '笔记正文', 20000, false);
  if (!content.trim()) throw new Error('请填写笔记正文。');
  const examples = raw.examples ?? [];
  if (!Array.isArray(examples) || examples.length > 100) throw new Error('例字须为最多100个汉字的数组。');
  const now = new Date().toISOString();
  const createdAt = timestamp(raw.createdAt, now, '创建时间');
  const updatedAt = timestamp(raw.updatedAt, createdAt, '更新时间');
  if (updatedAt < createdAt) throw new Error('更新时间不能早于创建时间。');
  const title = text(raw.title ?? '', '标题', 120) || `${target}写法`;
  return {
    id: identifier(raw.id ?? newId()), title, kind: raw.kind, target, position, scope,
    conditions: text(raw.conditions ?? '', '适用条件', 2000, false), content,
    examples: [...new Set(examples.map((value) => character(value, '例字')))],
    source: text(raw.source ?? '', '来源', 1000, false), createdAt, updatedAt,
  };
}
export function normalizeNote(raw) { return normalize(raw); }

function normalizeCorrection(raw, strict = false) {
  safe(raw);
  if (!object(raw)) throw new Error('字形修订必须是一个对象。');
  if (strict) {
    onlyKeys(raw, OVERRIDE_KEYS, '字形修订');
    for (const key of OVERRIDE_KEYS) if (!Object.hasOwn(raw, key)) throw new Error(`字形修订缺少字段：${key}。`);
  }
  const parts = raw.components ?? [];
  if (!Array.isArray(parts) || parts.length > 40) throw new Error('手动一级部件最多40项。');
  const components = parts.map((part) => {
    if (!object(part)) throw new Error('部件须包含name和position。');
    onlyKeys(part, new Set(['name', 'position']), '部件');
    const position = part.position ?? 'any';
    if (!POSITIONS.has(position)) throw new Error('手动部件位置无效。');
    return { name: component(part.name), position };
  });
  return {
    character: character(raw.character), radical: text(raw.radical ?? '', '部首', 32),
    decomposition: text(raw.decomposition ?? '', '拆分说明', 500, false),
    structure: structure(raw.structure ?? '', true), components,
    updatedAt: timestamp(raw.updatedAt, new Date().toISOString(), '修订时间'),
  };
}
export function normalizeOverride(raw) { return normalizeCorrection(raw); }

function entryFor(metadata, name) {
  if (!metadata || typeof metadata !== 'object') return null;
  if (Object.hasOwn(metadata, name) && object(metadata[name])) return metadata[name];
  return Object.hasOwn(metadata, 'decomposition') || Object.hasOwn(metadata, 'radical') ? metadata : null;
}
function parseIDS(value) {
  const tokens = Array.from(typeof value === 'string' ? value.replace(/\s/g, '') : '');
  let offset = 0, unknown = false, valid = tokens.length > 0 && tokens.length <= 300;
  function read(depth) {
    if (depth > 12 || offset >= tokens.length) { valid = false; unknown = true; return null; }
    const token = tokens[offset++];
    if (Object.hasOwn(IDS, token)) return { operator: token, children: IDS[token].positions.map(() => read(depth + 1)) };
    if (token === '？' || token === '?') { unknown = true; return { unknown: true }; }
    if (!glyph(token)) { valid = false; unknown = true; return null; }
    return { name: token };
  }
  const tree = valid ? read(0) : null;
  if (offset !== tokens.length) valid = false;
  return { tree, valid, unknown: unknown || !valid };
}

export function analyzeCharacter(value, metadata, overrides = {}) {
  const current = character(value);
  const base = entryFor(metadata, current) || {};
  const rawCorrection = Array.isArray(overrides) ? overrides.find((row) => row?.character === current)
    : object(overrides) && Object.hasOwn(overrides, current) ? overrides[current]
      : object(overrides) && overrides.character === current ? overrides : null;
  const correction = rawCorrection ? normalizeOverride(rawCorrection) : null;
  const active = correction || base;
  const decomposition = typeof active.decomposition === 'string' ? active.decomposition : '';
  const parsed = parseIDS(decomposition);
  const explicit = typeof active.structure === 'string' ? STRUCTURES.get(active.structure.trim()) : null;
  const uncertainTopology = parsed.unknown || parsed.tree?.operator === '⿻';
  const inferred = parsed.valid && !uncertainTopology && parsed.tree?.operator ? IDS[parsed.tree.operator].structure : null;
  const layout = correction
    ? explicit && explicit !== '结构待核对' ? explicit : inferred || '结构待核对'
    : COMMON_INDEPENDENT.has(current) ? '独体字'
      : uncertainTopology ? '结构待核对' : explicit && explicit !== '结构待核对' ? explicit : inferred || '结构待核对';
  const components = [];
  let uncertain = layout === '结构待核对' || parsed.unknown;
  let nodes = 0;
  function expand(name, depth, path, seen) {
    if (depth >= 8 || nodes >= 256) { uncertain = true; return; }
    if (COMMON_INDEPENDENT.has(name)) return;
    // When given only the current record, do not reuse it as every child's record.
    const record = metadata === base ? null : entryFor(metadata, name);
    if (!record || typeof record.decomposition !== 'string') return;
    const nested = parseIDS(record.decomposition);
    // A self leaf or unknown terminal is not evidence that it is an independent character.
    if (!nested.valid || !nested.tree?.operator) return;
    if (seen.has(name)) { uncertain = true; return; }
    const next = new Set(seen); next.add(name);
    walk(nested.tree, 'any', depth, path, next);
  }
  function walk(tree, position, depth, path, seen) {
    if (!tree || tree.unknown) { uncertain = true; return; }
    if (depth > 8 || nodes++ >= 256) { uncertain = true; return; }
    if (tree.operator) {
      tree.children.forEach((child, index) => walk(child, IDS[tree.operator].positions[index], depth + 1, path ? `${path}/${index}` : String(index), seen));
      return;
    }
    components.push({ name: tree.name, position, depth, path });
    expand(tree.name, depth, path, seen);
  }
  if (correction) {
    uncertain = layout === '结构待核对';
    correction.components.forEach((part, index) => {
      const path = String(index);
      components.push({ name: part.name, position: part.position, depth: 1, path });
      expand(part.name, 1, path, new Set([current]));
    });
  } else if (COMMON_INDEPENDENT.has(current)) {
    // The retained IDS may describe stroke-shape combinations in an independent
    // character. Do not present these as reusable teaching components.
  } else if (parsed.valid && parsed.tree?.operator) {
    walk(parsed.tree, 'standalone', 0, '', new Set([current]));
  } else if (parsed.valid && parsed.tree?.name && parsed.tree.name !== current) {
    components.push({ name: parsed.tree.name, position: 'any', depth: 1, path: '0' });
    uncertain = true;
  }
  const originalSource = typeof base.source === 'string' ? base.source : '未收录可靠基础数据';
  return {
    character: current, radical: typeof active.radical === 'string' ? active.radical : '', decomposition,
    structure: layout, components,
    source: correction ? `用户修订；原参考：${originalSource}` : originalSource,
    structureSource: correction ? '用户修订' : COMMON_INDEPENDENT.has(current)
      ? '本站整理的常见独体字参考校正（可修订）' : base.structureSource || 'IDS拓扑参考（非书法结构规范）',
    reviewNotes: correction ? '手动一级部件按用户输入保留；空数组表示清空。'
      : base.reviewNotes || '原始IDS保留；未知组合不推定为独体字，结构参考可由用户修订。',
    uncertain, userEdited: !!correction,
  };
}

export function matchNotes(value, analysis, notes) {
  const current = character(value);
  const result = { exact: [], applicable: [], candidates: [] };
  if (!Array.isArray(notes)) return result;
  for (const raw of notes) {
    let note;
    try { note = normalizeNote(raw); } catch { continue; }
    if (note.kind === 'character') {
      if (note.target === current) result.exact.push({ note, reasons: ['仅关联本字，保留原始笔记正文。'] });
      continue;
    }
    let reasons = [];
    if (note.kind === 'structure') {
      const actual = STRUCTURES.get(analysis?.structure);
      const enclosing = note.target === '包围结构' && ['全包围结构', '半包围结构'].includes(actual);
      if ((!actual || actual !== note.target) && !enclosing) continue;
      if (actual === '结构待核对') continue;
      reasons.push(`结构匹配：${actual}。`);
    } else {
      let parts = Array.isArray(analysis?.components) ? analysis.components : [];
      if (current === note.target) parts = [{ name: current, position: 'standalone', depth: 0, path: '$' }, ...parts];
      const matches = parts.filter((part) => part.name === note.target
        && (note.scope === 'any-depth' || part.depth <= 1)
        && (note.position === 'any' || part.position === note.position));
      if (!matches.length) continue;
      reasons.push(`部件字符匹配：${note.target}，未自动合并变体。`);
      reasons.push(`位置：${matches.map((part) => POSITION_LABELS[part.position] || part.position).filter((part, index, all) => all.indexOf(part) === index).join('、')}；${note.scope === 'top' ? '限一级部件' : '允许嵌套部件'}。`);
      if (matches.some((part) => part.depth > 1)) reasons.push('嵌套位置相对于其直接父部件，不代表整字中的同名位置。');
    }
    if (note.conditions.trim() || analysis?.uncertain) {
      if (note.conditions.trim()) reasons.push(`存在需人工判断的条件：${note.conditions}`);
      if (analysis?.uncertain) reasons.push('基础拆分或结构尚有不确定之处，需先人工核对。');
      result.candidates.push({ note, reasons });
    } else {
      reasons.push('目标与位置已按所选范围匹配；只展示原笔记，不自动改写。');
      result.applicable.push({ note, reasons });
    }
  }
  return result;
}

function normalizeAliases(value) {
  if (!Array.isArray(value) || value.length > 1000) throw new Error('aliases扩展字段须为最多1000项的数组。');
  const seen = new Map();
  return value.map((row) => {
    if (!object(row)) throw new Error('aliases每项须为{alias,target}对象；当前仅保存，不参与匹配。');
    onlyKeys(row, new Set(['alias', 'target']), '别称扩展');
    const alias = text(row.alias, '别称扩展名称', 32);
    if (!alias || UNSAFE.has(alias)) throw new Error('别称扩展名称无效。');
    const target = component(row.target);
    if (seen.has(alias)) throw new Error('同一备份内的别称扩展名称不能重复。');
    seen.set(alias, target);
    return { alias, target };
  });
}
function snapshot(notes, overrides, aliases = [], strict = false) {
  if (!Array.isArray(notes) || notes.length > 10000) throw new Error('笔记须为数组，最多10000条。');
  const rows = Array.isArray(overrides) ? overrides : object(overrides) ? Object.values(overrides) : null;
  if (!rows || rows.length > 20000) throw new Error('字形修订须为数组或字符映射，最多20000条。');
  const normalized = notes.map((row) => normalize(row, strict));
  const corrections = rows.map((row) => normalizeCorrection(row, strict));
  if (new Set(normalized.map((row) => row.id)).size !== normalized.length) throw new Error('同一备份内的笔记ID不能重复。');
  if (new Set(corrections.map((row) => row.character)).size !== corrections.length) throw new Error('同一备份内的汉字修订不能重复。');
  return { notes: normalized, overrides: corrections, aliases: normalizeAliases(aliases) };
}
export function makeBackup(notes, overrides, aliases = []) {
  safe({ notes, overrides, aliases });
  return { application: 'moxi-notebook', schemaVersion: 1, exportedAt: new Date().toISOString(), ...snapshot(notes, overrides, aliases) };
}
function fullNoteKey(note) {
  const { id, createdAt, updatedAt, ...content } = note;
  return JSON.stringify(content);
}
function semanticKey(note) {
  // Deterministic field equivalence, not an AI judgment about prose meaning.
  return JSON.stringify([note.kind, note.target, note.position, note.scope, note.conditions.trim(),
    note.content.trim(), [...note.examples].sort(), note.source.trim()]);
}
function correctionKey(row) {
  const { updatedAt, ...content } = row;
  return JSON.stringify(content);
}

export function planImport(backup, currentNotes, currentOverrides, aliases = []) {
  let incoming = backup;
  if (typeof incoming === 'string') {
    if (incoming.length > 10000000) throw new Error('备份文字过大，请拆分为小于10MB的文件。');
    try { incoming = JSON.parse(incoming); } catch { throw new Error('备份不是有效的JSON文件。'); }
  }
  safe(incoming);
  if (!object(incoming)) throw new Error('备份顶层须为对象。');
  if (incoming.application === 'moxi') throw new Error('这是旧版墨习v0.1学习记录备份，不是新版写法笔记备份。请保留原文件；本次不会修改现有数据。');
  if (incoming.application !== 'moxi-notebook') throw new Error('请选择墨习写法笔记备份，application应为moxi-notebook。');
  if (incoming.schemaVersion !== 1) throw new Error('此备份版本暂不支持，请保留原文件并使用兼容版本。');
  onlyKeys(incoming, new Set(['application', 'schemaVersion', 'exportedAt', 'notes', 'overrides', 'aliases']), '备份');
  timestamp(incoming.exportedAt, null, '导出时间');
  if (!Array.isArray(incoming.overrides)) throw new Error('备份的overrides须为数组。');
  const received = snapshot(incoming.notes, incoming.overrides, incoming.aliases, true);
  safe({ currentNotes, currentOverrides, aliases });
  const current = snapshot(currentNotes, currentOverrides, aliases);
  const plan = {
    current, newNotes: [], duplicates: [], conflicts: [], newOverrides: [], overrideDuplicates: [],
    overrideConflicts: [], newAliases: [], aliasDuplicates: [], aliasConflicts: [],
  };
  const byId = new Map(current.notes.map((row) => [row.id, row]));
  const bySemantic = new Map(current.notes.map((row) => [semanticKey(row), row]));
  for (const note of received.notes) {
    const local = byId.get(note.id);
    if (local) {
      if (fullNoteKey(local) === fullNoteKey(note)) plan.duplicates.push({ local, incoming: note, reason: '同ID同内容（忽略时间戳）' });
      else plan.conflicts.push({ id: note.id, local, incoming: note });
    } else if (bySemantic.has(semanticKey(note))) {
      plan.duplicates.push({ local: bySemantic.get(semanticKey(note)), incoming: note, reason: '不同ID，但规范目标、范围、条件、正文、例字与来源一致' });
    } else {
      plan.newNotes.push(note); byId.set(note.id, note); bySemantic.set(semanticKey(note), note);
    }
  }
  const corrections = new Map(current.overrides.map((row) => [row.character, row]));
  for (const row of received.overrides) {
    const local = corrections.get(row.character);
    if (!local) plan.newOverrides.push(row);
    else if (correctionKey(local) === correctionKey(row)) plan.overrideDuplicates.push({ local, incoming: row, reason: '同一汉字的修订内容一致' });
    else plan.overrideConflicts.push({ character: row.character, local, incoming: row });
  }
  const aliasMap = new Map(current.aliases.map((row) => [row.alias, row]));
  for (const row of received.aliases) {
    const local = aliasMap.get(row.alias);
    if (!local) plan.newAliases.push(row);
    else if (local.target === row.target) plan.aliasDuplicates.push({ local, incoming: row, reason: '保留扩展字段相同' });
    else plan.aliasConflicts.push({ alias: row.alias, local, incoming: row });
  }
  return plan;
}

function choice(group, key, allowed) {
  const value = object(group) && Object.hasOwn(group, key) ? group[key] : 'local';
  if (!allowed.includes(value)) throw new Error('导入冲突选项无效。');
  return value;
}
export function applyImport(plan, choices = {}) {
  safe(plan); safe(choices);
  if (!object(plan) || !object(plan.current)) throw new Error('请先检查备份并生成导入计划。');
  const current = snapshot(plan.current.notes, plan.current.overrides, plan.current.aliases);
  const notes = [...current.notes, ...plan.newNotes.map((row) => normalizeNote(row))];
  const overrides = [...current.overrides, ...plan.newOverrides.map((row) => normalizeOverride(row))];
  const aliases = [...current.aliases, ...normalizeAliases(plan.newAliases || [])];
  for (const conflict of plan.conflicts) {
    const selected = choice(choices.notes, conflict.id, ['local', 'incoming', 'copy']);
    if (selected === 'incoming') {
      const index = notes.findIndex((row) => row.id === conflict.id);
      if (index < 0) throw new Error('导入计划与当前笔记不一致。');
      notes[index] = normalizeNote(conflict.incoming);
    } else if (selected === 'copy') {
      let id = newId();
      while (notes.some((row) => row.id === id)) id = newId();
      notes.push(normalizeNote({ ...conflict.incoming, id }));
    }
  }
  for (const conflict of plan.overrideConflicts) {
    if (choice(choices.overrides, conflict.character, ['local', 'incoming']) === 'incoming') {
      const index = overrides.findIndex((row) => row.character === conflict.character);
      if (index < 0) throw new Error('导入计划与当前字形修订不一致。');
      overrides[index] = normalizeOverride(conflict.incoming);
    }
  }
  for (const conflict of plan.aliasConflicts || []) {
    if (choice(choices.aliases, conflict.alias, ['local', 'incoming']) === 'incoming') {
      aliases[aliases.findIndex((row) => row.alias === conflict.alias)] = { ...conflict.incoming };
    }
  }
  return snapshot(notes, overrides, aliases);
}
