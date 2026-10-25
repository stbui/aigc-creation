import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createAgentServer } from '../src/app.mjs';

function makeConfig(root, overrides = {}) {
  return {
    host: '127.0.0.1',
    port: 0,
    workspaceRoot: realpathSync(root),
    accessToken: '',
    allowDangerFullAccess: false,
    maxSessions: 10,
    defaultModel: '',
    codexPathOverride: '',
    baseUrl: '',
    apiKey: '',
    ...overrides,
  };
}

function makeFakeCodex() {
  const threads = [];
  const resumed = [];

  const codex = {
    threads,
    resumed,
    startThread(options) {
      const thread = makeFakeThread(options);
      threads.push(thread);
      return thread;
    },
    resumeThread(id, options) {
      const thread = makeFakeThread(options, id);
      threads.push(thread);
      resumed.push({ id, options });
      return thread;
    },
  };
  return codex;
}

function makeFakeThread(options, resumeId = null, failure = null) {
  return {
    options,
    id: resumeId,
    async runStreamed(prompt) {
      const events = (async function* generate() {
        yield { type: 'thread.started', thread_id: resumeId || 'thread-fake-123456' };
        yield { type: 'turn.started' };
        if (failure) throw failure;
        yield {
          type: 'item.started',
          item: {
            id: 'command-1',
            type: 'command_execution',
            command: 'printf hello',
            aggregated_output: '',
            status: 'in_progress',
          },
        };
        yield {
          type: 'item.completed',
          item: {
            id: 'command-1',
            type: 'command_execution',
            command: 'printf hello',
            aggregated_output: 'hello',
            exit_code: 0,
            status: 'completed',
          },
        };
        yield {
          type: 'item.completed',
          item: { id: 'message-1', type: 'agent_message', text: `收到：${prompt}` },
        };
        yield {
          type: 'turn.completed',
          usage: {
            input_tokens: 12,
            cached_input_tokens: 0,
            cache_write_input_tokens: 0,
            output_tokens: 5,
            reasoning_output_tokens: 1,
          },
        };
      })();
      return { events };
    },
  };
}

async function startServer(t, { config, codex = makeFakeCodex(), root } = {}) {
  const testRoot = root || mkdtempSync(path.join(tmpdir(), 'codex-web-test-'));
  mkdirSync(path.join(testRoot, 'project'), { recursive: true });
  const serverConfig = config || makeConfig(testRoot);
  const { server, sessions } = createAgentServer({ config: serverConfig, codex });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  t.after(async () => {
    sessions.abortAll();
    await new Promise((resolve) => server.close(resolve));
    rmSync(testRoot, { recursive: true, force: true });
  });

  return { baseUrl, codex, sessions, config: serverConfig, root: testRoot };
}

function parseSse(body) {
  return body
    .split('\n\n')
    .map((block) =>
      block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('\n'),
    )
    .filter(Boolean)
    .map((data) => JSON.parse(data));
}

async function createSession(baseUrl, settings = {}, headers = {}) {
  const response = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ settings }),
  });
  return { response, payload: await response.json() };
}

