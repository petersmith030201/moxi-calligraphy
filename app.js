const $ = (id) => document.getElementById(id);
const STORAGE_KEY = 'moxi.learning.v1';
const ENDPOINT_KEY = 'moxi.endpoint.v1';
const state = { character: '永', characters: {}, books: [], rules: [], matches: [], writer: null, strokeData: null, strokeIndex: -1, paused: false, loadingVersion: 0, knowledgeReady: false, characterReady: false, bookId: 'all', favorites: [], records: [], endpoint: '', accessCode: '', controller: null, page: 'learn' };
const drawing = { strokes: [], current: null, character: '永', photoUrl: null };
let toastTimer;

function node(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined && text !== null) el.textContent = String(text);
  return el;
}
function strings(value) { return Array.isArray(value) ? value.filter((v) => typeof v === 'string') : typeof value === 'string' && value ? [value] : []; }
function plain(value) { return Array.isArray(value) ? value.filter((v) => typeof v === 'string').join('；') : typeof value === 'string' ? value : ''; }
function validCharacter(value) { return typeof value === 'string' && Array.from(value.trim()).length === 1 && /^\p{Script=Han}$/u.test(value.trim()); }
function toast(message) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3500);
}
function status(id, message, error = false) {
  const el = $(id);
  el.textContent = message;
  el.classList.toggle('error', error);
}
function loadLocalData() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    state.favorites = Array.isArray(saved.favorites) ? [...new Set(saved.favorites.filter(validCharacter))].slice(0, 1000) : [];
    state.records = sanitizeRecords(saved.records).slice(0, 300);
    const endpoint = localStorage.getItem(ENDPOINT_KEY);
    if (endpoint) state.endpoint = validateEndpoint(endpoint);
  } catch { /* Invalid or unavailable local storage must not prevent learning. */ }
  $('api-endpoint').value = state.endpoint;
}
function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, favorites: state.favorites, records: state.records })); }
  catch { toast('浏览器存储不可用或空间不足，请导出记录备份。'); }
}
function addRecord(type, character, detail = '') {
  const latest = state.records[0];
  if (type === 'learn' && latest?.type === type && latest.character === character && Date.now() - new Date(latest.at).getTime() < 60000) return;
  state.records.unshift({ type, character, at: new Date().toISOString(), detail: detail.slice(0, 160) });
  state.records = state.records.slice(0, 300);
  persist();
  renderRecords();
}
function sanitizeRecords(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 1000).filter((r) => r && validCharacter(r.character) && ['learn', 'practice'].includes(r.type) && typeof r.at === 'string' && Number.isFinite(Date.parse(r.at))).map((r) => ({ type: r.type, character: r.character.trim(), at: new Date(r.at).toISOString(), detail: typeof r.detail === 'string' ? r.detail.slice(0, 160) : '' }));
}
function showPage(page, focusSettings = false) {
  if (!['learn', 'practice', 'mine'].includes(page)) return;
  state.page = page;
  document.querySelectorAll('.page').forEach((el) => { const active = el.id === `page-${page}`; el.hidden = !active; el.classList.toggle('active', active); });
  document.querySelectorAll('.nav-item').forEach((el) => { const active = el.dataset.page === page; el.classList.toggle('active', active); if (active) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current'); });
  if (page === 'mine') renderRecords();
  if (page === 'practice') renderDrawing();
  window.history.replaceState(null, '', `#${page}`);
  if (focusSettings) { $('ai-settings').scrollIntoView({ behavior: 'smooth', block: 'center' }); $('api-endpoint').focus({ preventScroll: true }); }
  else window.scrollTo({ top: 0, behavior: 'instant' });
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: 'no-cache', credentials: 'omit' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
async function loadKnowledge() {
  const results = await Promise.allSettled([fetchJson('./data/characters.json'), fetchJson('./data/knowledge.json')]);
  if (results[0].status === 'fulfilled' && results[0].value && typeof results[0].value === 'object') { state.characters = results[0].value; state.characterReady = true; }
  else status('search-feedback', '基础字典加载失败；仍可尝试笔顺数据。请通过本地 HTTP 服务打开网页。', true);
  if (results[1].status === 'fulfilled' && results[1].value && typeof results[1].value === 'object') {
    const knowledge = results[1].value;
    state.books = Array.isArray(knowledge.books) ? knowledge.books.filter((b) => b && typeof b.id === 'string' && typeof b.title === 'string') : [];
    const knownBooks = new Set(state.books.map((b) => b.id));
    const knownIds = new Set();
    state.rules = Array.isArray(knowledge.rules) ? knowledge.rules.filter((r) => {
      if (!r || typeof r.id !== 'string' || knownIds.has(r.id) || !knownBooks.has(r.bookId) || !Number.isInteger(r.pdfPage) || r.pdfPage < 1 || typeof r.text !== 'string') return false;
      knownIds.add(r.id); return true;
    }) : [];
    state.knowledgeReady = true;
  }
  renderBookFilter(); renderBooks(); renderCharacterFacts(); renderRules(); updateAIState();
}
function renderBookFilter() {
  $('book-filter').replaceChildren(node('option', '', '全部已整理教材'));
  $('book-filter').firstChild.value = 'all';
  state.books.forEach((book) => { const option = node('option', '', book.title); option.value = book.id; $('book-filter').append(option); });
}
function normalizeStructure(value) {
  const text = plain(value);
  if (/左中右/.test(text)) return '左中右结构';
  if (/上中下/.test(text)) return '上中下结构';
  if (/左右|⿰/.test(text)) return '左右结构';
  if (/上下|⿱/.test(text)) return '上下结构';
  if (/包围|⿴|⿵|⿶|⿷|⿸|⿹|⿺/.test(text)) return '包围结构';
  if (/独体|单体/.test(text)) return '独体字';
  return text;
}
function currentMeta() { return state.characters[state.character] || null; }
function renderCharacterFacts() {
  const meta = currentMeta();
  $('current-character').textContent = state.character;
  $('fact-count').textContent = meta?.strokesCount ?? state.strokeData?.strokes?.length ?? '未收录';
  $('fact-radical').textContent = meta?.radical || '待核实';
  $('fact-structure').textContent = normalizeStructure(meta?.structure) || '待核实';
  $('fact-decomposition').textContent = meta?.decomposition || '暂无可靠拆分数据';
  $('fact-review').textContent = meta?.reviewed ? '数据已核对' : '开源参考数据';
  const source = meta ? plain(meta.source) : '当前本地字典未收录此字；不据此判断教材是否含有此字。';
  $('fact-source').textContent = source ? `基础信息来源：${source}` : '基础信息来源：本地汉字数据集；详见项目数据来源说明。';
  $('bookmark-button').textContent = state.favorites.includes(state.character) ? '★' : '☆';
  $('bookmark-button').setAttribute('aria-pressed', String(state.favorites.includes(state.character)));
  $('bookmark-button').setAttribute('aria-label', `${state.favorites.includes(state.character) ? '取消收藏' : '收藏'}汉字${state.character}`);
}
function componentSet(meta) {
  const result = new Set();
  if (!meta) return result;
  const ignored = new Set(Array.from('⿰⿱⿲⿳⿴⿵⿶⿷⿸⿹⿺⿻？?'));
  Array.from(plain(meta.decomposition)).forEach((c) => { if (/\p{Script=Han}/u.test(c) && !ignored.has(c)) result.add(c); });
  strings(meta.components).forEach((c) => result.add(c));
  if (meta.radical) result.add(meta.radical);
  return result;
}
function matchRules() {
  const meta = currentMeta();
  const structure = normalizeStructure(meta?.structure);
  const components = componentSet(meta);
  return state.rules.filter((r) => state.bookId === 'all' || r.bookId === state.bookId).map((rule) => {
    const direct = strings(rule.characters).includes(state.character);
    const componentMatches = strings(rule.components).filter((c) => components.has(c));
    const structureMatch = !!structure && strings(rule.structures).some((s) => normalizeStructure(s) === structure);
    const score = (direct ? 100 : 0) + componentMatches.length * 15 + (structureMatch ? 5 : 0);
    return { rule, direct, componentMatches, structureMatch, score };
  }).filter((m) => m.score > 0).sort((a, b) => b.score - a.score || a.rule.pdfPage - b.rule.pdfPage).slice(0, 6);
}
function sourceButton(rule) {
  const book = state.books.find((b) => b.id === rule.bookId);
  const button = node('button', 'citation-button', `${book?.title || rule.bookId} · PDF 第 ${rule.pdfPage} 页${rule.printedPage ? ` / 书内 ${rule.printedPage} 页` : ''} ↗`);
  button.type = 'button';
  button.addEventListener('click', () => window.dispatchEvent(new CustomEvent('open-source', { detail: { bookId: rule.bookId, page: rule.pdfPage } })));
  return button;
}
function renderRules() {
  state.matches = matchRules();
  const directCount = state.matches.filter((m) => m.direct).length;
  const checkedDirectCount = state.matches.filter((m) => m.direct && m.rule.reviewed).length;
  const summary = $('evidence-summary');
  summary.className = 'evidence-summary';
  if (!state.knowledgeReady) { summary.classList.add('gap'); summary.textContent = '教材知识库尚未成功加载。当前不生成教材教学结论。'; }
  else if (!state.matches.length) { summary.classList.add('gap'); summary.textContent = `证据不足：当前已提取记录暂未匹配到“${state.character}”的例字、部件或结构规则。仍可查看可靠笔顺并练习；这不代表教材全书没有该字。`; }
  else if (directCount) summary.textContent = `${checkedDirectCount ? '已核对' : '已提取'}例字记录包含“${state.character}”。下列 ${directCount} 条直接关联记录与其他迁移候选分开标明；不代表全书覆盖已检查完毕。`;
  else { summary.classList.add('transfer'); summary.textContent = `规则迁移候选：依据“${state.character}”的部件或结构匹配到 ${state.matches.length} 条规则，适用性仍须结合本字核对。当前记录未精确匹配本字，不能据此断言教材没有该字。`; }
  $('knowledge-count').textContent = `${state.matches.length} 条候选依据`;
  $('rule-list').replaceChildren();
  state.matches.forEach((match, i) => {
    const rule = match.rule;
    const card = node('article', 'rule-card');
    const top = node('div', 'rule-topline');
    top.append(node('span', 'rule-index', String(i + 1).padStart(2, '0')));
    top.append(node('span', `badge ${match.direct ? 'direct' : 'transfer'}`, match.direct ? rule.reviewed ? '已核对例字关联' : '例字关联 · 待核对' : '部件 / 结构迁移候选'));
    top.append(node('span', `badge ${rule.kind === 'observation' ? 'observation' : 'neutral'}`, rule.kind === 'observation' ? '范字观察 · 非原文' : '教材转述 · 非逐字引用'));
    card.append(top, node('h3', '', rule.title || '教材教学记录'), node('p', 'rule-text', rule.text));
    const reasons = match.direct ? `关联例字：${state.character}` : [match.componentMatches.length ? `相同部件：${match.componentMatches.join('、')}` : '', match.structureMatch ? `相同结构：${normalizeStructure(currentMeta()?.structure)}` : ''].filter(Boolean).join(' · ');
    card.append(node('p', 'rule-condition', reasons));
    if (plain(rule.conditions)) card.append(node('p', 'rule-condition', `适用条件：${plain(rule.conditions)}`));
    if (plain(rule.practice)) { const practice = node('p', 'rule-practice'); practice.append(node('strong', '', '系统练习建议'), document.createTextNode(plain(rule.practice))); card.append(practice); }
    const citation = node('div', 'source-citation'); citation.append(sourceButton(rule), node('span', '', rule.reviewed ? '页面已核对（AI）' : '待页面核对')); card.append(citation);
    if (rule.sourceNote) card.append(node('p', 'source-note', plain(rule.sourceNote)));
    $('rule-list').append(card);
  });
  if (!state.matches.length) $('rule-list').append(node('div', 'empty-state', state.knowledgeReady ? '保留未知，也是一种严谨。可切换教材，或先从笔顺与字形观察开始。' : '请检查 data/knowledge.json 是否可通过本地 HTTP 服务访问。'));
  const firstPractice = state.matches.find((m) => plain(m.rule.practice));
  $('practice-rule-tip').replaceChildren();
  if (firstPractice) {
    const tip = $('practice-rule-tip');
    tip.append(node('strong', '', firstPractice.direct ? '例字关联 · 系统练习建议' : '候选迁移 · 请先检查适用条件'));
    tip.append(node('p', '', firstPractice.direct ? plain(firstPractice.rule.practice) : `以下来自部件或 IDS 结构相似的候选规则，须先判断是否适用于“${state.character}”：${plain(firstPractice.rule.practice)}`));
    tip.append(node('p', 'rule-condition', `适用条件：${plain(firstPractice.rule.conditions) || '来源未列明具体条件，暂不能确认可直接用于本字。'}`));
    const citation = node('div', 'source-citation'); citation.append(sourceButton(firstPractice.rule)); tip.append(citation);
  } else $('practice-rule-tip').textContent = '当前缺少与本字匹配的教材练习规则。先观察整体字形，暂不作书家风格推演。';
}
function renderBooks() {
  $('books-count').textContent = `${state.books.length} 本教材`;
  $('book-list').replaceChildren();
  state.books.forEach((book) => {
    const card = node('article', 'book-card');
    const content = node('div');
    const rules = state.rules.filter((r) => r.bookId === book.id);
    content.append(node('h3', '', book.title), node('p', '', `${book.pageCount || '未知'} 页 · 已整理 ${rules.length} 条知识记录`));
    if (book.sha256) content.append(node('p', 'book-hash', `SHA-256：${book.sha256}`));
    if (book.note || book.description) content.append(node('p', '', plain(book.note || book.description)));
    const action = node('div', 'source-citation');
    const open = node('button', 'citation-button', '本地核对教材 ↗');
    open.addEventListener('click', () => window.dispatchEvent(new CustomEvent('open-source', { detail: { bookId: book.id, page: rules[0]?.pdfPage || 1 } })));
    action.append(open); content.append(action);
    card.append(node('div', 'book-icon', '字帖'), content); $('book-list').append(card);
  });
  if (!state.books.length) $('book-list').append(node('div', 'empty-state', '暂无已整理的教材记录。请加载教材知识数据。'));
}

function setStrokeControls(enabled) {
  ['play-button', 'previous-stroke', 'next-stroke', 'animation-speed', 'show-trajectory'].forEach((id) => { $(id).disabled = !enabled; });
  $('pause-button').disabled = true;
}
async function loadStrokeData() {
  const requestVersion = ++state.loadingVersion;
  const character = state.character;
  state.writer = null; state.strokeData = null; state.strokeIndex = -1; state.paused = false;
  $('writer-target').replaceChildren(); $('trajectory-layer').replaceChildren(); $('trajectory-layer').hidden = true;
  $('glyph-fallback').textContent = character; $('glyph-fallback').hidden = false;
  $('pause-button').textContent = '暂停'; $('play-button').textContent = '播放笔顺';
  setStrokeControls(false); status('stroke-status', '正在加载可靠笔顺数据…');
  try {
    const data = await fetchJson(`./data/characters/${encodeURIComponent(character)}.json`);
    if (requestVersion !== state.loadingVersion) return;
    if (!Array.isArray(data.strokes) || !data.strokes.length || !data.strokes.every((s) => typeof s === 'string') || !Array.isArray(data.medians) || data.medians.length !== data.strokes.length) throw new Error('字形数据不完整');
    if (!window.HanziWriter?.create) throw new Error('笔顺动画组件未加载');
    state.strokeData = data;
    const size = $('character-stage').clientWidth || 315;
    state.writer = window.HanziWriter.create('writer-target', character, { width: size, height: size, padding: 22, strokeColor: '#33382e', outlineColor: '#e4e1d6', radicalColor: '#33382e', showOutline: true, showCharacter: false, strokeAnimationSpeed: Number($('animation-speed').value), delayBetweenStrokes: 380, charDataLoader: () => data });
    $('glyph-fallback').hidden = true;
    setStrokeControls(true);
    status('stroke-status', `共 ${data.strokes.length} 笔 · 点击播放或逐笔观察`);
    renderCharacterFacts();
  } catch (error) {
    if (requestVersion !== state.loadingVersion) return;
    state.strokeData = null;
    status('stroke-status', `暂无可用笔顺动画。${error.message === '笔顺动画组件未加载' ? '动画组件未加载。' : '本地数据可能未收录此字或加载失败。'}淡字仅为系统字体参考。`, true);
    renderCharacterFacts();
  }
}
function updateTrajectory() {
  const layer = $('trajectory-layer'); layer.replaceChildren();
  const median = state.strokeData?.medians?.[state.strokeIndex];
  if (!$('show-trajectory').checked || !Array.isArray(median) || median.length < 2) { layer.hidden = true; return; }
  const points = median.filter((p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])).map(([x, y]) => [x, 900 - y]);
  if (points.length < 2) { layer.hidden = true; return; }
  const svgNS = 'http://www.w3.org/2000/svg';
  const defs = document.createElementNS(svgNS, 'defs'); const marker = document.createElementNS(svgNS, 'marker');
  Object.entries({ id: 'trajectory-arrow', viewBox: '0 0 10 10', refX: '8', refY: '5', markerWidth: '5', markerHeight: '5', orient: 'auto-start-reverse' }).forEach(([key, value]) => marker.setAttribute(key, value));
  const arrow = document.createElementNS(svgNS, 'path'); arrow.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z'); arrow.setAttribute('fill', '#af4f37'); marker.append(arrow); defs.append(marker);
  const path = document.createElementNS(svgNS, 'path');
  Object.entries({ d: points.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join(' '), stroke: '#af4f37', 'stroke-width': '7', fill: 'none', 'stroke-dasharray': '11 8', 'marker-end': 'url(#trajectory-arrow)' }).forEach(([key, value]) => path.setAttribute(key, value));
  const start = document.createElementNS(svgNS, 'circle'); start.setAttribute('cx', points[0][0]); start.setAttribute('cy', points[0][1]); start.setAttribute('r', '13'); start.setAttribute('fill', '#fffaf0'); start.setAttribute('stroke', '#af4f37'); start.setAttribute('stroke-width', '6');
  const group = document.createElementNS(svgNS, 'g');
  const padding = 22 / ($('character-stage').clientWidth || 315) * 1024;
  group.setAttribute('transform', `translate(${padding},${padding}) scale(${(1024 - padding * 2) / 1024})`);
  group.append(path, start); layer.append(defs, group); layer.hidden = false;
}
function animateSingle(index) {
  if (!state.writer || !state.strokeData) return;
  state.writer.pauseAnimation();
  state.strokeIndex = Math.max(0, Math.min(state.strokeData.strokes.length - 1, index));
  state.paused = false; $('pause-button').textContent = '暂停'; $('pause-button').disabled = false;
  const names = strings(currentMeta()?.strokeNames);
  status('stroke-status', `第 ${state.strokeIndex + 1} / ${state.strokeData.strokes.length} 笔 · ${names[state.strokeIndex] || '笔画名称未审校'}`);
  state.writer.hideCharacter({ duration: 0 });
  const writer = state.writer;
  const indexAtStart = state.strokeIndex;
  state.writer.animateStroke(state.strokeIndex, { onComplete: (result) => { if (!result?.canceled && state.writer === writer && state.strokeIndex === indexAtStart) $('pause-button').disabled = true; } });
  updateTrajectory();
}
function selectCharacter(value, { record = true, navigate = false } = {}) {
  const character = value.trim();
  if (!validCharacter(character)) { status('search-feedback', '请输入一个汉字，不要同时输入词语、标点或空格。', true); toast('请输入一个汉字。'); return false; }
  cancelTeaching();
  state.character = character;
  $('character-input').value = character;
  status('search-feedback', `正在学习“${character}”。字形参考与教材证据分别展示。`);
  $('teacher-response').replaceChildren(); status('teacher-status', '');
  renderCharacterFacts(); renderRules(); loadStrokeData();
  if (record) addRecord('learn', character);
  if (!drawing.strokes.length) setPracticeCharacter(character);
  if (navigate) showPage('learn');
  return true;
}

function validateEndpoint(value) {
  const url = new URL(value.trim());
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new Error('请使用 HTTPS，或 http://localhost 本机接口。');
  if (url.username || url.password || url.search || url.hash) throw new Error('接口地址不得包含账号、密码、查询参数或片段。');
  return url.href.replace(/\/+$/, '');
}
function updateAIState() {
  $('ai-state-badge').textContent = state.endpoint ? '接口已配置 · 按需调用' : '尚未连接 AI';
  $('ai-state-badge').className = `badge ${state.endpoint ? 'direct' : 'neutral'}`;
}
function cancelTeaching() {
  if (state.controller) { state.controller.abort(); state.controller = null; }
  $('generate-teaching').disabled = false; $('generate-teaching').textContent = '生成教材教学'; $('cancel-teaching').hidden = true;
}
async function generateTeaching(event) {
  event.preventDefault();
  if (!state.endpoint) { status('teacher-status', '尚未配置教学接口。请在“我的”中填写你部署的服务地址。当前未调用 AI。', true); return; }
  const question = $('teacher-question').value.trim() || '请依据给定教材规则，说明本字可以怎样练习；区分教材依据与本字推演。';
  if (question.length > 800) { status('teacher-status', '问题请控制在 800 字符以内。', true); return; }
  if (state.controller) return;
  const controller = new AbortController(); state.controller = controller;
  const character = state.character;
  const allowed = new Map(state.matches.map((m) => [m.rule.id, m.rule]));
  $('generate-teaching').disabled = true; $('generate-teaching').textContent = '正在生成…'; $('cancel-teaching').hidden = false;
  status('teacher-status', `正在请求教学接口。本次仅发送“${character}”、问题和 ${allowed.size} 个规则 ID。`);
  $('teacher-response').replaceChildren();
  const timer = setTimeout(() => controller.abort(), 90000);
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (state.accessCode) headers.Authorization = `Bearer ${state.accessCode}`;
    const response = await fetch(`${state.endpoint}/teach`, { method: 'POST', mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', headers, body: JSON.stringify({ character, question, ruleIds: [...allowed.keys()] }), signal: controller.signal });
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? '接口拒绝访问，请检查接口访问码。' : `教学服务返回 HTTP ${response.status}。`);
    const payload = await response.json();
    if (controller.signal.aborted || state.character !== character) return;
    if (!Array.isArray(payload.blocks) || !payload.blocks.length) throw new Error('接口未返回有效的教学内容。');
    const blocks = payload.blocks.slice(0, 20).filter((b) => b && ['evidence', 'inference', 'gap'].includes(b.kind) && typeof b.text === 'string' && b.text.trim());
    if (!blocks.length) throw new Error('教学内容格式不受支持，未显示未验证结果。');
    blocks.forEach((block) => {
      const ids = [...new Set(strings(block.ruleIds))].filter((id) => allowed.has(id));
      const kind = block.kind === 'evidence' && !ids.length ? 'gap' : block.kind;
      const card = node('article', `ai-block ${kind}`);
      card.append(node('span', `badge ${kind === 'evidence' ? 'direct' : kind === 'inference' ? 'transfer' : 'neutral'}`, kind === 'evidence' ? '教材依据 · 转述或观察，请核对引用' : kind === 'inference' ? 'AI 推演 · 非教材原文' : '证据不足 / 保留未知'));
      if (block.kind === 'evidence' && !ids.length) card.append(node('p', 'source-note', '接口未提供本次允许的有效教材引用，以下内容不作为教材证据。'));
      card.append(node('p', '', block.text.slice(0, 6000)));
      if (ids.length) { const citations = node('div', 'source-citation'); ids.forEach((id) => citations.append(sourceButton(allowed.get(id)))); card.append(citations); }
      $('teacher-response').append(card);
    });
    status('teacher-status', '教学已生成。引用限制为本次检索规则；AI 推演仍需结合范字与教材核对。可修改问题继续追问。');
  } catch (error) {
    if (state.controller === controller) status('teacher-status', error.name === 'AbortError' ? '请求已取消或超时，没有生成替代结果。' : `未能生成教学：${error.message} 请检查服务地址、访问码与跨域配置。`, true);
  } finally {
    clearTimeout(timer);
    if (state.controller === controller) { state.controller = null; $('generate-teaching').disabled = false; $('generate-teaching').textContent = '生成教材教学'; $('cancel-teaching').hidden = true; }
  }
}

function renderRecords() {
  $('favorite-count').textContent = `${state.favorites.length} 字`;
  $('favorite-list').replaceChildren();
  state.favorites.forEach((character) => { const button = node('button', 'favorite-character', character); button.title = `学习“${character}”`; button.addEventListener('click', () => selectCharacter(character, { navigate: true })); $('favorite-list').append(button); });
  if (!state.favorites.length) $('favorite-list').append(node('div', 'empty-state', '在学字页点击 ☆，收下想继续练的字。'));
  $('record-total').textContent = state.records.length;
  $('record-list').replaceChildren();
  state.records.slice(0, 40).forEach((record) => {
    const row = node('div', 'record-row');
    const content = node('div', 'record-content');
    content.append(node('strong', '', record.type === 'practice' ? '保存了一次临写练习' : '学习字形与教材依据'), node('p', '', record.detail || (record.type === 'practice' ? '练习图片已导出至设备' : '每次专注一个字，慢慢积累。')));
    const date = new Date(record.at);
    const time = node('time', '', date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })); time.dateTime = record.at;
    const open = node('button', 'record-open', '重温'); open.addEventListener('click', () => selectCharacter(record.character, { navigate: true }));
    row.append(node('span', 'record-glyph', record.character), content, time, open); $('record-list').append(row);
  });
  if (!state.records.length) $('record-list').append(node('div', 'empty-state', '学字与保存练习后，会在这里留下足迹。'));
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob); const link = node('a'); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
}
function exportRecords() {
  downloadBlob(new Blob([JSON.stringify({ application: 'moxi', version: 1, exportedAt: new Date().toISOString(), favorites: state.favorites, records: state.records }, null, 2)], { type: 'application/json' }), `墨习-学习记录-${new Date().toISOString().slice(0, 10)}.json`);
  status('records-status', '记录已导出，不包含接口地址、访问码、教材文件或照片。');
}
async function importRecords(event) {
  const file = event.target.files?.[0]; if (!file) return;
  try {
    if (file.size > 1024 * 1024) throw new Error('备份文件须小于 1 MB。');
    const data = JSON.parse(await file.text());
    if (data.application !== 'moxi' || data.version !== 1 || !Array.isArray(data.records) || !Array.isArray(data.favorites)) throw new Error('请选择墨习导出的有效记录备份。');
    const imported = sanitizeRecords(data.records);
    const dedupe = new Map([...state.records, ...imported].map((r) => [`${r.character}|${r.type}|${r.at}`, r]));
    state.records = [...dedupe.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 300);
    state.favorites = [...new Set([...state.favorites, ...data.favorites.filter(validCharacter)])].slice(0, 1000);
    persist(); renderRecords(); renderCharacterFacts(); status('records-status', '备份已合并；重复记录已去重。');
  } catch (error) { status('records-status', `导入失败：${error.message}`, true); }
  event.target.value = '';
}

