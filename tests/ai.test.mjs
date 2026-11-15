import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createStructureAnalyzer } from '../ai.js';
import { normalizeOverride } from '../model.js';

const config = { endpoint: 'https://api.example.test/v1/chat/completions', model: 'user-selected-model', apiKey: 'test-key-only-in-memory' };
const reference = { radical: '氵', decomposition: '⿰氵可', structure: '左右结构' };
const analysis = (character = '河', changes = {}) => ({ character, structure: '左右结构', analysis: '先观察左右偏旁的组合与高低关系。', suggestions: ['对照所选范字观察两偏旁间的距离。'], uncertainty: '这是AI推演，请结合实际范字人工核对。', ...changes });
function response(value = analysis(), { fenced = false, status = 200, finishReason = 'stop' } = {}) {
  const content = JSON.stringify(value);
  return { ok: status >= 200 && status < 300, status, json: async () => ({ choices: [{ message: { content: fenced ? '```json\n' + content + '\n```' : content }, finish_reason: finishReason }] }) };
}
function makeMock() {
  const calls = [];
  const fetchImpl = (url, options) => new Promise((resolve, reject) => { calls.push({ url, options, resolve, reject }); });
  return { calls, fetchImpl };
}

test('no API is selected or called until a complete user configuration is provided', async () => {
  let calls = 0;
  const api = createStructureAnalyzer({ fetchImpl: async () => { calls++; return response(); } });
  await assert.rejects(api.analyze('河', reference), { code: 'NOT_CONFIGURED' });
  assert.equal(calls, 0);
  for (const endpoint of ['http://api.example.test/chat/completions', '/v1/chat/completions', 'https://user:password@api.example.test/path', 'https://api.example.test/path#fragment', 'javascript:alert(1)']) {
    assert.throws(() => api.configure({ ...config, endpoint }), { code: 'INVALID_CONFIG' });
  }
  for (const value of [{}, { ...config, model: '' }, { ...config, apiKey: '' }, { ...config, apiKey: 'abc\u0000def' }, { ...config, model: 'model\ninvalid' }]) assert.throws(() => api.configure(value), { code: 'INVALID_CONFIG' });
  assert.equal(calls, 0);
});

test('complete HTTPS proxy URLs are accepted without prescribing a provider or path', async () => {
  const calls = [];
  const api = createStructureAnalyzer({ fetchImpl: async (url, options) => { calls.push({ url, options }); return response(); } });
  const clean = api.configure({ ...config, endpoint: ' https://proxy.example.test/custom-route?api-version=2026-01-01 ', model: ' custom-model ' });
  assert.equal(clean.endpoint, 'https://proxy.example.test/custom-route?api-version=2026-01-01');
  assert.equal(clean.model, 'custom-model');
  clean.model = 'mutated-return-value';
  const result = await api.analyze('河', reference);
  assert.equal(result.model, 'custom-model');
  assert.equal(calls[0].url, 'https://proxy.example.test/custom-route?api-version=2026-01-01');
  assert.equal(JSON.parse(calls[0].options.body).model, 'custom-model');
});

test('requests send only the character and allowlisted references; the key stays in the authorization header', async () => {
  const calls = [];
  const api = createStructureAnalyzer({ fetchImpl: async (url, options) => { calls.push({ url, options }); return response(); } });
  api.configure(config);
  const privateInput = { ...reference, notes: 'PRIVATE_NOTE_MUST_NOT_SEND', pdf: 'PRIVATE_PDF_MUST_NOT_SEND', source: 'PRIVATE_SOURCE_MUST_NOT_SEND', apiKey: 'PRIVATE_FIELD_MUST_NOT_SEND', nested: { userData: 'PRIVATE_NESTED_MUST_NOT_SEND' } };
  const result = await api.analyze('河', privateInput);
  const { url, options } = calls[0], body = JSON.parse(options.body);
  assert.equal(options.headers.Authorization, `Bearer ${config.apiKey}`);
  assert.equal(options.credentials, 'omit');
  assert.equal(options.mode, 'cors');
  assert.equal(options.redirect, 'error');
  assert.equal(options.cache, 'no-store');
  assert.equal(options.method, 'POST');
  assert.equal(body.stream, false);
  assert.deepEqual(JSON.parse(body.messages[1].content), { character: '河', reference });
  assert.match(body.messages[0].content, /JSON数据/);
  assert.match(body.messages[0].content, /统一称为“偏旁”/);
  assert.match(body.messages[0].content, /不得声称阅读过PDF/);
  assert.doesNotMatch(options.body + url, /PRIVATE_|test-key-only-in-memory/);
  assert.deepEqual(result, { ...analysis(), source: 'AI', model: config.model });
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|test-key-only-in-memory/);
});