test('serves the UI and an unauthenticated health check', async (t) => {
  const { baseUrl, config } = await startServer(t);

  const page = await fetch(`${baseUrl}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.match(await page.text(), /Codex Web/);
  assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);

  const health = await fetch(`${baseUrl}/api/health`);
  assert.equal(health.status, 200);
  const payload = await health.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.authRequired, false);
  assert.equal('workspaceRoot' in payload, false);
  assert.equal(config.workspaceRoot.length > 0, true);
});

test('creates a session, streams Codex events, and stores the timeline', async (t) => {
  const { baseUrl, codex, config } = await startServer(t);
  const { response, payload } = await createSession(baseUrl, {
    workingDirectory: 'project',
    sandboxMode: 'read-only',
    reasoningEffort: 'low',
  });

  assert.equal(response.status, 201);
  assert.ok(payload.session.id);
  assert.equal(payload.session.codexThreadId, null);
  assert.equal(payload.session.settings.workingDirectory, 'project');
  assert.equal(codex.threads.length, 1);
  assert.equal(codex.threads[0].options.workingDirectory, path.join(config.workspaceRoot, 'project'));
  assert.equal(codex.threads[0].options.sandboxMode, 'read-only');
  assert.equal(codex.threads[0].options.approvalPolicy, 'never');
  assert.equal(codex.threads[0].options.skipGitRepoCheck, true);

  const turn = await fetch(`${baseUrl}/api/sessions/${payload.session.id}/turns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'hello', messageId: 'client-message-1' }),
  });
  assert.equal(turn.status, 200);
  assert.match(turn.headers.get('content-type'), /text\/event-stream/);

  const messages = parseSse(await turn.text());
  assert.equal(messages[0].type, 'session');
  assert.ok(messages.some((message) => message.type === 'event' && message.event.type === 'thread.started'));
  assert.ok(
    messages.some(
      (message) =>
        message.type === 'event' &&
        message.event.type === 'item.completed' &&
        message.event.item.type === 'agent_message' &&
        message.event.item.text === '收到：hello',
    ),
  );
  const done = messages.find((message) => message.type === 'done');
  assert.ok(done);
  assert.equal(done.session.codexThreadId, 'thread-fake-123456');
  assert.equal(done.session.status, 'idle');
  assert.equal(done.session.usage.output_tokens, 5);

  const history = await fetch(`${baseUrl}/api/sessions/${payload.session.id}`);
  assert.equal(history.status, 200);
  const historyPayload = await history.json();
  assert.equal(historyPayload.timeline.length, 3);
  assert.equal(historyPayload.timeline[0].id, 'client-message-1');
  assert.equal(historyPayload.timeline[0].text, 'hello');
  assert.equal(historyPayload.timeline[1].item.aggregated_output, 'hello');
  assert.equal(historyPayload.session.title, 'hello');
});

test('rejects working directories outside the workspace root', async (t) => {
  const { baseUrl } = await startServer(t);
  const { response, payload } = await createSession(baseUrl, { workingDirectory: '..' });
  assert.equal(response.status, 403);
  assert.match(payload.error, /根目录/);
});

