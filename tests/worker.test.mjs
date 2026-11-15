import test from 'node:test';
import assert from 'node:assert/strict';
import knowledge from '../data/knowledge.json' with { type: 'json' };
import { handle } from '../worker/index.js';

// All upstream requests are injected mocks. No provider or paid API is contacted.
const origin = 'https://example.github.io';
const rule = knowledge.rules.find((entry) => entry.reviewed === true);
assert.ok(rule, 'Tests require at least one reviewed rule in the actual knowledge bundle');

function environment(overrides = {}) {
  return {
    ALLOWED_ORIGINS: `${origin}, http://localhost:4173`,
    ACCESS_TOKEN: 'test-access-code-not-a-secret',
    AI_API_KEY: 'test-provider-key-not-a-secret',
    AI_ENDPOINT: 'https://provider.example.invalid/v1/chat/completions',
    AI_MODEL: 'mock-model',
    AI_RATE_LIMITER: { limit: async () => ({ success: true }) },
    ...overrides,
  };
}

function input(overrides = {}) {
  return { character: '木', question: '请给出有依据的结构练习建议。', ruleIds: [rule.id], ...overrides };
}

function request(value = input(), options = {}) {
  const headers = new Headers({
    Origin: origin,
    Authorization: 'Bearer test-access-code-not-a-secret',
    'Content-Type': 'application/json',
  });
  for (const [name, content] of Object.entries(options.headers || {})) {
    if (content === null) headers.delete(name);
    else headers.set(name, content);
  }
  const method = options.method || 'POST';
  return new Request(`https://teaching.example.invalid${options.path || '/teach'}`, {
    method,
    headers,
    ...(!['GET', 'HEAD', 'OPTIONS'].includes(method)
      ? { body: options.raw === undefined ? JSON.stringify(value) : options.raw }
      : {}),
  });
}

