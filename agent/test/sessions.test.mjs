import assert from 'node:assert/strict';
import test from 'node:test';
import { SessionStore, appendUserMessage, upsertItem } from '../src/sessions.mjs';

function makeSession(store) {
  return store.create({
    id: '11111111-1111-4111-8111-111111111111',
    title: 'test',
    settings: {
      workingDirectory: '.',
      model: '',
      reasoningEffort: 'high',
      sandboxMode: 'workspace-write',
      webSearchMode: 'disabled',
      networkAccessEnabled: false,
    },
  });
}

test('caps the in-memory timeline without losing up-to-date items', () => {
  const store = new SessionStore({ maxSessions: 1 });
  const session = makeSession(store);

  upsertItem(session, { id: 'old-item', type: 'agent_message', text: 'old' });
  for (let index = 0; index < 300; index += 1) {
    appendUserMessage(session, `message-${index}`, `message-${index}`);
  }

  assert.equal(session.timeline.length, 300);
  assert.equal(session.timeline[0].text, 'message-0');
  assert.equal(session.timeline.at(-1).text, 'message-299');
  assert.equal(session.itemEntries.has('old-item'), false);
  assert.equal(store.snapshot()[0].timeline.length, 300);
});

test('keeps updating an item that is still present in the timeline', () => {
  const store = new SessionStore({ maxSessions: 1 });
  const session = makeSession(store);

  upsertItem(session, { id: 'item-1', type: 'agent_message', text: 'partial' });
  for (let index = 0; index < 299; index += 1) {
    appendUserMessage(session, `message-${index}`, `message-${index}`);
  }
  upsertItem(session, { id: 'item-1', type: 'agent_message', text: 'complete' });

  assert.equal(session.timeline.length, 300);
  assert.equal(session.itemEntries.get('item-1').item.text, 'complete');
  assert.equal(
    store.snapshot()[0].timeline.find((entry) => entry.item?.id === 'item-1').item.text,
    'complete',
  );
});
