import { randomUUID } from 'node:crypto';

const MAX_TIMELINE_ENTRIES = 300;
const MAX_MESSAGE_LENGTH = 100_000;
const MAX_OUTPUT_LENGTH = 64_000;

const REASONING_EFFORTS = new Set([
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
  'persistent',
]);
const SANDBOX_MODES = new Set(['read-only', 'workspace-write', 'danger-full-access']);
const WEB_SEARCH_MODES = new Set(['disabled', 'cached', 'live']);

export class SessionStore {
  constructor({ maxSessions = 25, initialSessions = [], onChange = null } = {}) {
    this.maxSessions = maxSessions;
    this.sessions = new Map();
    this.onChange = onChange;
    this.restore(initialSessions);
  }

  create(data) {
    const now = Date.now();
    const session = {
      id: data.id,
      title: data.title || '新会话',
      createdAt: now,
      updatedAt: now,
      status: 'idle',
      codexThreadId: data.codexThreadId || null,
      settings: data.settings,
      resolvedWorkingDirectory: data.resolvedWorkingDirectory,
      thread: data.thread,
      timeline: [],
      itemEntries: new Map(),
      usage: null,
      lastError: null,
      abortController: null,
      onChange: this.onChange,
    };
    this.sessions.set(session.id, session);
    this.prune();
    this.notify();
    return session;
  }

  restore(records) {
    if (!Array.isArray(records)) return;
    for (const record of records) {
      const session = restoreSession(record, this.onChange);
      if (!session || this.sessions.has(session.id)) continue;
      this.sessions.set(session.id, session);
      if (this.sessions.size >= this.maxSessions) break;
    }
    this.prune();
  }

  get(id) {
    return this.sessions.get(id) || null;
  }

