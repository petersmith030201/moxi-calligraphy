import { analyzeCharacter, matchNotes, normalizeNote, normalizeOverride, makeBackup, planImport, applyImport } from './model.js';
import { readNotebook, saveNotebook, readPreviousNotebook } from './store.js';

const $ = (id) => document.getElementById(id);
const positions = { any: '不限位置', left: '左侧', right: '右侧', top: '上方', bottom: '下方', inside: '内部', outside: '外部', center: '中间', standalone: '独立成字' };
const kinds = { character: '整字', component: '部件', structure: '结构' };
const commonNames = { 氵: '三点水', 扌: '提手旁', 讠: '言字旁', 亻: '单人旁', 忄: '竖心旁' };
const state = { character: '永', metadata: {}, data: { notes: [], overrides: [], aliases: [] }, analysis: null, writer: null, strokeData: null, strokeIndex: -1, paused: false, loadVersion: 0, importPlan: null, confirmAction: null, unsaved: false };
let toastTimer;
function element(tag, className, text) { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = String(text); return el; }
function button(text, action, className = 'text-button') { const el = element('button', className, text); el.type = 'button'; el.addEventListener('click', action); return el; }
function text(value) { if (typeof value === 'string') return value; if (Array.isArray(value)) return value.map(text).filter(Boolean).join('；'); if (value && typeof value === 'object') return Object.entries(value).map(([k, v]) => `${k}：${text(v)}`).join('；'); return ''; }
function status(id, message, error = false) { $(id).textContent = message; $(id).classList.toggle('error', error); }
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3500); }
function validCharacter(value) { return typeof value === 'string' && Array.from(value.trim()).length === 1 && /^\p{Script=Han}$/u.test(value.trim()); }
function showPage(page) {
  if (!['lookup', 'notebook', 'data'].includes(page)) return;
  document.querySelectorAll('.page').forEach((el) => { el.hidden = el.id !== `page-${page}`; });
  document.querySelectorAll('.nav-button').forEach((el) => { const active = el.dataset.page === page; el.classList.toggle('active', active); if (active) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current'); });
  history.replaceState(null, '', `#${page}`); window.scrollTo({ top: 0, behavior: 'instant' });
}
function openDialog(id) { const el = $(id); if (!el.open) el.showModal(); }
function closeDialog(id) { $(id).close(); }
function confirmAction(title, message, action, label = '确认') { $('confirm-title').textContent = title; $('confirm-message').textContent = message; $('confirm-yes').textContent = label; state.confirmAction = action; openDialog('confirm-dialog'); }
function showStorageFailure(message) { state.unsaved = true; $('storage-warning').hidden = false; $('storage-warning-text').textContent = `${message} 当前改动保留在内存，尚未确认写入浏览器。请立即导出备份，关闭或刷新可能丢失。`; $('storage-status').textContent = '存在未保存数据'; $('storage-status').classList.add('unsaved'); }
function commit(data, message) {
  state.data = data;
  const result = saveNotebook(data);
  state.importPlan = null; $('import-preview').hidden = true;
  if (result.saved) { state.unsaved = false; $('storage-warning').hidden = true; $('storage-status').textContent = '已保存在本机'; $('storage-status').classList.remove('unsaved'); toast(message); }
  else showStorageFailure(result.error || '浏览器存储失败。');
  renderAll();
  return result.saved;
}
function overrideMap() { return Object.fromEntries(state.data.overrides.map((item) => [item.character, item])); }
function renderAnalysis() {
  state.analysis = analyzeCharacter(state.character, state.metadata, overrideMap());
  const analysis = state.analysis;
  $('current-character').textContent = state.character; $('sheet-character').textContent = state.character;
  $('fact-count').textContent = state.metadata[state.character]?.strokesCount ?? state.strokeData?.strokes?.length ?? '暂无数据';
  $('fact-radical').textContent = analysis.radical || '待核实'; $('fact-structure').textContent = analysis.structure || '待核实'; $('fact-decomposition').textContent = analysis.decomposition || '暂无可靠拆分';
  $('analysis-label').textContent = analysis.userEdited ? '用户修订 · 仅本机' : '数据库结构参考'; $('analysis-label').classList.toggle('user-edited', !!analysis.userEdited);
  $('analysis-source').textContent = `分析来源：${text(analysis.source) || (analysis.userEdited ? '用户手动修订' : '当前无可用数据')}。结构依据：${analysis.structureSource || '待核实'}。`;
  $('analysis-uncertainty').textContent = `${analysis.uncertain ? '部分拆分或结构尚待核对。\n' : ''}${analysis.reviewNotes || ''}\n数据库结构与 IDS 描述为组合参考，不等于唯一的教学拆分；不据此虚构空间比例或书法重心。部件可点击记录写法。`;
  $('component-list').replaceChildren();
  for (const part of analysis.components || []) {
    const chip = button('', () => openNote({ kind: 'component', target: part.name, position: part.position || 'any', scope: part.depth > 1 ? 'any-depth' : 'top' }), 'component-chip');
    chip.append(document.createTextNode(part.name), element('small', '', `${part.depth > 1 ? '内层·' : ''}${positions[part.position] || '位置待核实'}${commonNames[part.name] ? ` · ${commonNames[part.name]}` : ''}`)); chip.title = `记录部件“${part.name}”在${positions[part.position] || '该位置'}的写法`; $('component-list').append(chip);
  }
  if (!analysis.components?.length) $('component-list').append(element('p', 'small-note', '暂无可靠部件数据，可手动修订后再匹配笔记。'));
  $('add-character-note').textContent = `为「${state.character}」记一法 ＋`;
  $('add-structure-note').disabled = !analysis.structure || analysis.structure === '结构待核对';
}
function noteCard(note, reasons = []) {
  const card = element('article', 'note-card'); const top = element('div', 'note-topline'); const heading = element('div'); const meta = element('div', 'note-meta');
  meta.append(element('span', 'note-kind', kinds[note.kind] || note.kind), element('span', '', note.target));
  if (note.kind === 'component') meta.append(element('span', '', `${positions[note.position] || note.position} · ${note.scope === 'any-depth' ? '任意层级' : '最外层'}`));
  heading.append(meta, element('h3', '', note.title)); const controls = element('div', 'note-controls'); controls.append(button('编辑', () => openNote(note)), button('删除', () => confirmAction('删除这条笔记？', `将删除“${note.title}”。可先在数据管理中导出备份。`, () => commit({ ...state.data, notes: state.data.notes.filter((n) => n.id !== note.id) }, '笔记已删除。'), '确认删除'))); top.append(heading, controls); card.append(top);
  if (reasons.length) card.append(element('p', 'note-reasons', reasons.join('；')));
  card.append(element('p', 'note-content', note.content));
  if (note.conditions) card.append(element('p', 'note-conditions', `适用条件（需先确认）：${note.conditions}`));
  if (note.examples?.length) card.append(element('p', 'small-note', `例字：${note.examples.join('、')}`));
  card.append(element('p', 'note-source', `来源：${note.source || '未填写，请自行核对'}`));
  return card;
}
function renderMatches() {
  $('matched-notes').replaceChildren();
  const matches = matchNotes(state.character, state.analysis, state.data.notes);
  if (![...matches.exact, ...matches.applicable, ...matches.candidates].length) { const empty = element('div', 'empty-state'); empty.append(element('p', '', state.data.notes.length ? '当前没有匹配笔记。可检查拆分、修订部件，或为这个字记录第一条写法。' : '这里还没有你的笔记。先写下一条整字、部件或结构的写法，之后遇到相同对象时再翻出来。'), button('为这个字记一法 ＋', () => openNote({ kind: 'character', target: state.character }))); $('matched-notes').append(empty); return; }
  const labels = { exact: ['本字笔记', '整字精确关联'], applicable: ['可复用笔记', '符合对象、位置与层级'], candidates: ['候选参考', '先检查适用条件与差异'] };
  for (const key of ['exact', 'applicable', 'candidates']) {
    if (!matches[key].length) continue;
    const group = element('section', `match-group ${key}`); const heading = element('div', 'match-group-heading'); heading.append(element('h3', '', labels[key][0]), element('span', '', `${matches[key].length} 条 · ${labels[key][1]}`)); group.append(heading);
    matches[key].forEach(({ note, reasons }) => group.append(noteCard(note, reasons || []))); $('matched-notes').append(group);
  }
}
function renderNotebook() {
  const query = $('note-search').value.trim().toLocaleLowerCase(); const kind = $('note-kind-filter').value;
  const notes = state.data.notes.filter((n) => (kind === 'all' || n.kind === kind) && (!query || [n.title, n.target, n.content, n.conditions, n.source, ...(n.examples || [])].join('\n').toLocaleLowerCase().includes(query)));
  $('note-count').textContent = `${notes.length} / ${state.data.notes.length} 条笔记`; $('notebook-list').replaceChildren();
  notes.forEach((n) => $('notebook-list').append(noteCard(n)));
  if (!notes.length) $('notebook-list').append(element('div', 'empty-state', state.data.notes.length ? '没有符合搜索条件的笔记。试试更短的关键词或切换类型。' : '空白的一页，等你落笔。点击“新建笔记”，记录第一条自己的书写方法。'));
}
function renderData() {
  $('total-notes').textContent = state.data.notes.length; $('total-overrides').textContent = state.data.overrides.length; $('total-aliases').textContent = state.data.aliases.length;
  const checked = new Set([...$('export-note-list').querySelectorAll('input:checked')].map((input) => input.value)); $('export-note-list').replaceChildren();
  for (const note of state.data.notes) { const label = element('label'); const input = element('input'); input.type = 'checkbox'; input.value = note.id; input.checked = checked.has(note.id); label.append(input, document.createTextNode(`${note.title} · ${note.target}`)); $('export-note-list').append(label); }
  if (!state.data.notes.length) $('export-note-list').append(element('p', 'small-note', '暂无个人笔记。'));
  const previous = readPreviousNotebook(); $('restore-backup').disabled = !previous.data;
  $('restore-description').textContent = previous.data ? `上一份包含 ${previous.data.notes.length} 条笔记、${previous.data.overrides.length} 个字形修订。` : previous.error || '尚无上一份备份。保存第二次改动后会出现。';
}
function renderAll() { renderAnalysis(); renderMatches(); renderNotebook(); renderData(); }
function updateNoteFields() { const component = $('note-kind').value === 'component'; $('note-position').disabled = !component; $('note-scope').disabled = !component; }
function fillPositions(select, value = 'any') { select.replaceChildren(); Object.entries(positions).forEach(([key, label]) => { const option = element('option', '', label); option.value = key; select.append(option); }); select.value = value in positions ? value : 'any'; }
function openNote(note = {}) {
  $('note-form').reset(); $('note-id').value = note.id || ''; $('note-dialog-title').textContent = note.id ? '编辑书法笔记' : '新建书法笔记';
  for (const key of ['title', 'kind', 'target', 'conditions', 'content', 'source']) $(`note-${key}`).value = note[key] || (key === 'kind' ? 'character' : '');
  $('note-position').value = note.position || 'any'; $('note-scope').value = note.scope || 'top'; $('note-examples').value = (note.examples || []).join('、'); status('note-form-status', ''); updateNoteFields(); openDialog('note-dialog'); $('note-title').focus();
}
function saveNote(event) {
  event.preventDefault();
  try {
    const previous = state.data.notes.find((n) => n.id === $('note-id').value);
    const timestamp = new Date().toISOString();
    const raw = { ...(previous || {}), title: $('note-title').value, kind: $('note-kind').value, target: $('note-target').value, position: $('note-position').disabled ? 'any' : $('note-position').value, scope: $('note-scope').disabled ? 'top' : $('note-scope').value, conditions: $('note-conditions').value, content: $('note-content').value, examples: $('note-examples').value.split(/[\s,，、;；]+/u).filter(Boolean), source: $('note-source').value, createdAt: previous?.createdAt || timestamp, updatedAt: timestamp };
    const note = normalizeNote(raw); const notes = previous ? state.data.notes.map((n) => n.id === previous.id ? note : n) : [...state.data.notes, note];
    commit({ ...state.data, notes }, '笔记已保存到本机。'); closeDialog('note-dialog');
  } catch (error) { status('note-form-status', error.message, true); }
}
function addComponentRow(part = {}) {
  const row = element('div', 'override-component-row'); const input = element('input'); input.value = part.name || ''; input.placeholder = '部件，例如：氵'; input.setAttribute('aria-label', '手动部件名称');
  const select = element('select'); select.setAttribute('aria-label', '手动部件位置'); fillPositions(select, part.position || 'any'); row.append(input, select, button('×', () => row.remove(), 'remove-component')); row.lastChild.setAttribute('aria-label', '移除此部件'); $('override-components').append(row);
}
function openOverride() {
  const existing = state.data.overrides.find((o) => o.character === state.character); const value = existing || state.analysis;
  $('override-character').value = state.character; $('override-radical').value = value.radical || ''; $('override-structure').value = value.structure || ''; $('override-decomposition').value = value.decomposition || ''; $('override-components').replaceChildren();
  (value.components || []).filter((c) => !c.depth || c.depth === 1).forEach(addComponentRow); $('reset-override').disabled = !existing; status('override-form-status', ''); openDialog('override-dialog');
}
function saveOverride(event) {
  event.preventDefault();
  try {
    const override = normalizeOverride({ character: $('override-character').value, radical: $('override-radical').value, structure: $('override-structure').value, decomposition: $('override-decomposition').value, components: [...$('override-components').children].map((row) => ({ name: row.querySelector('input').value, position: row.querySelector('select').value })).filter((c) => c.name.trim()), updatedAt: new Date().toISOString() });
    const overrides = [...state.data.overrides.filter((o) => o.character !== override.character), override]; commit({ ...state.data, overrides }, '字形分析已保存为用户修订。'); closeDialog('override-dialog');
  } catch (error) { status('override-form-status', error.message, true); }
}
function exportData(forceAll = false) {
  try {
    const selected = !forceAll && document.querySelector('input[name="export-scope"]:checked').value === 'selected'; const ids = new Set([...$('export-note-list').querySelectorAll('input:checked')].map((input) => input.value));
    const notes = selected ? state.data.notes.filter((n) => ids.has(n.id)) : state.data.notes; const include = !selected || $('include-revisions').checked;
    if (selected && !notes.length && (!include || (!state.data.overrides.length && !state.data.aliases.length))) throw new Error('请先选择要导出的笔记或修订数据。');
    const backup = makeBackup(notes, include ? state.data.overrides : [], include ? state.data.aliases : []);
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = element('a'); link.href = url; link.download = `墨习-一字一法-${new Date().toISOString().slice(0, 10)}${selected ? '-所选' : ''}.json`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    status('export-status', `已生成包含 ${notes.length} 条笔记的备份下载。请确认设备已保存文件。`); if (forceAll) toast('内存数据备份已生成，请确认下载文件。');
  } catch (error) { status('export-status', error.message, true); toast(error.message); }
}
function conflictRow(title, local, incoming, isOverride, key) {
  const row = element('div', 'conflict-row'); row.append(element('p', '', title));
  row.append(element('p', 'conflict-diff', isOverride ? `本地：${local.structure || '未填结构'} / ${local.decomposition || '未填拆分'}\n导入：${incoming.structure || '未填结构'} / ${incoming.decomposition || '未填拆分'}` : `本地：${local.content}\n导入：${incoming.content}`));
  const label = element('label', '', '处理方式'); const select = element('select'); select.dataset.conflictKind = isOverride ? 'overrides' : 'notes'; select.dataset.conflictKey = key;
  for (const [value, name] of [['local', '保留本地'], ['incoming', '采用导入'], ...(!isOverride ? [['copy', '复制为新笔记']] : [])]) { const option = element('option', '', name); option.value = value; select.append(option); }
  label.append(select); row.append(label); return row;
}
async function previewImport(event) {
  const file = event.target.files?.[0]; if (!file) return;
  state.importPlan = null; $('import-preview').hidden = true;
  try {
    if (file.size > 10 * 1024 * 1024) throw new Error('请选择不超过 10 MB 的 JSON 备份。');
    const backup = JSON.parse(await file.text()); const plan = planImport(backup, state.data.notes, state.data.overrides, state.data.aliases); state.importPlan = plan;
    $('import-summary').textContent = `笔记：新增 ${plan.newNotes.length} 条，重复 ${plan.duplicates.length} 条，冲突 ${plan.conflicts.length} 条。\n字形修订：新增 ${plan.newOverrides.length} 个，重复 ${plan.overrideDuplicates?.length || 0} 个，冲突 ${plan.overrideConflicts.length} 个。\n尚未写入。确认合并后才会更新本机数据。`;
    $('import-conflicts').replaceChildren(); plan.conflicts.forEach((c) => $('import-conflicts').append(conflictRow(`笔记冲突：${c.local.title} ↔ ${c.incoming.title}`, c.local, c.incoming, false, c.id))); plan.overrideConflicts.forEach((c) => $('import-conflicts').append(conflictRow(`字形修订冲突：${c.character}`, c.local, c.incoming, true, c.character)));
    $('import-preview').hidden = false; status('import-status', `已读取“${file.name || '备份文件'}”，请核对预览。`);
  } catch (error) { status('import-status', `导入预览失败：${error.message} 原有数据未改动。`, true); }
  event.target.value = '';
}
function confirmImport() {
  if (!state.importPlan) return;
  try {
    const choices = { notes: Object.create(null), overrides: Object.create(null) }; document.querySelectorAll('#import-conflicts select').forEach((select) => { choices[select.dataset.conflictKind][select.dataset.conflictKey] = select.value; });
    const next = applyImport(state.importPlan, choices); const saved = commit(next, '备份已合并保存。'); status('import-status', saved ? '导入完成，已合并保存到本机。' : '已合并到当前内存，但存储失败。请立即导出备份。', !saved);
  } catch (error) { status('import-status', `合并失败：${error.message} 原有数据未改动。`, true); }
}
function setStrokeControls(enabled) { ['play-button', 'replay-button', 'previous-stroke', 'next-stroke', 'show-trajectory', 'animation-speed'].forEach((id) => { $(id).disabled = !enabled; }); $('pause-button').disabled = true; }
async function fetchJSON(url) { const response = await fetch(url, { credentials: 'omit' }); if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); }
async function loadStrokeData() {
  const version = ++state.loadVersion; const character = state.character;
  state.svgObserver?.disconnect(); state.svgObserver = null;
  state.writer?.pauseAnimation(); state.writer = null; state.strokeData = null; state.strokeIndex = -1; state.paused = false;
  $('writer-target').replaceChildren(); $('trajectory-layer').replaceChildren(); $('trajectory-layer').hidden = true; $('glyph-fallback').hidden = false; $('glyph-fallback').textContent = character; $('pause-button').textContent = '暂停'; $('stroke-position').textContent = '逐笔观察'; setStrokeControls(false); status('stroke-status', '正在加载笔顺数据…');
  try {
    const data = await fetchJSON(`./data/characters/${encodeURIComponent(character)}.json`); if (version !== state.loadVersion) return;
    if (!Array.isArray(data.strokes) || !data.strokes.length || !data.strokes.every((s) => typeof s === 'string') || !Array.isArray(data.medians) || data.medians.length !== data.strokes.length) throw new Error('数据不完整');
    if (!window.HanziWriter?.create) throw new Error('动画组件未加载');
    state.strokeData = data; const size = $('character-stage').clientWidth || 400;
    const container = $('writer-target');
    const observer = new MutationObserver(() => {
      if (version !== state.loadVersion) { observer.disconnect(); return; }
      const svg = container.querySelector('svg');
      if (svg) { svg.setAttribute('viewBox', `0 0 ${size} ${size}`); svg.setAttribute('preserveAspectRatio', 'xMidYMid meet'); observer.disconnect(); state.svgObserver = null; }
    });
    observer.observe(container, { childList: true, subtree: true }); state.svgObserver = observer;
    state.writer = window.HanziWriter.create('writer-target', character, { width: size, height: size, padding: 27, strokeColor: '#252821', outlineColor: '#ddd6c6', showCharacter: false, showOutline: true, strokeAnimationSpeed: Number($('animation-speed').value), delayBetweenStrokes: 380, charDataLoader: () => data });
    $('glyph-fallback').hidden = true; setStrokeControls(true); status('stroke-status', `共 ${data.strokes.length} 笔 · 播放或逐笔观察`); renderAnalysis();
  } catch (error) { if (version !== state.loadVersion) return; state.svgObserver?.disconnect(); state.svgObserver = null; status('stroke-status', `暂无可用轨迹：本地未收录或加载失败。淡字仅为设备字体参考，不补造笔顺。${error.message === '动画组件未加载' ? '动画组件未加载。' : ''}`, true); renderAnalysis(); }
}
function playAll() {
  if (!state.writer) return; const writer = state.writer; state.strokeIndex = -1; state.paused = false; $('pause-button').textContent = '暂停'; $('pause-button').disabled = false; $('trajectory-layer').hidden = true; $('stroke-position').textContent = '整字播放'; status('stroke-status', '按数据顺序播放，可暂停或逐笔观察。');
  writer.animateCharacter({ onComplete: (result) => { if (!result?.canceled && state.writer === writer && state.strokeIndex === -1) { $('pause-button').disabled = true; status('stroke-status', `播放完成 · 共 ${state.strokeData.strokes.length} 笔`); } } });
}
function playSingle(index) {
  if (!state.writer || !state.strokeData) return; const writer = state.writer; writer.pauseAnimation(); const current = Math.max(0, Math.min(state.strokeData.strokes.length - 1, index)); state.strokeIndex = current; state.paused = false; $('pause-button').textContent = '暂停'; $('pause-button').disabled = false; $('stroke-position').textContent = `第 ${current + 1} / ${state.strokeData.strokes.length} 笔`; status('stroke-status', `第 ${current + 1} 笔 · 笔画名称未审校`); writer.hideCharacter({ duration: 0 }); writer.animateStroke(current, { onComplete: (result) => { if (!result?.canceled && state.writer === writer && state.strokeIndex === current) $('pause-button').disabled = true; } }); updateTrajectory();
}
function updateTrajectory() {
  const layer = $('trajectory-layer'); layer.replaceChildren(); const points = state.strokeData?.medians?.[state.strokeIndex];
  if (!$('show-trajectory').checked || !Array.isArray(points) || points.length < 2) { layer.hidden = true; return; }
  const filtered = points.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])); if (filtered.length < 2) { layer.hidden = true; return; }
  const ns = 'http://www.w3.org/2000/svg'; const svg = (tag, attrs) => { const el = document.createElementNS(ns, tag); Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v)); return el; };
  const defs = svg('defs', {}); const marker = svg('marker', { id: 'stroke-arrow', viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 5, markerHeight: 5, orient: 'auto' }); marker.append(svg('path', { d: 'M0 0L10 5L0 10z', fill: '#9E3C30' })); defs.append(marker);
  const padding = 27 / ($('character-stage').clientWidth || 400) * 1024; const group = svg('g', { transform: `translate(${padding},${padding}) scale(${(1024 - 2 * padding) / 1024})` });
  group.append(svg('path', { d: filtered.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${900 - y}`).join(' '), stroke: '#9E3C30', 'stroke-width': 6, fill: 'none', 'stroke-dasharray': '10 7', 'marker-end': 'url(#stroke-arrow)' }), svg('circle', { cx: filtered[0][0], cy: 900 - filtered[0][1], r: 12, fill: '#faf7ef', stroke: '#9E3C30', 'stroke-width': 5 })); layer.append(defs, group); layer.hidden = false;
}
function lookup(value) { const character = value.trim(); if (!validCharacter(character)) { status('lookup-status', '请输入一个汉字。', true); return; } state.character = character; $('character-input').value = character; status('lookup-status', state.metadata[character] ? '字形与拆分来自数据库参考；个人笔记按原文呈现。' : '数据库暂未提供该字信息，仍可手动修订、记录笔记；不补造轨迹或拆分。'); state.strokeData = null; renderAnalysis(); renderMatches(); loadStrokeData(); }

document.querySelectorAll('.nav-button').forEach((el) => el.addEventListener('click', () => showPage(el.dataset.page)));
document.querySelector('.brand').addEventListener('click', (event) => { event.preventDefault(); showPage('lookup'); });
document.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', () => closeDialog(el.dataset.close)));
$('lookup-form').addEventListener('submit', (event) => { event.preventDefault(); lookup($('character-input').value); });
$('new-note').addEventListener('click', () => openNote()); $('add-character-note').addEventListener('click', () => openNote({ kind: 'character', target: state.character })); $('add-structure-note').addEventListener('click', () => openNote({ kind: 'structure', target: state.analysis.structure })); $('open-notebook').addEventListener('click', () => showPage('notebook'));
$('note-form').addEventListener('submit', saveNote); $('note-kind').addEventListener('change', updateNoteFields); $('note-search').addEventListener('input', renderNotebook); $('note-kind-filter').addEventListener('change', renderNotebook);
$('edit-character').addEventListener('click', openOverride); $('override-form').addEventListener('submit', saveOverride); $('add-override-component').addEventListener('click', () => addComponentRow());
$('reset-override').addEventListener('click', () => { const character = $('override-character').value; confirmAction('恢复数据库分析？', `将移除“${character}”的个人修订，笔记保留。`, () => { commit({ ...state.data, overrides: state.data.overrides.filter((o) => o.character !== character) }, '已恢复数据库分析。'); closeDialog('override-dialog'); }, '确认恢复'); });
$('confirm-no').addEventListener('click', () => { state.confirmAction = null; closeDialog('confirm-dialog'); }); $('confirm-yes').addEventListener('click', () => { const action = state.confirmAction; state.confirmAction = null; closeDialog('confirm-dialog'); action?.(); }); $('confirm-dialog').addEventListener('cancel', () => { state.confirmAction = null; });
$('export-backup').addEventListener('click', () => exportData()); $('emergency-export').addEventListener('click', () => exportData(true)); document.querySelectorAll('input[name="export-scope"]').forEach((el) => el.addEventListener('change', () => { $('export-selection').hidden = document.querySelector('input[name="export-scope"]:checked').value !== 'selected'; }));
$('import-file').addEventListener('change', previewImport); $('confirm-import').addEventListener('click', confirmImport); $('cancel-import').addEventListener('click', () => { state.importPlan = null; $('import-preview').hidden = true; status('import-status', '导入已取消，未改动数据。'); });
$('restore-backup').addEventListener('click', () => { const previous = readPreviousNotebook(); if (!previous.data) return; confirmAction('恢复上一份数据？', `将用上一份的 ${previous.data.notes.length} 条笔记和 ${previous.data.overrides.length} 个修订替换当前数据。建议先导出当前备份。`, () => { try { const data = previous.data; const validated = applyImport(planImport(makeBackup(data.notes, data.overrides, data.aliases), [], [], [])); commit(validated, '已恢复上一份数据。'); } catch (error) { toast(`恢复失败，当前数据未改动：${error.message}`); } }, '确认恢复'); });
$('play-button').addEventListener('click', playAll); $('replay-button').addEventListener('click', playAll); $('pause-button').addEventListener('click', () => { if (!state.writer) return; state.paused = !state.paused; if (state.paused) state.writer.pauseAnimation(); else state.writer.resumeAnimation(); $('pause-button').textContent = state.paused ? '继续' : '暂停'; }); $('previous-stroke').addEventListener('click', () => playSingle(state.strokeIndex < 0 ? 0 : state.strokeIndex - 1)); $('next-stroke').addEventListener('click', () => playSingle(state.strokeIndex + 1)); $('show-trajectory').addEventListener('change', () => { if ($('show-trajectory').checked && state.strokeIndex < 0) playSingle(0); else updateTrajectory(); }); $('display-grid').addEventListener('change', () => { $('character-stage').className = `character-stage grid-${$('display-grid').value}`; }); $('animation-speed').addEventListener('change', loadStrokeData);
window.addEventListener('beforeunload', (event) => { state.writer?.pauseAnimation(); if (state.unsaved) { event.preventDefault(); event.returnValue = ''; } });
fillPositions($('note-position'));
const loaded = readNotebook();
try { const backup = makeBackup(loaded.data.notes, loaded.data.overrides, loaded.data.aliases); state.data = applyImport(planImport(backup, [], [], [])); } catch (error) { showStorageFailure(`本机数据校验失败：${error.message} 原存储保留。`); }
if (loaded.error) showStorageFailure(loaded.error);
renderAll(); lookup('永');
fetchJSON('./data/characters.json').then((data) => { if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('字典格式无效'); state.metadata = data; renderAnalysis(); renderMatches(); status('lookup-status', state.metadata[state.character] ? '字形与拆分来自数据库参考；个人笔记按原文呈现。' : '数据库未收录，仍可手动修订并记录笔记。'); }).catch(() => status('lookup-status', '字典暂未加载。可手动修订和记录；请通过 HTTP 服务打开网页。', true));
const initialPage = location.hash.slice(1); if (['lookup', 'notebook', 'data'].includes(initialPage)) showPage(initialPage);