function setPracticeCharacter(character) {
  drawing.character = character;
  $('practice-character-input').value = character; $('practice-character-label').textContent = character;
  renderDrawing();
}
function renderDrawing() {
  const canvas = $('practice-canvas'); const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const width = canvas.width;
  ctx.clearRect(0, 0, width, width); ctx.fillStyle = '#fffdf7'; ctx.fillRect(0, 0, width, width);
  const grid = $('practice-grid').value;
  if (grid !== 'none') {
    ctx.save(); ctx.strokeStyle = '#d3b9a7'; ctx.lineWidth = 1.3; ctx.setLineDash([8, 7]); ctx.beginPath(); ctx.moveTo(width / 2, 0); ctx.lineTo(width / 2, width); ctx.moveTo(0, width / 2); ctx.lineTo(width, width / 2);
    if (grid === 'mi') { ctx.moveTo(0, 0); ctx.lineTo(width, width); ctx.moveTo(width, 0); ctx.lineTo(0, width); }
    ctx.stroke(); ctx.restore();
  }
  if ($('practice-guide').checked) {
    ctx.save(); ctx.fillStyle = '#3b423017'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '540px KaiTi, STKaiti, SimSun, serif'; ctx.fillText(drawing.character, width / 2, width / 2 + 18); ctx.restore();
  }
  const strokes = drawing.current ? [...drawing.strokes, drawing.current] : drawing.strokes;
  strokes.forEach((stroke) => {
    if (!stroke.points.length) return;
    ctx.save(); ctx.strokeStyle = '#30372d'; ctx.fillStyle = '#30372d'; ctx.lineWidth = stroke.width; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (stroke.points.length === 1) { ctx.beginPath(); ctx.arc(stroke.points[0][0], stroke.points[0][1], stroke.width / 2, 0, Math.PI * 2); ctx.fill(); }
    else { ctx.beginPath(); stroke.points.forEach(([x, y], index) => { if (!index) ctx.moveTo(x, y); else ctx.lineTo(x, y); }); ctx.stroke(); }
    ctx.restore();
  });
  $('undo-drawing').disabled = !drawing.strokes.length;
  $('clear-drawing').disabled = !drawing.strokes.length && !drawing.current;
}
function canvasPoint(event) {
  const rect = $('practice-canvas').getBoundingClientRect();
  return [Math.max(0, Math.min(720, (event.clientX - rect.left) * 720 / rect.width)), Math.max(0, Math.min(720, (event.clientY - rect.top) * 720 / rect.height))];
}
function setupCanvas() {
  const canvas = $('practice-canvas');
  canvas.addEventListener('pointerdown', (event) => {
    if (drawing.current || event.button !== 0) return;
    event.preventDefault(); canvas.setPointerCapture(event.pointerId);
    drawing.current = { pointerId: event.pointerId, points: [canvasPoint(event)], width: Number($('brush-width').value) }; renderDrawing();
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!drawing.current || drawing.current.pointerId !== event.pointerId) return;
    event.preventDefault();
    const events = event.getCoalescedEvents?.() || [event];
    (events.length ? events : [event]).forEach((e) => { if (drawing.current.points.length < 20000) drawing.current.points.push(canvasPoint(e)); }); renderDrawing();
  });
  function finish(event) {
    if (!drawing.current || drawing.current.pointerId !== event.pointerId) return;
    drawing.strokes.push(drawing.current); drawing.current = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    renderDrawing(); status('practice-status', `已写 ${drawing.strokes.length} 笔触。这里记录屏幕笔触，不自动判断实际汉字笔画。`);
  }
  canvas.addEventListener('pointerup', finish); canvas.addEventListener('pointercancel', finish); canvas.addEventListener('lostpointercapture', finish);
  ['practice-grid', 'practice-guide'].forEach((id) => $(id).addEventListener('change', renderDrawing));
  $('undo-drawing').addEventListener('click', () => { drawing.strokes.pop(); renderDrawing(); status('practice-status', '已撤销最后一笔触。'); });
  $('clear-drawing').addEventListener('click', () => { drawing.strokes = []; drawing.current = null; renderDrawing(); status('practice-status', '画板已清空。'); });
  $('save-drawing').addEventListener('click', () => {
    if (!drawing.strokes.length) { status('practice-status', '先在画板写下笔触，再保存这次练习。', true); return; }
    const image = document.createElement('canvas'); image.width = 720; image.height = 780;
    const ctx = image.getContext('2d'); ctx.fillStyle = '#fffdf7'; ctx.fillRect(0, 0, 720, 780); ctx.drawImage(canvas, 0, 0);
    ctx.fillStyle = '#72776c'; ctx.font = '15px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(`墨习 · ${drawing.character} · ${new Date().toLocaleDateString('zh-CN')}`, 18, 746); ctx.font = '12px sans-serif'; ctx.fillText('淡描为设备通用字体参考，非教材书家真迹；不含自动书法评价。', 18, 769);
    image.toBlob((blob) => { if (!blob) { status('practice-status', '图片生成失败，请重试。', true); return; } downloadBlob(blob, `墨习-${drawing.character}-${Date.now()}.png`); addRecord('practice', drawing.character, `${drawing.strokes.length} 个屏幕笔触 · PNG 练习已导出`); status('practice-status', '练习 PNG 已导出，学习记录已保存。图片不上传服务器。'); }, 'image/png');
  });
  $('practice-photo').addEventListener('change', (event) => {
    const file = event.target.files?.[0]; if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 15 * 1024 * 1024) { status('photo-status', '请选择小于 15 MB 的 PNG、JPEG 或 WebP 图片。', true); event.target.value = ''; return; }
    if (drawing.photoUrl) URL.revokeObjectURL(drawing.photoUrl);
    drawing.photoUrl = URL.createObjectURL(file); $('photo-preview').src = drawing.photoUrl; $('photo-preview').hidden = false;
    status('photo-status', '照片仅在本页预览，未上传、未评价。'); event.target.value = '';
  });
  renderDrawing();
}