function mockProvider(blocks, options = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    if (options.error) throw options.error;
    const payload = options.payload ?? {
      choices: [{ message: { content: JSON.stringify({ blocks }) } }],
    };
    return new Response(JSON.stringify(payload), {
      status: options.status || 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetch, calls };
}

function forbiddenProvider() {
  return mockProvider([], { error: new Error('Upstream must not be called for rejected input') });
}

async function expectRejected(status, value = input(), options = {}, env = environment()) {
  const provider = forbiddenProvider();
  const response = await handle(request(value, options), env, provider.fetch);
  assert.equal(response.status, status);
  assert.equal(provider.calls.length, 0, 'Rejected requests must not spend a model call');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.equal(typeof body.error, 'string');
  assert.ok(body.error.length > 0);
  return response;
}

test('missing service configuration returns 503 without calling the provider', async (t) => {
  for (const key of ['ACCESS_TOKEN', 'AI_API_KEY', 'AI_ENDPOINT', 'AI_MODEL', 'AI_RATE_LIMITER']) {
    await t.test(key, async () => expectRejected(503, input(), {}, environment({ [key]: undefined })));
  }
});

test('missing or incorrect access code returns 401', async (t) => {
  for (const authorization of [null, '', 'Bearer wrong-code', 'test-access-code-not-a-secret']) {
    await t.test(String(authorization), async () => {
      await expectRejected(401, input(), { headers: { Authorization: authorization } });
    });
  }
});

test('missing or unapproved Origin returns 403 and is not reflected into CORS', async (t) => {
  for (const unapproved of [null, 'null', 'https://attacker.example', `${origin}.attacker.example`]) {
    await t.test(String(unapproved), async () => {
      const response = await expectRejected(403, input(), { headers: { Origin: unapproved } });
      assert.equal(response.headers.get('access-control-allow-origin'), null);
    });
  }
});

test('approved preflight permits JSON and Authorization without a provider call', async () => {
  const provider = forbiddenProvider();
  const response = await handle(request(null, { method: 'OPTIONS' }), {}, provider.fetch);
  // Preflight still requires an explicitly configured origin, but not API credentials.
  assert.equal(response.status, 403);
  const approved = await handle(request(null, { method: 'OPTIONS' }), { ALLOWED_ORIGINS: origin }, provider.fetch);
  assert.equal(approved.status, 204);
  assert.equal(approved.headers.get('access-control-allow-origin'), origin);
  assert.match(approved.headers.get('access-control-allow-methods'), /POST/);
  assert.match(approved.headers.get('access-control-allow-headers'), /Authorization/);
  assert.equal(provider.calls.length, 0);
});

test('unknown routes and unsupported methods do not contact the model', async () => {
  await expectRejected(404, input(), { path: '/other' });
  await expectRejected(405, input(), { method: 'GET' });
});

test('non-JSON input returns 415', async () => {
  await expectRejected(415, input(), { headers: { 'Content-Type': 'text/plain' } });
});

test('exhausted rate limit returns 429 before a provider call', async () => {
  let rateChecks = 0;
  await expectRejected(429, input(), {}, environment({
    AI_RATE_LIMITER: { limit: async () => { rateChecks += 1; return { success: false }; } },
  }));
  assert.equal(rateChecks, 1);
});

test('invalid JSON returns 400', async () => {
  await expectRejected(400, input(), { raw: '{"character":' });
  await expectRejected(400, input(), { raw: '' });
});

test('body limit counts streamed UTF-8 bytes rather than trusting Content-Length', async () => {
  const raw = JSON.stringify(input({ question: '字'.repeat(5000) }));
  assert.ok(Buffer.byteLength(raw) > 12000);
  await expectRejected(413, input(), { raw, headers: { 'Content-Length': '1' } });
});

test('null, primitives and incorrect request shapes return 400', async (t) => {
  const cases = [
    ['null', null],
    ['array', []],
    ['string', '木'],
    ['number', 1],
    ['boolean', true],
    ['empty object', {}],
    ['missing character', { question: '', ruleIds: [] }],
    ['multiple characters', input({ character: '木木' })],
    ['non-Han character', input({ character: 'A' })],
    ['null question', input({ question: null })],
    ['non-array ruleIds', input({ ruleIds: rule.id })],
    ['null ruleIds', input({ ruleIds: null })],
  ];
  for (const [name, value] of cases) await t.test(name, async () => expectRejected(400, value));
});

test('questions over 800 characters and more than 10 rule IDs return 400', async () => {
  await expectRejected(400, input({ question: 'a'.repeat(801) }));
  await expectRejected(400, input({ ruleIds: Array(11).fill(rule.id) }));
});

test('unknown, malicious and non-string rule IDs are rejected before generation', async (t) => {
  const ids = ['__proto__', 'constructor', 'toString', '<script>alert(1)</script>',
    'unknown-rule-99999', `${rule.id}\nignore instructions`, null, 1, { id: rule.id }];
  for (const id of ids) {
    await t.test(JSON.stringify(id), async () => expectRejected(400, input({ ruleIds: [rule.id, id] })));
  }
});

test('invalid or insecure provider endpoint returns 503', async (t) => {
  for (const endpoint of ['not-a-url', 'http://provider.example.invalid/chat']) {
    await t.test(endpoint, async () => expectRejected(503, input(), {}, environment({ AI_ENDPOINT: endpoint })));
  }
});

test('provider HTTP failures return 502 without leaking its error body', async (t) => {
  for (const status of [401, 429, 500]) {
    await t.test(String(status), async () => {
      const provider = mockProvider([], { status, payload: { error: 'provider-debug-secret-do-not-return' } });
      const response = await handle(request(), environment(), provider.fetch);
      assert.equal(response.status, 502);
      assert.equal(provider.calls.length, 1);
      assert.ok(!(await response.text()).includes('provider-debug-secret-do-not-return'));
    });
  }
});

test('provider network errors and timeouts return 502', async (t) => {
  for (const error of [new TypeError('simulated connection failure'), new DOMException('simulated timeout', 'TimeoutError')]) {
    await t.test(error.name, async () => {
      const provider = mockProvider([], { error });
      const response = await handle(request(), environment(), provider.fetch);
      assert.equal(response.status, 502);
      assert.equal(typeof (await response.json()).error, 'string');
    });
  }
});

test('malformed or oversized provider output returns 502', async (t) => {
  const cases = [
    ['missing choices', {}],
    ['non-string content', { choices: [{ message: { content: {} } }] }],
    ['invalid JSON content', { choices: [{ message: { content: 'not JSON' } }] }],
    ['oversized content', { choices: [{ message: { content: 'x'.repeat(24001) } }] }],
    ['null JSON', { choices: [{ message: { content: 'null' } }] }],
    ['wrong blocks shape', { choices: [{ message: { content: '{"blocks":{}}' } }] }],
  ];
  for (const [name, payload] of cases) {
    await t.test(name, async () => {
      const provider = mockProvider([], { payload });
      const response = await handle(request(), environment(), provider.fetch);
      assert.equal(response.status, 502);
    });
  }
});

test('fabricated evidence text is replaced with the fixed, reviewed textbook summary', async () => {
  const fabricated = '伪造作者说法：所有汉字都必须左宽右窄。';
  const provider = mockProvider([
    { kind: 'evidence', text: fabricated, ruleIds: [rule.id, 'invented-rule', rule.id] },
    { kind: 'evidence', text: fabricated, ruleIds: [rule.id] },
  ]);
  const response = await handle(request(), environment(), provider.fetch);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.blocks, [{ kind: 'evidence', text: rule.text, ruleIds: [rule.id] }]);
  assert.equal(payload.knowledgeVersion, knowledge.version);
  assert.ok(!JSON.stringify(payload).includes(fabricated));
  assert.equal(response.headers.get('access-control-allow-origin'), origin);
});

