import assert from 'node:assert/strict';
import http from 'node:http';
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
    turnIdleTimeoutMs: 5_000,
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

/**
 * 模拟上游断连：吐出 turn.started 后彻底静默，只有 abort 信号能结束。
 * 这正是 Codex CLI 无法访问模型服务时的真实表现。
 */
function makeStalledThread(options) {
  return {
    options,
    async runStreamed(prompt, turnOptions = {}) {
      const signal = turnOptions.signal;
      const events = (async function* generate() {
        yield { type: 'thread.started', thread_id: 'thread-stalled-123456' };
        yield { type: 'turn.started' };
        await new Promise((resolve, reject) => {
          const onAbort = () => reject(signal?.reason || new Error('aborted'));
          if (signal?.aborted) onAbort();
          else signal?.addEventListener('abort', onAbort, { once: true });
        });
      })();
      return { events };
    },
  };
}

/** 上游持续产出事件，但间隔小于空闲超时。 */
function makeSlowThread(options) {
  return {
    options,
    async runStreamed(prompt) {
      const events = (async function* generate() {
        yield { type: 'thread.started', thread_id: 'thread-slow-123456' };
        yield { type: 'turn.started' };
        await new Promise((resolve) => setTimeout(resolve, 60));
        yield {
          type: 'item.completed',
          item: { id: 'message-slow-1', type: 'agent_message', text: `收到：${prompt}` },
        };
        await new Promise((resolve) => setTimeout(resolve, 60));
        yield { type: 'turn.completed', usage: { output_tokens: 2 } };
      })();
      return { events };
    },
  };
}

/** 直接抛出一个不可恢复的顶层 error 事件后结束流。 */
function makeErrorEventThread(options) {
  return {
    options,
    async runStreamed() {
      const events = (async function* generate() {
        yield { type: 'thread.started', thread_id: 'thread-error-123456' };
        yield { type: 'turn.started' };
        yield { type: 'error', message: 'stream exploded' };
      })();
      return { events };
    },
  };
}

/**
 * 模拟 Codex CLI 的可恢复重试：先发顶层 error（如传输回退），随后照常完成这一轮。
 * 真实场景见 DeepSeek 等只支持 HTTP 版 Responses API 的端点。
 */
function makeRecoveringThread(options) {
  return {
    options,
    async runStreamed(prompt) {
      const events = (async function* generate() {
        yield { type: 'thread.started', thread_id: 'thread-recover-123456' };
        yield { type: 'turn.started' };
        yield { type: 'error', message: 'Reconnecting... 1/5 (transport fallback)' };
        yield {
          type: 'item.completed',
          item: { id: 'message-1', type: 'agent_message', text: `收到：${prompt}` },
        };
        yield { type: 'turn.completed', usage: { output_tokens: 2 } };
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

/**
 * 用 node:http 直接发起回合请求，并可把请求体拆成两段延迟发送。
 * delayMs 为 0 时等价于普通请求，仅用于与其他请求制造并发重叠。
 */
function startTurnRequest(baseUrl, sessionId, payload, delayMs = 0) {
  const url = new URL(`/api/sessions/${sessionId}/turns`, baseUrl);
  const body = Buffer.from(JSON.stringify(payload));
  const splitAt = Math.floor(body.length / 2);

  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': body.length,
        },
      },
      (response) => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          text += chunk;
        });
        response.on('end', () => resolve({ status: response.statusCode, text }));
      },
    );
    request.on('error', reject);
    request.write(body.subarray(0, splitAt));
    setTimeout(() => request.end(body.subarray(splitAt)), delayMs);
  });
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