document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', () => showPage(button.dataset.page)));
document.querySelector('.brand').addEventListener('click', (event) => { event.preventDefault(); showPage('learn'); });
$('search-form').addEventListener('submit', (event) => { event.preventDefault(); selectCharacter($('character-input').value); });
$('bookmark-button').addEventListener('click', () => {
  const index = state.favorites.indexOf(state.character);
  if (index < 0) state.favorites.push(state.character); else state.favorites.splice(index, 1);
  persist(); renderCharacterFacts(); renderRecords(); toast(index < 0 ? `已收藏“${state.character}”。` : `已取消收藏“${state.character}”。`);
});
$('book-filter').addEventListener('change', () => { state.bookId = $('book-filter').value; cancelTeaching(); $('teacher-response').replaceChildren(); renderRules(); });
$('play-button').addEventListener('click', () => {
  if (!state.writer) return;
  state.strokeIndex = -1; state.paused = false; $('pause-button').textContent = '暂停'; $('pause-button').disabled = false; $('play-button').textContent = '重播笔顺'; $('trajectory-layer').hidden = true;
  status('stroke-status', '依次播放笔画 · 可暂停或切换单笔观察');
  const writer = state.writer;
  state.writer.animateCharacter({ onComplete: (result) => { if (!result?.canceled && state.writer === writer && state.strokeIndex === -1) { $('pause-button').disabled = true; status('stroke-status', `播放完成 · 共 ${state.strokeData?.strokes.length || 0} 笔`); } } });
});
$('pause-button').addEventListener('click', () => { if (!state.writer) return; state.paused = !state.paused; if (state.paused) state.writer.pauseAnimation(); else state.writer.resumeAnimation(); $('pause-button').textContent = state.paused ? '继续' : '暂停'; });
$('previous-stroke').addEventListener('click', () => animateSingle(state.strokeIndex < 0 ? 0 : state.strokeIndex - 1));
$('next-stroke').addEventListener('click', () => animateSingle(state.strokeIndex + 1));
$('show-trajectory').addEventListener('change', () => { if (state.strokeIndex < 0 && $('show-trajectory').checked) animateSingle(0); else updateTrajectory(); });
$('animation-speed').addEventListener('change', () => { if (state.writer?.updateColor) loadStrokeData(); });
$('display-grid').addEventListener('change', () => { $('character-stage').className = `character-stage grid-${$('display-grid').value}`; });
document.querySelectorAll('.practice-current').forEach((button) => button.addEventListener('click', () => { if (drawing.character !== state.character && drawing.strokes.length) { toast('画板保留了上一次练习；保存或清空后，可在练习页换字。'); } else setPracticeCharacter(state.character); showPage('practice'); }));
$('practice-search-form').addEventListener('submit', (event) => { event.preventDefault(); const character = $('practice-character-input').value.trim(); if (!validCharacter(character)) { status('practice-status', '请输入一个汉字。', true); return; } if (drawing.strokes.length && drawing.character !== character) { status('practice-status', '画板中还有练习笔触，请先保存或清空，再换字。', true); $('practice-character-input').value = drawing.character; return; } setPracticeCharacter(character); selectCharacter(character); status('practice-status', `开始练习“${character}”。`); });
$('back-to-learning').addEventListener('click', () => { selectCharacter(drawing.character, { navigate: true }); });
$('teacher-form').addEventListener('submit', generateTeaching);
$('cancel-teaching').addEventListener('click', () => { cancelTeaching(); status('teacher-status', '已取消请求。'); });
$('open-ai-settings').addEventListener('click', () => showPage('mine', true));
$('settings-form').addEventListener('submit', (event) => {
  event.preventDefault();
  try {
    const endpoint = validateEndpoint($('api-endpoint').value);
    const accessCode = $('api-access-code').value.trim();
    if (accessCode.length > 2048 || /[\r\n]/.test(accessCode)) throw new Error('访问码格式无效。');
    cancelTeaching(); state.endpoint = endpoint; state.accessCode = accessCode;
    try { localStorage.setItem(ENDPOINT_KEY, endpoint); } catch { /* Endpoint can work for current session without storage. */ }
    $('api-endpoint').value = endpoint; updateAIState(); status('settings-status', '接口设置已保存，尚未发起请求。访问码仅在本页会话中保留。');
  } catch (error) { status('settings-status', error.message || '请输入有效的服务地址。', true); }
});
$('disable-ai').addEventListener('click', () => { cancelTeaching(); state.endpoint = ''; state.accessCode = ''; $('api-endpoint').value = ''; $('api-access-code').value = ''; try { localStorage.removeItem(ENDPOINT_KEY); } catch {} updateAIState(); status('settings-status', 'AI 已关闭。'); });
$('export-records').addEventListener('click', exportRecords); $('import-records').addEventListener('change', importRecords);
window.addEventListener('beforeunload', () => { state.controller?.abort(); if (drawing.photoUrl) URL.revokeObjectURL(drawing.photoUrl); });

loadLocalData(); setupCanvas(); renderRecords(); updateAIState();
selectCharacter('永', { record: false }); loadKnowledge();
const initialPage = location.hash.slice(1); if (['learn', 'practice', 'mine'].includes(initialPage)) showPage(initialPage);
