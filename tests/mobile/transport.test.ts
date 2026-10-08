import assert from 'node:assert/strict';
import { test } from 'node:test';
import { apiFetch, nativeApiFetch, resolveApiUrl } from '../../app/utils/apiFetch';
import { normalizeLocationError } from '../../app/utils/geolocation';

test('mobile API paths keep the HTTPS backend and encoded query parameters', () => {
  assert.equal(resolveApiUrl('/api/geocode?address=12%20Main%20St', 'https://example.com'),
    'https://example.com/api/geocode?address=12%20Main%20St');
});

test('API paths cannot redirect credential-bearing requests to another origin or leave /api', () => {
  for (const path of ['https://evil.example/api/users', '//evil.example/api/users', '/api/../../login', '/api/\\evil.example']) {
    assert.throws(() => resolveApiUrl(path, 'https://example.com'));
  }
  for (const origin of ['http://example.com', 'https://user:password@example.com', 'https://example.com/path', 'https://example.com?redirect=1']) {
    assert.throws(() => resolveApiUrl('/api/goals/me', origin));
  }
});

test('web API transport preserves the request, bearer token, response and error status', async t => {
  const init = { method: 'POST', headers: { Authorization: 'Bearer test-only' }, body: '{"month":"2026-10"}' };
  const response = new Response('{"error":"forbidden"}', { status: 403 });
  const fetchMock = t.mock.method(globalThis, 'fetch', async (path: unknown, options: unknown) => {
    assert.equal(path, '/api/goals/me');
    assert.equal(options, init);
    return response;
  });
  assert.equal(await apiFetch('/api/goals/me', init), response);
  assert.equal(fetchMock.mock.callCount(), 1);
});

test('native location denial and timeout map to the existing UI error semantics', () => {
  assert.equal(normalizeLocationError({ code: 'OS-PLUG-GLOC-0003' }).code, 1);
  assert.equal(normalizeLocationError({ code: 'OS-PLUG-GLOC-0008' }).code, 1);
  assert.equal(normalizeLocationError({ code: 'OS-PLUG-GLOC-0010' }).code, 3);
  assert.equal(normalizeLocationError({ code: 1, message: 'Denied' }).message, 'Denied');
  assert.equal(normalizeLocationError(null).code, 2);
});

test('native transport preserves auth, serializes JSON and exposes server error responses', async () => {
  process.env.NEXT_PUBLIC_API_BASE_URL = 'https://example.com';
  const response = await nativeApiFetch('/api/admin/settings', {
    method: 'POST',
    headers: { Authorization: 'Bearer test-only', 'Content-Type': 'application/json' },
    body: '{"enabled":true}',
  }, async request => {
    assert.equal(request.url, 'https://example.com/api/admin/settings');
    assert.equal(request.headers?.authorization, 'Bearer test-only');
    assert.equal(request.method, 'POST');
    assert.deepEqual(request.data, { enabled: true });
    assert.equal(request.disableRedirects, true);
    return { status: 403, data: '{"error":"forbidden"}', headers: {}, url: request.url };
  });
  assert.equal(response.ok, false);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: 'forbidden' });
});

test('native transport handles an empty response and rejects aborted or unsupported requests', async () => {
  process.env.NEXT_PUBLIC_API_BASE_URL = 'https://example.com';
  const response = await nativeApiFetch('/api/test', {}, async request => ({ status: 204, data: '', headers: {}, url: request.url }));
  assert.equal(await response.text(), '');
  const controller = new AbortController();
  controller.abort();
  const unexpected = async () => { throw new Error('Native request must not run'); };
  await assert.rejects(nativeApiFetch('/api/test', { signal: controller.signal }, unexpected), { name: 'AbortError' });
  await assert.rejects(nativeApiFetch('/api/test', { body: new FormData() }, unexpected), /serialized JSON/);
});