test('AI explanations consistently use 偏旁 without rewriting any supplied private notes', async () => {
  const api = createStructureAnalyzer({ fetchImpl: async () => response(analysis('河', {
    analysis: '比较部件之间的高低，核对构件组合。', suggestions: ['观察两个部件间的距离。'], uncertainty: '构件名称仍需人工核对。',
  })) });
  api.configure(config);
  const privateReference = { ...reference, notes: [{ content: '用户原文部件不应改写' }] };
  const result = await api.analyze('河', privateReference);
  assert.equal(result.analysis, '比较偏旁之间的高低，核对偏旁组合。');
  assert.deepEqual(result.suggestions, ['观察两个偏旁间的距离。']);
  assert.equal(result.uncertainty, '偏旁名称仍需人工核对。');
  assert.equal(privateReference.notes[0].content, '用户原文部件不应改写');
});

test('plain and fenced JSON responses are validated as AI rather than source evidence', async () => {
  const api = createStructureAnalyzer({ fetchImpl: async () => response(analysis('𠮷', { structure: '结构待核对' }), { fenced: true }) });
  api.configure(config);
  const result = await api.analyze(' 𠮷 ', {});
  assert.equal(result.character, '𠮷');
  assert.equal(result.source, 'AI');
  assert.equal(result.structure, '结构待核对');
  const override = normalizeOverride({ character: result.character, radical: '', decomposition: '', structure: result.structure, components: [], updatedAt: new Date().toISOString() });
  assert.equal(override.structure, result.structure);
});

test('all AI structure enum values are accepted by the notebook model', async () => {
  const structures = ['左右结构', '上下结构', '左中右结构', '上中下结构', '包围结构', '全包围结构', '半包围结构', '交叠结构', '独体字', '结构待核对'];
  for (const structure of structures) {
    const api = createStructureAnalyzer({ fetchImpl: async () => response(analysis('河', { structure })) });
    api.configure(config);
    const result = await api.analyze('河', reference);
    assert.equal(normalizeOverride({ character: result.character, structure, components: [], updatedAt: new Date().toISOString() }).structure, result.structure);
  }
});

test('cache is scoped to the current configuration, character and reference and returns independent results', async () => {
  let calls = 0;
  const api = createStructureAnalyzer({ fetchImpl: async () => { calls++; return response(); } });
  api.configure(config);
  const first = await api.analyze('河', reference);
  first.analysis = 'caller mutation'; first.suggestions.push('caller mutation');
  const second = await api.analyze('河', reference);
  assert.equal(calls, 1);
  assert.notEqual(second.analysis, 'caller mutation');
  assert.equal(second.suggestions.length, 1);
  await api.analyze('河', { ...reference, decomposition: '用户核对的新参考' });
  assert.equal(calls, 2);
  api.clearCache();
  await api.analyze('河', reference);
  assert.equal(calls, 3);
  api.configure({ ...config, model: 'changed-model' });
  assert.equal((await api.analyze('河', reference)).model, 'changed-model');
  assert.equal(calls, 4);
});

