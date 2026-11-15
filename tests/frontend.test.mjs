/**
 * DOM integration tests for the real index.html + app.js, using jsdom 26.1.0.
 * This is NOT a real browser, visual layout, SVG animation, touch, or Canvas
 * rendering test. Only external boundaries (fetch / HanziWriter / Canvas /
 * downloads) are simulated. Assertions address visible UI and user actions.
 *
 * Keep test dependencies outside the production app, e.g.:
 *   npm install --prefix /path/to/test-deps --ignore-scripts jsdom@26.1.0
 *   MOXI_TEST_DEPS=/path/to/test-deps node --test tests/frontend.test.mjs
 * A normal dev-only installation of jsdom also works. No network is used by
 * these tests. Without the optional dependency this suite reports an explicit
 * skip; static and Worker tests can still run on a clean production checkout.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInContext } from 'node:vm';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const dependencyRoots = [
  process.env.MOXI_TEST_DEPS,
  fileURLToPath(new URL('../../../work/test-deps/', import.meta.url)),
  root,
].filter(Boolean);
let jsdom;
for (const directory of dependencyRoots) {
  try { jsdom = createRequire(path.join(path.resolve(directory), 'package.json'))('jsdom'); break; }
  catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
}

if (!jsdom) {
  test('frontend DOM integration (optional jsdom dependency)', { skip: 'Install jsdom@26.1.0 in a separate test directory and set MOXI_TEST_DEPS; this is not browser QA.' }, () => {});
} else {
  const { JSDOM, VirtualConsole } = jsdom;
  const html = await readFile(path.join(root, 'index.html'), 'utf8');
  const appSource = await readFile(path.join(root, 'app.js'), 'utf8');
  const actualCharacters = JSON.parse(await readFile(path.join(root, 'data/characters.json'), 'utf8'));
  const actualYong = JSON.parse(await readFile(path.join(root, 'data/characters/永.json'), 'utf8'));

  // Synthetic teaching records exercise adversarial boundaries, not copyrighted
  // textbook quotations. The separate startup test reads the shipped real data.
  const fixture = {
    characters: {
      永: actualCharacters.永,
      沐: { strokesCount: 7, radical: '氵', decomposition: '⿰氵木', structure: '左右结构', source: 'DOM 测试结构记录', reviewed: false },
    },
    knowledge: {
      books: [{ id: 'pen', title: '测试教材·笔画', pageCount: 20 }, { id: 'layout', title: '测试教材·结构', pageCount: 30 }],
      rules: [
        { id: 'pen-yong', bookId: 'pen', pdfPage: 3, printedPage: '002', title: '永字例字记录', kind: 'paraphrase', topics: [], structures: [], components: [], characters: ['永'], text: '这是用于界面行为测试的已核对例字摘要。', practice: '每次选一个可观察的问题练习。', conditions: '仅适用于已核对例字。', reviewed: true },
        { id: 'layout-yong', bookId: 'layout', pdfPage: 6, title: '另一教材例字观察', kind: 'observation', topics: [], structures: [], components: [], characters: ['永'], text: '这是用于测试来源区分的观察记录。', practice: '比较例字的留白。', conditions: '观察不等于教材原文。', reviewed: true },
        { id: 'layout-transfer', bookId: 'layout', pdfPage: 9, title: '左右关系的候选规则', kind: 'paraphrase', topics: [], structures: ['左右结构'], components: [], characters: ['林'], text: '该记录仅用来测试同结构候选的边界提示。', practice: '先比较两部分的高低关系，再决定是否采用。', conditions: '仅当两部分高低关系与例字一致时适用。', reviewed: true },
      ],
    },
  };

  async function waitFor(predicate, message = 'DOM did not reach expected state') {
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      if (predicate()) return;
      await delay(5);
    }
    assert.fail(message);
  }

  async function boot(t, options = {}) {
    const virtualConsole = new VirtualConsole();
    const errors = [];
    virtualConsole.on('jsdomError', (error) => errors.push(error));
    const dom = new JSDOM(html, { url: 'http://localhost:8788/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole });
    const { window } = dom;
    const document = window.document;
    const get = (id) => document.getElementById(id);
    const network = [];
    const writerCalls = [];
    const downloads = [];
    const localData = options.realData ? null : structuredClone(fixture);
    let aiResponder = options.aiResponder || (() => ({ blocks: [{ kind: 'gap', text: '测试接口没有进一步证据。', ruleIds: [] }] }));
    window.scrollTo = () => {};
    window.HTMLElement.prototype.scrollIntoView = () => {};
    // Canvas is intentionally a no-op boundary; this suite never asserts pixels.
    const context = new Proxy({}, { get(target, key) { return key in target ? target[key] : () => {}; }, set(target, key, value) { target[key] = value; return true; } });
    window.HTMLCanvasElement.prototype.getContext = () => context;
    window.HTMLCanvasElement.prototype.setPointerCapture = () => {};
    window.HTMLCanvasElement.prototype.hasPointerCapture = () => false;
    window.HTMLCanvasElement.prototype.releasePointerCapture = () => {};
    window.HTMLCanvasElement.prototype.toBlob = (callback) => callback(new Blob(['simulated PNG boundary'], { type: 'image/png' }));
    window.Blob = Blob;
    window.URL.createObjectURL = (blob) => { const url = `blob:test-${downloads.length}`; downloads.push({ blob, url, name: '' }); return url; };
    window.URL.revokeObjectURL = () => {};
    window.HTMLAnchorElement.prototype.click = function () { const download = downloads.find((d) => d.url === this.href); if (download) download.name = this.download; };
    for (const [key, value] of Object.entries(options.storage || {})) window.localStorage.setItem(key, value);

    window.HanziWriter = {
      create(target, character, config) {
        writerCalls.push({ character, config });
        const mark = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        mark.setAttribute('aria-label', `模拟笔顺引擎：${character}`);
        get(target).append(mark);
        return {
          animateCharacter({ onComplete } = {}) { onComplete?.({ canceled: false }); return Promise.resolve(); },
          animateStroke(index, { onComplete } = {}) { onComplete?.({ canceled: false }); return Promise.resolve(); },
          pauseAnimation() {}, resumeAnimation() {}, hideCharacter() {}, updateColor() {},
        };
      },
    };
    window.fetch = async (input, options = {}) => {
      const url = new URL(String(input), window.location.href);
      network.push({ url: url.href, options });
      if (url.pathname.endsWith('/teach')) {
        const result = await aiResponder({ url, options });
        return { ok: true, status: 200, json: async () => result };
      }
      let data;
      if (localData && url.pathname === '/data/characters.json') data = localData.characters;
      else if (localData && url.pathname === '/data/knowledge.json') data = localData.knowledge;
      else if (localData && decodeURIComponent(url.pathname) === '/data/characters/永.json') data = actualYong;
      else if (!localData) {
        const relative = decodeURIComponent(url.pathname).replace(/^\//, '');
        if (!relative.startsWith('data/')) throw new Error(`Unexpected external request: ${url}`);
        const filename = path.resolve(root, relative);
        if (!filename.startsWith(root) || !existsSync(filename)) return { ok: false, status: 404 };
        data = JSON.parse(await readFile(filename, 'utf8'));
      } else return { ok: false, status: 404 };
      return { ok: true, status: 200, json: async () => structuredClone(data) };
    };
    runInContext(appSource, dom.getInternalVMContext(), { filename: 'app.js' });
    t.after(() => { window.dispatchEvent(new window.Event('beforeunload')); window.close(); });
    await waitFor(() => get('books-count').textContent !== '0 本教材' && !get('play-button').disabled, 'initial data did not load');
    const ui = {
      window, document, get, network, writerCalls, downloads, errors,
      setAIResponder(callback) { aiResponder = callback; },
      click(id) { get(id).click(); },
      submit(id) { get(id).dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); },
      search(character) { get('character-input').value = character; this.submit('search-form'); },
      change(id, value) { get(id).value = value; get(id).dispatchEvent(new window.Event('change', { bubbles: true })); },
      configureAI(code = 'session-only-secret') { get('api-endpoint').value = 'https://teaching.example.test'; get('api-access-code').value = code; this.submit('settings-form'); },
      teachRequests() { return network.filter((r) => new URL(r.url).pathname.endsWith('/teach')); },
      localSnapshot() { return Object.fromEntries(Array.from({ length: window.localStorage.length }, (_, i) => { const key = window.localStorage.key(i); return [key, window.localStorage.getItem(key)]; })); },
    };
    return ui;
  }

  test('real shipped page boots with 永 facts and three navigable pages', async (t) => {
    const ui = await boot(t, { realData: true });
    assert.equal(ui.get('current-character').textContent, '永');
    assert.equal(ui.get('fact-count').textContent, '5');
    assert.equal(ui.get('fact-radical').textContent, '水');
    assert.match(ui.document.querySelector('.facts-grid').textContent, /IDS\s*结构参考/);
    assert.match(ui.document.querySelector('.reference-label').textContent, /非教材书家真迹/);
    assert.equal(ui.writerCalls[0].character, '永');
    assert.ok(ui.get('rule-list').children.length > 0);
    for (const page of ['practice', 'mine', 'learn']) {
      ui.document.querySelector(`[data-page="${page}"]`).click();
      assert.equal(ui.get(`page-${page}`).hidden, false);
      assert.equal(ui.document.querySelectorAll('.page:not([hidden])').length, 1);
      assert.equal(ui.document.querySelector('[aria-current="page"]').dataset.page, page);
    }
    assert.deepEqual(ui.errors, []);
  });

  test('unknown character shows absent data and never fabricates stroke animation', async (t) => {
    const ui = await boot(t);
    ui.search('龘');
    await waitFor(() => ui.get('stroke-status').textContent.includes('暂无可用笔顺动画'));
    assert.equal(ui.get('current-character').textContent, '龘');
    assert.equal(ui.get('play-button').disabled, true);
    assert.equal(ui.writerCalls.filter((r) => r.character === '龘').length, 0);
    assert.match(ui.get('fact-count').textContent, /未收录/);
    assert.match(ui.get('evidence-summary').textContent, /证据不足/);
    assert.match(ui.get('evidence-summary').textContent, /不代表教材全书没有该字/);
    assert.equal(ui.get('glyph-fallback').hidden, false);
  });

  test('multi-character input is rejected without replacing current lesson', async (t) => {
    const ui = await boot(t);
    ui.search('书法');
    assert.equal(ui.get('current-character').textContent, '永');
    assert.match(ui.get('search-feedback').textContent, /请输入一个汉字/);
    assert.equal(ui.writerCalls.length, 1);
  });

  test('textbook filter updates visible evidence and citation opens the exact book/page', async (t) => {
    const ui = await boot(t);
    assert.equal(ui.document.querySelectorAll('.rule-card').length, 2);
    ui.change('book-filter', 'pen');
    assert.equal(ui.document.querySelectorAll('.rule-card').length, 1);
    assert.match(ui.get('rule-list').textContent, /永字例字记录/);
    assert.doesNotMatch(ui.get('rule-list').textContent, /另一教材例字观察/);
    let citation;
    ui.window.addEventListener('open-source', (event) => { citation = event.detail; }, { once: true });
    ui.document.querySelector('#rule-list .citation-button').click();
    assert.equal(citation.bookId, 'pen');
    assert.equal(citation.page, 3);
  });

  test('unconfigured AI sends no request and gives an actionable setup message', async (t) => {
    const ui = await boot(t);
    ui.get('teacher-question').value = '应如何安排这个字的结构？';
    ui.submit('teacher-form');
    assert.equal(ui.teachRequests().length, 0);
    assert.match(ui.get('teacher-status').textContent, /尚未配置教学接口/);
    assert.equal(ui.get('teacher-response').children.length, 0);
    assert.equal(ui.get('teacher-question').maxLength, 800);
  });

  test('access code is sent only as a header and excluded from storage, exports and reload', async (t) => {
    const ui = await boot(t);
    const secret = 'never-persist-this-session-code';
    ui.configureAI(secret);
    assert.match(ui.get('settings-status').textContent, /尚未发起请求/);
    assert.equal(ui.teachRequests().length, 0);
    ui.click('bookmark-button');
    ui.click('export-records');
    const exported = await ui.downloads.at(-1).blob.text();
    assert.doesNotMatch(exported, /never-persist|teaching\.example/);
    const saved = ui.localSnapshot();
    assert.equal(saved['moxi.endpoint.v1'], 'https://teaching.example.test');
    assert.ok(!JSON.stringify(saved).includes(secret));
    ui.submit('teacher-form');
    await waitFor(() => ui.get('teacher-response').children.length > 0);
    assert.equal(ui.teachRequests()[0].options.headers.Authorization, `Bearer ${secret}`);
    assert.ok(!ui.teachRequests()[0].options.body.includes(secret));
    const reloaded = await boot(t, { storage: saved });
    assert.equal(reloaded.get('api-access-code').value, '');
    reloaded.submit('teacher-form');
    await waitFor(() => reloaded.get('teacher-response').children.length > 0);
    assert.equal(reloaded.teachRequests()[0].options.headers.Authorization, undefined);
  });

  test('non-local HTTP endpoint and oversized question cannot send a teaching request', async (t) => {
    const ui = await boot(t);
    ui.get('api-endpoint').value = 'http://insecure.example.test';
    ui.submit('settings-form');
    assert.match(ui.get('settings-status').textContent, /HTTPS/);
    assert.equal(ui.teachRequests().length, 0);
    ui.configureAI();
    ui.get('teacher-question').value = '字'.repeat(801);
    ui.submit('teacher-form');
    assert.match(ui.get('teacher-status').textContent, /800/);
    assert.equal(ui.teachRequests().length, 0);
  });

  test('fabricated AI citations are not linked or presented as evidence; HTML stays plain text', async (t) => {
    const attack = '<img src=x onerror="window.__xss=1">';
    const ui = await boot(t, { aiResponder: () => ({ blocks: [
      { kind: 'evidence', text: `虚构证据 ${attack}`, ruleIds: ['invented-rule'] },
      { kind: 'inference', text: '这是推演内容。', ruleIds: ['pen-yong', 'invented-rule'] },
    ] }) });
    ui.configureAI(); ui.submit('teacher-form');
    await waitFor(() => ui.get('teacher-response').children.length === 2);
    const [untrusted, inference] = ui.get('teacher-response').children;
    assert.ok(untrusted.classList.contains('gap'));
    assert.match(untrusted.textContent, /不作为教材证据/);
    assert.equal(untrusted.querySelectorAll('.citation-button').length, 0);
    assert.equal(ui.document.querySelectorAll('#teacher-response .evidence').length, 0);
    assert.equal(inference.querySelectorAll('.citation-button').length, 1);
    assert.match(inference.textContent, /AI 推演/);
    assert.match(inference.querySelector('.citation-button').textContent, /测试教材·笔画/);
    assert.ok(untrusted.textContent.includes(attack));
    assert.equal(ui.get('teacher-response').querySelectorAll('img,script').length, 0);
    assert.equal(ui.window.__xss, undefined);
    const payload = JSON.parse(ui.teachRequests()[0].options.body);
    assert.equal(payload.character, '永');
    assert.ok(!payload.ruleIds.includes('invented-rule'));
    assert.deepEqual(Object.keys(payload).sort(), ['character', 'question', 'ruleIds']);
  });

  test('canceling an AI request re-enables controls without inventing a response', async (t) => {
    const ui = await boot(t, { aiResponder: ({ options }) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => { const error = new Error('aborted'); error.name = 'AbortError'; reject(error); }, { once: true });
    }) });
    ui.configureAI(); ui.submit('teacher-form');
    assert.equal(ui.get('generate-teaching').disabled, true);
    assert.equal(ui.get('cancel-teaching').hidden, false);
    ui.click('cancel-teaching');
    await delay(5);
    assert.equal(ui.get('generate-teaching').disabled, false);
    assert.equal(ui.get('cancel-teaching').hidden, true);
    assert.match(ui.get('teacher-status').textContent, /已取消/);
    assert.equal(ui.get('teacher-response').children.length, 0);
  });

  test('practice carries transfer uncertainty, conditions and the supporting page', async (t) => {
    const ui = await boot(t);
    ui.search('沐');
    await waitFor(() => ui.get('current-character').textContent === '沐');
    ui.document.querySelector('[data-page="practice"]').click();
    assert.equal(ui.get('practice-character-label').textContent, '沐');
    assert.match(ui.get('practice-rule-tip').textContent, /候选迁移/);
    assert.match(ui.get('practice-rule-tip').textContent, /先检查适用条件/);
    assert.match(ui.get('practice-rule-tip').textContent, /仅当两部分高低关系与例字一致时适用/);
    assert.match(ui.get('practice-rule-tip').querySelector('.citation-button').textContent, /第 9 页/);
    assert.match(ui.get('evidence-summary').textContent, /不能据此断言教材没有该字/);
  });

  test('malicious imported record text cannot create HTML or executable handlers', async (t) => {
    const ui = await boot(t);
    const attack = '<img src=x onerror="window.__importXss=1"><script>window.__importXss=2</script>';
    const file = { size: 700, text: async () => JSON.stringify({ application: 'moxi', version: 1, favorites: ['永', attack], records: [
      { type: 'learn', character: '永', at: '2026-11-15T10:00:00Z', detail: attack, source: attack },
      { type: 'learn', character: attack, at: '2026-11-15T10:00:00Z', detail: '无效字符记录' },
    ] }) };
    Object.defineProperty(ui.get('import-records'), 'files', { value: [file], configurable: true });
    ui.get('import-records').dispatchEvent(new ui.window.Event('change', { bubbles: true }));
    await waitFor(() => ui.get('records-status').textContent.includes('已合并'));
    assert.equal(ui.get('record-list').querySelectorAll('.record-row').length, 1);
    assert.ok(ui.get('record-list').textContent.includes(attack));
    assert.equal(ui.get('record-list').querySelectorAll('img,script,[onerror]').length, 0);
    assert.equal(ui.get('favorite-list').querySelectorAll('button').length, 1);
    assert.equal(ui.window.__importXss, undefined);
    assert.ok(!JSON.parse(ui.window.localStorage.getItem('moxi.learning.v1')).records[0].source);
  });

  test('simulated canvas input exposes undo and PNG save actions, without claiming handwriting evaluation', async (t) => {
    const ui = await boot(t);
    ui.document.querySelector('[data-page="practice"]').click();
    const canvas = ui.get('practice-canvas');
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 720, height: 720 });
    const pointer = (type, x, y) => {
      const event = new ui.window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
      Object.defineProperty(event, 'pointerId', { value: 1 }); canvas.dispatchEvent(event);
    };
    assert.equal(ui.get('undo-drawing').disabled, true);
    pointer('pointerdown', 80, 80); pointer('pointermove', 160, 160); pointer('pointerup', 170, 170);
    assert.equal(ui.get('undo-drawing').disabled, false);
    assert.match(ui.get('practice-status').textContent, /不自动判断实际汉字笔画/);
    ui.click('save-drawing');
    assert.match(ui.downloads.at(-1).name, /^墨习-永-\d+\.png$/);
    assert.match(ui.get('practice-status').textContent, /图片不上传服务器/);
    assert.match(ui.get('record-list').textContent, /保存了一次临写练习/);
    ui.click('undo-drawing');
    assert.equal(ui.get('undo-drawing').disabled, true);
    assert.match(ui.document.querySelector('.photo-panel .boundary-note').textContent, /尚未接入照片评价/);
  });
}