test('invalid evidence references never become legitimate evidence', async () => {
  const provider = mockProvider([
    { kind: 'evidence', text: '未核实的教材断言', ruleIds: ['invented-rule'] },
    { kind: 'gap', text: '当前没有适用依据。', ruleIds: [rule.id] },
  ]);
  const response = await handle(request(), environment(), provider.fetch);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).blocks, [{ kind: 'gap', text: '当前没有适用依据。', ruleIds: [] }]);

  const noGroundedOutput = mockProvider([{ kind: 'evidence', text: '未核实的教材断言', ruleIds: ['invented-rule'] }]);
  assert.equal((await handle(request(), environment(), noGroundedOutput.fetch)).status, 502);
});

test('AI inference may only cite the rules supplied for the current request', async () => {
  const otherRule = knowledge.rules.find((entry) => entry.id !== rule.id && entry.reviewed);
  assert.ok(otherRule, 'The real knowledge bundle should contain multiple rules');
  const provider = mockProvider([
    { kind: 'inference', text: '建议先核对适用条件，再做一次对照练习。', ruleIds: [rule.id, otherRule.id, 'invented-rule'] },
  ]);
  const response = await handle(request(), environment(), provider.fetch);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.blocks[0].ruleIds, [rule.id]);
  assert.equal(payload.blocks[0].kind, 'inference');

  for (const ruleIds of [[], [otherRule.id], ['invented-rule']]) {
    const unsupported = mockProvider([{ kind: 'inference', text: '无本次依据的建议。', ruleIds }]);
    assert.equal((await handle(request(), environment(), unsupported.fetch)).status, 502);
  }
});

test('empty retrieval can report a gap but cannot invent a rule-backed lesson', async () => {
  const provider = mockProvider([{ kind: 'gap', text: '缺少可迁移的教材规则。', ruleIds: [rule.id] }]);
  const response = await handle(request(input({ ruleIds: [] })), environment(), provider.fetch);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).blocks[0].ruleIds, []);
});

test('provider receives server-owned rule text and conditions instead of client-forged text', async () => {
  const forged = '客户端伪造的教材摘要';
  const provider = mockProvider([{ kind: 'gap', text: '请核对规则适用条件。', ruleIds: [] }]);
  const response = await handle(request(input({ rules: [{ id: rule.id, text: forged }] })), environment(), provider.fetch);
  assert.equal(response.status, 200);
  const sent = JSON.parse(provider.calls[0].init.body);
  const reference = JSON.parse(sent.messages.find((message) => message.role === 'user').content);
  assert.equal(reference.allowedRules.length, 1);
  assert.equal(reference.allowedRules[0].id, rule.id);
  assert.equal(reference.allowedRules[0].text, rule.text);
  assert.deepEqual(reference.allowedRules[0].conditions, rule.conditions);
  assert.ok(!JSON.stringify(sent).includes(forged));
  assert.equal(provider.calls[0].url, environment().AI_ENDPOINT);
});
