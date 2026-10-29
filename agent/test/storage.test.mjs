import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SessionStorage } from '../src/storage.mjs';

function makeStorage(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'codex-web-storage-'));
  const storage = new SessionStorage(directory);
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return storage;
}

test('coalesces scheduled snapshots and only materializes the latest one', async (t) => {
  const storage = makeStorage(t);
  let snapshots = 0;

  storage.schedule(() => {
    snapshots += 1;
    return [{ id: 'stale' }];
  });
  storage.schedule(() => {
    snapshots += 1;
    return [{ id: 'latest' }];
  });

  await storage.flush();
  assert.equal(snapshots, 1);
  assert.equal(storage.load()[0].id, 'latest');
  await storage.close();
});

test('close waits for an active write and flushes pending data', async (t) => {
  const storage = makeStorage(t);

  storage.schedule(() => [{ id: 'first' }]);
  const writing = storage.flush();
  storage.schedule(() => [{ id: 'last' }]);

  await storage.close();
  await writing;

  assert.deepEqual(storage.load().map((session) => session.id), ['last']);
});