test('changing URL, model and key cancels old work even when its fetch ignores AbortSignal', async () => {
  const mock = makeMock(), api = createStructureAnalyzer({ fetchImpl: mock.fetchImpl });
  api.configure(config);
  const old = api.analyze('河', reference);
  const oldRejection = assert.rejects(old, { code: 'ABORTED' });
  const nextConfig = { endpoint: 'https://new-proxy.example.test/analyze', model: 'new-model', apiKey: 'new-test-key' };
  api.configure(nextConfig);
  assert.equal(mock.calls[0].options.signal.aborted, true);
  const current = api.analyze('河', reference);
  assert.equal(mock.calls[1].url, nextConfig.endpoint);
  assert.equal(mock.calls[1].options.headers.Authorization, `Bearer ${nextConfig.apiKey}`);
  assert.equal(JSON.parse(mock.calls[1].options.body).model, nextConfig.model);
  mock.calls[0].resolve(response(analysis('河', { analysis: 'STALE_RESULT' })));
  mock.calls[1].resolve(response(analysis('河', { analysis: 'CURRENT_RESULT' })));
  await oldRejection;
  assert.equal((await current).analysis, 'CURRENT_RESULT');
  assert.equal((await api.analyze('河', reference)).analysis, 'CURRENT_RESULT');
  assert.equal(mock.calls.length, 2);
});

test('cancel promptly rejects both fetch and response parsing even when cancellation is ignored by a mock', async () => {
  const mock = makeMock(), api = createStructureAnalyzer({ fetchImpl: mock.fetchImpl });
  api.configure(config);
  const first = api.analyze('河', reference), rejection = assert.rejects(first, { code: 'ABORTED' });
  api.cancel();
  await rejection;
  assert.equal(mock.calls[0].options.signal.aborted, true);
  mock.calls[0].resolve(response());
  let completeJson;
  const second = api.analyze('河', reference), secondRejection = assert.rejects(second, { code: 'ABORTED' });
  mock.calls[1].resolve({ ok: true, status: 200, json: () => new Promise(resolve => { completeJson = resolve; }) });
  await delay(0);
  api.cancel();
  await secondRejection;
  completeJson({ choices: [{ message: { content: JSON.stringify(analysis()) } }] });
  await delay(0);
  const third = api.analyze('河', reference);
  assert.equal(mock.calls.length, 3, 'Canceled result must not become cached');
  mock.calls[2].resolve(response());
  await third;
});

test('a later character request supersedes earlier work and does not reuse its result', async () => {
  const mock = makeMock(), api = createStructureAnalyzer({ fetchImpl: mock.fetchImpl });
  api.configure(config);
  const first = api.analyze('河', reference), rejection = assert.rejects(first, { code: 'ABORTED' });
  const second = api.analyze('江', { radical: '氵', decomposition: '⿰氵工', structure: '左右结构' });
  mock.calls[1].resolve(response(analysis('江')));
  assert.equal((await second).character, '江');
  mock.calls[0].resolve(response());
  await rejection;
});

test('UI-style cancel then analyze starts new work while canceled work cannot replace unknown structure results', async () => {
  const mock = makeMock(), api = createStructureAnalyzer({ fetchImpl: mock.fetchImpl });
  api.configure(config);
  api.cancel();
  const first = api.analyze('河', reference), rejection = assert.rejects(first, { code: 'ABORTED' });
  api.cancel();
  const second = api.analyze('河', reference);
  mock.calls[1].resolve(response(analysis('河', { structure: '结构待核对' })));
  assert.equal((await second).structure, '结构待核对');
  mock.calls[0].resolve(response(analysis('河', { structure: '独体字' })));
  await rejection;
  assert.equal((await api.analyze('河', reference)).structure, '结构待核对');
  assert.equal(mock.calls.length, 2);
});

