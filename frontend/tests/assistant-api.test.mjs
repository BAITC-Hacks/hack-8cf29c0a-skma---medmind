import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

// Execute the same client Vite builds, with the global order demo flag enabled.
const source = await readFile(new URL('../src/shared/api/assistant.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source.replaceAll('import.meta.env',
  JSON.stringify({ VITE_USE_MOCK: 'true', VITE_API_BASE_URL: '/api' })), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 },
}).outputText;
const api = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('assistant uses server for status, conversations, files and messages even in order demo mode', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url, init });
    return init?.method === 'DELETE' ? new Response(null, { status: 204 }) : Response.json({ fromServer: true });
  });
  assert.deepEqual(await api.getAssistantStatus(), { fromServer: true });
  await api.listConversations();
  await api.createConversation();
  await api.getConversation('conv/1');
  await api.uploadAssistantFile('conv/1', new File(['sales'], 'sales.csv'));
  const body = { content: 'Прогноз', file_ids: ['f1'], mode: 'deep' };
  assert.deepEqual(await api.sendAssistantMessage('conv/1', body), { fromServer: true });
  await api.deleteConversation('conv/1');
  assert.deepEqual(calls.map((c) => c.url), [
    '/api/assistant/status', '/api/assistant/conversations', '/api/assistant/conversations',
    '/api/assistant/conversations/conv%2F1', '/api/assistant/conversations/conv%2F1/files',
    '/api/assistant/conversations/conv%2F1/messages', '/api/assistant/conversations/conv%2F1',
  ]);
  assert.equal(calls[4].init.body.get('file').name, 'sales.csv');
  assert.deepEqual(JSON.parse(calls[5].init.body), body);
});

test('server errors and network failures never fall back to a demo reply', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ detail: 'OpenAI: исчерпана квота' }, { status: 502 }));
  await assert.rejects(api.sendAssistantMessage('c1', { content: 'Привет', file_ids: [], mode: 'fast' }), /квота/);
  fetch.mock.mockImplementation(async () => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(api.getAssistantStatus(), /Сервер недоступен/);
});

test('order link reads the real order and approval posts only after an explicit call', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url, init });
    return Response.json({ id: 'r/1', status: init?.method === 'POST' ? 'approved' : 'pending' });
  });
  assert.equal((await api.getAssistantOrder('r/1')).status, 'pending');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/recommendations/r%2F1');
  assert.equal(calls[0].init, undefined);
  assert.equal((await api.approveAssistantOrder('r/1', 25, 'Проверено')).status, 'approved');
  assert.equal(calls[1].url, '/api/recommendations/r%2F1/approve');
  assert.deepEqual(JSON.parse(calls[1].init.body), { approved_qty: 25, comment: 'Проверено' });
});