test('rejects a second turn while another turn is still being submitted', async (t) => {
  const { baseUrl } = await startServer(t);
  const { payload } = await createSession(baseUrl, {});
  const sessionId = payload.session.id;

  // 第一个请求故意把请求体拆成两段延迟发送，制造“已进入 runTurn、尚未读完 body”的窗口。
  const first = startTurnRequest(baseUrl, sessionId, { prompt: 'first', messageId: 'm-first' }, 150);
  await new Promise((resolve) => setTimeout(resolve, 40));
  const second = await startTurnRequest(baseUrl, sessionId, {
    prompt: 'second',
    messageId: 'm-second',
  });

  assert.equal(second.status, 409);
  assert.match(second.text, /正在运行/);

  const firstResult = await first;
  assert.equal(firstResult.status, 200);

  const history = await (await fetch(`${baseUrl}/api/sessions/${sessionId}`)).json();
  const userMessages = history.timeline.filter((entry) => entry.type === 'user_message');
  assert.deepEqual(userMessages.map((entry) => entry.text), ['first']);
  assert.equal(history.session.status, 'idle');

  // 被拒绝的请求不能把会话锁死：随后正常提交仍然可以执行。
  const third = await fetch(`${baseUrl}/api/sessions/${sessionId}/turns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'third', messageId: 'm-third' }),
  });
  assert.equal(third.status, 200);
  await third.text();
});

test('answers malformed URL paths with 400 instead of 500', async (t) => {
  const { baseUrl } = await startServer(t);

  const response = await fetch(`${baseUrl}/%E0%A4%A`);
  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.match(payload.error, /路径/);
});

test('accepts a maximum-length Chinese prompt and rejects one character more', async (t) => {
  const { baseUrl } = await startServer(t);
  const { payload } = await createSession(baseUrl, {});
  const sessionId = payload.session.id;

  // 100k 个中文字符约 300KB：按字符长度合法，不能因为默认 256KB 的请求体上限被判 413。
  const turn = await fetch(`${baseUrl}/api/sessions/${sessionId}/turns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: '中'.repeat(100_000), messageId: 'm-long' }),
  });
  assert.equal(turn.status, 200);
  await turn.text();

  const tooLong = await fetch(`${baseUrl}/api/sessions/${sessionId}/turns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: '中'.repeat(100_001), messageId: 'm-too-long' }),
  });
  assert.equal(tooLong.status, 413);
  await tooLong.text();
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

test('aborts a stalled turn with a readable idle-timeout error', { timeout: 5_000 }, async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'codex-web-idle-'));
  const config = makeConfig(root, { turnIdleTimeoutMs: 120 });
  const codex = {
    startThread(options) {
      return makeStalledThread(options);
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
    body: JSON.stringify({ prompt: 'hang', messageId: 'client-idle-1' }),
  });
  assert.equal(turn.status, 200);
  const messages = parseSse(await turn.text());

  const error = messages.find((message) => message.type === 'error');
  assert.ok(error, '超时必须下发 error 消息，而不是让浏览器无限等待');
  assert.match(error.message, /没有返回任何事件/);
  assert.match(error.hint, /AGENT_TURN_IDLE_TIMEOUT_MS/);

  const done = messages.find((message) => message.type === 'done');
  assert.ok(done);
  assert.equal(done.session.status, 'idle');

  const history = await (await fetch(`${baseUrl}/api/sessions/${payload.session.id}`)).json();
  assert.match(history.session.lastError, /没有返回任何事件/);
  assert.ok(
    history.timeline.some(
      (entry) => entry.type === 'notice' && entry.level === 'error' && /没有返回任何事件/.test(entry.text),
    ),
  );
});

test('resets the idle timeout whenever events keep arriving', { timeout: 5_000 }, async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'codex-web-idle-active-'));
  const config = makeConfig(root, { turnIdleTimeoutMs: 400 });
  const codex = {
    startThread(options) {
      return makeSlowThread(options);
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
    body: JSON.stringify({ prompt: 'slow', messageId: 'client-slow-1' }),
  });
  const messages = parseSse(await turn.text());

  assert.equal(messages.some((message) => message.type === 'error'), false);
  assert.ok(
    messages.some(
      (message) =>
        message.type === 'event' &&
        message.event.item?.type === 'agent_message' &&
        message.event.item.text === '收到：slow',
    ),
  );
  const done = messages.find((message) => message.type === 'done');
  assert.equal(done.session.status, 'idle');
});

test('treats a top-level error event as a failed turn', { timeout: 5_000 }, async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'codex-web-stream-error-'));
  const config = makeConfig(root);
  const codex = {
    startThread(options) {
      return makeErrorEventThread(options);
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
    body: JSON.stringify({ prompt: 'boom', messageId: 'client-stream-error-1' }),
  });
  const messages = parseSse(await turn.text());

  const error = messages.find((message) => message.type === 'error');
  assert.ok(error);
  assert.match(error.message, /stream exploded/);

  const history = await (await fetch(`${baseUrl}/api/sessions/${payload.session.id}`)).json();
  assert.equal(history.session.lastError, 'stream exploded');
  assert.ok(
    history.timeline.some(
      (entry) => entry.type === 'notice' && entry.level === 'error' && entry.text === 'stream exploded',
    ),
  );
});

test(
  'keeps the turn successful when a recoverable error is followed by turn.completed',
  { timeout: 5_000 },
  async (t) => {
    const root = mkdtempSync(path.join(tmpdir(), 'codex-web-stream-recover-'));
    const config = makeConfig(root);
    const codex = {
      startThread(options) {
        return makeRecoveringThread(options);
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
      body: JSON.stringify({ prompt: 'retry', messageId: 'client-recover-1' }),
    });
    const messages = parseSse(await turn.text());

    assert.equal(messages.some((message) => message.type === 'error'), false);
    assert.ok(
      messages.some(
        (message) =>
          message.type === 'event' &&
          message.event.item?.type === 'agent_message' &&
          message.event.item.text === '收到：retry',
      ),
    );

    const done = messages.find((message) => message.type === 'done');
    assert.equal(done.session.status, 'idle');
    assert.equal(done.session.lastError, null);

    const history = await (await fetch(`${baseUrl}/api/sessions/${payload.session.id}`)).json();
    assert.equal(history.session.lastError, null);
    assert.equal(
      history.timeline.some((entry) => entry.type === 'notice' && entry.level === 'error'),
      false,
    );
  },
);