  list() {
    return [...this.sessions.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  delete(id) {
    const session = this.sessions.get(id);
    if (!session) return false;
    if (session.abortController) session.abortController.abort();
    this.sessions.delete(id);
    this.notify();
    return true;
  }

  snapshot() {
    return this.list().map(serializeSession);
  }

  notify() {
    this.onChange?.();
  }

  abortAll() {
    for (const session of this.sessions.values()) {
      if (session.abortController) session.abortController.abort();
    }
  }

  prune() {
    if (this.sessions.size <= this.maxSessions) return;
    const evictable = this.list()
      .filter((session) => session.status !== 'running')
      .sort((a, b) => a.updatedAt - b.updatedAt);

    for (const session of evictable) {
      if (this.sessions.size <= this.maxSessions) break;
      this.sessions.delete(session.id);
    }
  }
}

export function appendUserMessage(session, text, id) {
  const entry = {
    type: 'user_message',
    id: id || `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    text,
    createdAt: new Date().toISOString(),
  };
  session.timeline.push(entry);
  trimTimeline(session);
  session.updatedAt = Date.now();
  session.onChange?.();
  return entry;
}

export function appendNotice(session, text, level = '') {
  const entry = {
    type: 'notice',
    id: `notice-${randomUUID()}`,
    level: level === 'error' ? 'error' : '',
    text,
    createdAt: new Date().toISOString(),
  };
  session.timeline.push(entry);
  trimTimeline(session);
  session.updatedAt = Date.now();
  return entry;
}

export function upsertItem(session, item) {
  if (!item || typeof item !== 'object' || !item.id) return null;

  let entry = session.itemEntries.get(item.id);
  if (!entry) {
    entry = {
      type: 'item',
      id: item.id,
      item,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    session.itemEntries.set(item.id, entry);
    session.timeline.push(entry);
    trimTimeline(session);
  } else {
    entry.item = item;
    entry.updatedAt = new Date().toISOString();
  }
  session.updatedAt = Date.now();
  session.onChange?.();
  return entry;
}

function trimTimeline(session) {
  const overflow = session.timeline.length - MAX_TIMELINE_ENTRIES;
  if (overflow <= 0) return;

  for (const entry of session.timeline.splice(0, overflow)) {
    if (entry.type === 'item' && session.itemEntries.get(entry.item.id) === entry) {
      session.itemEntries.delete(entry.item.id);
    }
  }
}

function restoreSession(raw, onChange) {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.id !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(raw.id)) return null;

  const createdAt = toTimestamp(raw.createdAt);
  const updatedAt = toTimestamp(raw.updatedAt) || createdAt;
  const timeline = [];
  const itemEntries = new Map();

  for (const entry of Array.isArray(raw.timeline) ? raw.timeline.slice(-MAX_TIMELINE_ENTRIES) : []) {
    const restored = restoreEntry(entry);
    if (!restored) continue;
    timeline.push(restored);
    if (restored.type === 'item') itemEntries.set(restored.item.id, restored);
  }

  return {
    id: raw.id,
    title: cleanString(raw.title, 80) || '会话',
    createdAt,
    updatedAt,
    status: 'idle',
    codexThreadId: cleanString(raw.codexThreadId, 128) || null,
    settings: sanitizeSettings(raw.settings),
    resolvedWorkingDirectory: cleanString(raw.resolvedWorkingDirectory, 4096) || null,
    thread: null,
    timeline,
    itemEntries,
    usage: raw.usage && typeof raw.usage === 'object' ? raw.usage : null,
    lastError: cleanString(raw.lastError, 4_000) || null,
    abortController: null,
    onChange,
  };
}

function restoreEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const createdAt = asIsoString(raw.createdAt);
  if (raw.type === 'user_message') {
    const text = cleanString(raw.text, MAX_MESSAGE_LENGTH);
    if (!text) return null;
    return { type: 'user_message', id: cleanString(raw.id, 160) || `user-${createdAt}`, text, createdAt };
  }
  if (raw.type === 'notice') {
    const text = cleanString(raw.text, 4_000);
    if (!text) return null;
    return {
      type: 'notice',
      id: cleanString(raw.id, 160) || `notice-${createdAt}`,
      level: raw.level === 'error' ? 'error' : '',
      text,
      createdAt,
    };
  }
  if (raw.type === 'item' && raw.item && typeof raw.item === 'object') {
    if (typeof raw.item.id !== 'string' || !raw.item.type) return null;
    return {
      type: 'item',
      id: cleanString(raw.id, 160) || raw.item.id,
      item: raw.item,
      createdAt,
      updatedAt: asIsoString(raw.updatedAt),
    };
  }
  return null;
}

function sanitizeSettings(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  return {
    workingDirectory: cleanString(input.workingDirectory, 4096) || '.',
    model: cleanString(input.model, 120) || '',
    reasoningEffort: REASONING_EFFORTS.has(input.reasoningEffort) ? input.reasoningEffort : 'high',
    sandboxMode: SANDBOX_MODES.has(input.sandboxMode) ? input.sandboxMode : 'workspace-write',
    webSearchMode: WEB_SEARCH_MODES.has(input.webSearchMode) ? input.webSearchMode : 'disabled',
    networkAccessEnabled: Boolean(input.networkAccessEnabled),
  };
}

function serializeSession(session) {
  return {
    id: session.id,
    title: session.title,
    createdAt: new Date(session.createdAt).toISOString(),
    updatedAt: new Date(session.updatedAt).toISOString(),
    codexThreadId: session.codexThreadId,
    settings: session.settings,
    resolvedWorkingDirectory: session.resolvedWorkingDirectory,
    usage: session.usage,
    lastError: session.lastError,
    timeline: session.timeline.slice(-MAX_TIMELINE_ENTRIES).map(serializeEntry).filter(Boolean),
  };
}

function serializeEntry(entry) {
  if (entry.type === 'user_message') {
    return {
      type: 'user_message',
      id: entry.id,
      text: truncate(entry.text, MAX_MESSAGE_LENGTH),
      createdAt: entry.createdAt,
    };
  }
  if (entry.type === 'notice') {
    return {
      type: 'notice',
      id: entry.id,
      level: entry.level || '',
      text: truncate(entry.text, 4_000),
      createdAt: entry.createdAt,
    };
  }
  if (entry.type === 'item' && entry.item) {
    const item = { ...entry.item };
    if (item.type === 'agent_message' || item.type === 'reasoning') {
      item.text = truncate(item.text, MAX_MESSAGE_LENGTH);
    } else if (item.type === 'command_execution') {
      item.command = truncate(item.command, 16_000);
      item.aggregated_output = truncate(item.aggregated_output, MAX_OUTPUT_LENGTH);
    } else if (item.type === 'mcp_tool_call' && item.result) {
      item.result = { truncated_text: safeJson(item.result, 32_000) };
    }
    return { type: 'item', id: entry.id, item, createdAt: entry.createdAt, updatedAt: entry.updatedAt };
  }
  return null;
}

function truncate(value, max) {
  if (typeof value !== 'string' || value.length <= max) return value;
  return `${value.slice(0, max)}\n… 已截断`;
}

function safeJson(value, max) {
  try {
    const text = JSON.stringify(value, null, 2);
    return truncate(text, max);
  } catch {
    return String(value);
  }
}

function cleanString(value, max) {
  return typeof value === 'string' ? truncate(value, max) : '';
}

function toTimestamp(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Date.now();
}

function asIsoString(value) {
  const timestamp = Date.parse(value);
  return new Date(Number.isFinite(timestamp) ? timestamp : Date.now()).toISOString();
}