test('timeout stops an uncooperative fetch, clears running state and allows a later request', async () => {
  const mock = makeMock(), api = createStructureAnalyzer({ fetchImpl: mock.fetchImpl, timeoutMs: 10 });
  api.configure(config);
  await assert.rejects(api.analyze('河', reference), { code: 'TIMEOUT' });
  assert.equal(mock.calls[0].options.signal.aborted, true);
  mock.calls[0].resolve(response(analysis('河', { analysis: 'LATE_AFTER_TIMEOUT' })));
  const retry = api.analyze('河', reference);
  mock.calls[1].resolve(response());
  assert.notEqual((await retry).analysis, 'LATE_AFTER_TIMEOUT');
});

test('HTTP authentication, quota, permission and server failures have readable messages without service bodies', async () => {
  for (const [status, pattern] of [[401, /认证失败/], [429, /请求受限/], [403, /权限/], [404, /不存在/], [500, /暂时不可用/]]) {
    const api = createStructureAnalyzer({ fetchImpl: async () => ({ ok: false, status, json: async () => { throw Error('SECRET_SERVICE_BODY'); } }) });
    api.configure(config);
    await assert.rejects(api.analyze('河', reference), error => error.code === `HTTP_${status}` && pattern.test(error.message) && !error.message.includes('SECRET'));
  }
});

test('network or CORS errors do not expose raw provider errors or the key', async () => {
  const api = createStructureAnalyzer({ fetchImpl: async () => { throw TypeError(`Failed to fetch ${config.apiKey}`); } });
  api.configure(config);
  await assert.rejects(api.analyze('河', reference), error => error.code === 'NETWORK' && /CORS/.test(error.message) && !error.message.includes(config.apiKey));
});

test('invalid transport JSON and non-JSON completion text are rejected clearly', async () => {
  for (const fetchImpl of [
    async () => ({ ok: true, status: 200, json: async () => { throw SyntaxError('provider body'); } }),
    async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '不是JSON' } }] }) }),
    async () => ({ ok: true, status: 200, json: async () => ({ choices: [] }) }),
  ]) {
    const api = createStructureAnalyzer({ fetchImpl }); api.configure(config);
    await assert.rejects(api.analyze('河', reference), { code: 'INVALID_RESPONSE' });
  }
});

test('wrong characters, unsupported structures, extra fields and excessive text never become accepted analyses', async () => {
  const invalid = [
    analysis('江'), analysis('河', { structure: '黄金比例结构' }), analysis('河', { structure: '左右' }),
    analysis('河', { analysis: '' }), analysis('河', { analysis: '字'.repeat(4001) }),
    analysis('河', { uncertainty: '字'.repeat(1001) }), analysis('河', { uncertainty: 123 }),
    analysis('河', { suggestions: Array(9).fill('建议') }), analysis('河', { suggestions: ['字'.repeat(301)] }),
    analysis('河', { suggestions: [null] }), analysis('河', { source: '教材原文' }),
  ];
  for (const value of invalid) {
    const api = createStructureAnalyzer({ fetchImpl: async () => response(value) }); api.configure(config);
    await assert.rejects(api.analyze('河', reference), { code: 'INVALID_RESPONSE' });
  }
  const api = createStructureAnalyzer({ fetchImpl: async () => response(analysis(), { finishReason: 'length' }) }); api.configure(config);
  await assert.rejects(api.analyze('河', reference), error => error.code === 'INVALID_RESPONSE' && /截断/.test(error.message));
});

test('invalid characters and oversized reference fields fail before sending a request', async () => {
  let calls = 0;
  const api = createStructureAnalyzer({ fetchImpl: async () => { calls++; return response(); } }); api.configure(config);
  for (const character of ['', '河江', 'A', '⿰', null]) await assert.rejects(api.analyze(character, reference), { code: 'INVALID_INPUT' });
  for (const bad of [{ ...reference, decomposition: '字'.repeat(257) }, { ...reference, radical: 1 }, []]) await assert.rejects(api.analyze('河', bad), { code: 'INVALID_INPUT' });
  assert.equal(calls, 0);
});