test('keeps repeated Codex item ids separate across turns', async (t) => {
  const { baseUrl } = await startServer(t);
  const { payload } = await createSession(baseUrl, {});
  const sessionId = payload.session.id;

  for (const [index, prompt] of ['first', 'second'].entries()) {
    const turn = await fetch(`${baseUrl}/api/sessions/${sessionId}/turns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, messageId: `turn-message-${index}` }),
    });
    assert.equal(turn.status, 200);
    await turn.text();
  }

  const history = await fetch(`${baseUrl}/api/sessions/${sessionId}`);
  const historyPayload = await history.json();
  const agentMessages = historyPayload.timeline
    .filter((entry) => entry.type === 'item' && entry.item?.type === 'agent_message')
    .map((entry) => entry.item.text);

  assert.deepEqual(agentMessages, ['收到：first', '收到：second']);
  assert.equal(historyPayload.timeline.length, 6);
});

test('danger-full-access is denied unless explicitly enabled', async (t) => {
  const { baseUrl } = await startServer(t);
  const { response, payload } = await createSession(baseUrl, {
    sandboxMode: 'danger-full-access',
  });
  assert.equal(response.status, 403);
  assert.match(payload.error, /danger-full-access/);
});

test('protects APIs with an optional bearer token', async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'codex-web-auth-'));
  const config = makeConfig(root, { accessToken: 'test-secret' });
  const serverCtx = await startServer(t, { config, root });

  const health = await fetch(`${serverCtx.baseUrl}/api/health`);
  assert.equal(health.status, 200);

  const denied = await fetch(`${serverCtx.baseUrl}/api/config`);
  assert.equal(denied.status, 401);

  const allowed = await fetch(`${serverCtx.baseUrl}/api/config`, {
    headers: { Authorization: 'Bearer test-secret' },
  });
  assert.equal(allowed.status, 200);
  const payload = await allowed.json();
  assert.equal(payload.authRequired, true);
  assert.equal(payload.workspaceRoot, realpathSync(root));

  const queryAllowed = await fetch(`${serverCtx.baseUrl}/api/sessions?token=test-secret`);
  assert.equal(queryAllowed.status, 200);
});

test('resumes an existing Codex thread', async (t) => {
  const { baseUrl, codex } = await startServer(t);
  const response = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resumeThreadId: 'thread-existing-123', settings: {} }),
  });
  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.equal(payload.session.codexThreadId, 'thread-existing-123');
  assert.equal(codex.resumed.length, 1);
  assert.equal(codex.resumed[0].id, 'thread-existing-123');
});

test('turns failures into an error event and a persisted notice', async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'codex-web-error-'));
  const config = makeConfig(root);
  const codex = {
    startThread(options) {
      return makeFakeThread(options, null, new Error('not logged in'));
    },
    resumeThread(options, id) {
      return makeFakeThread(options, id, new Error('not logged in'));
    },
  };
  const { baseUrl } = await startServer(t, { config, codex, root });
  const { payload } = await createSession(baseUrl, {});
  const turn = await fetch(`${baseUrl}/api/sessions/${payload.session.id}/turns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'break', messageId: 'client-error-1' }),
  });
  const messages = parseSse(await turn.text());
  const error = messages.find((message) => message.type === 'error');
  assert.ok(error);
  assert.match(error.message, /not logged in/);
  assert.match(error.hint, /codex login/);

  const history = await fetch(`${baseUrl}/api/sessions/${payload.session.id}`);
  const historyPayload = await history.json();
  assert.equal(historyPayload.session.lastError, 'not logged in');
  assert.ok(historyPayload.timeline.some((entry) => entry.type === 'notice' && entry.level === 'error'));
});

test('does not surface benign Codex configuration diagnostics as errors', async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'codex-web-diagnostics-'));
  const config = makeConfig(root);
  const codex = {
    startThread() {
      return {
        async runStreamed(prompt) {
          const events = (async function* generate() {
            yield { type: 'thread.started', thread_id: 'thread-diagnostics-123' };
            yield {
              type: 'item.completed',
              item: {
                id: 'warning-1',
                type: 'error',
                message: 'Codex is ignoring 2 unrecognized configuration settings.',
              },
            };
            yield {
              type: 'item.completed',
              item: {
                id: 'warning-2',
                type: 'error',
                message:
                  'Model metadata for `example-model` not found. Defaulting to fallback metadata; this can degrade performance.',
              },
            };
            yield {
              type: 'item.completed',
              item: { id: 'message-diagnostics-1', type: 'agent_message', text: `收到：${prompt}` },
            };
            yield { type: 'turn.completed', usage: { output_tokens: 3 } };
          })();
          return { events };
        },
      };
    },
    resumeThread() {
      throw new Error('not used');
    },
  };
  const { baseUrl } = await startServer(t, { config, codex, root });
  const { payload } = await createSession(baseUrl, {});
  const turn = await fetch(`${baseUrl}/api/sessions/${payload.session.id}/turns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'check', messageId: 'client-diagnostics-1' }),
  });
  const messages = parseSse(await turn.text());
  const errorItems = messages.filter(
    (message) => message.type === 'event' && message.event.type === 'item.completed' && message.event.item.type === 'error',
  );
  assert.equal(errorItems.length, 0);
  assert.ok(
    messages.some(
      (message) =>
        message.type === 'event' &&
        message.event.item?.type === 'agent_message' &&
        message.event.item.text === '收到：check',
    ),
  );

  const history = await fetch(`${baseUrl}/api/sessions/${payload.session.id}`);
  const historyPayload = await history.json();
  assert.equal(
    historyPayload.timeline.filter((entry) => entry.type === 'item' && entry.item?.type === 'error').length,
    0,
  );
});
