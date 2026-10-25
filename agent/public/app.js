const STORAGE_KEYS = {
  sessions: 'codex-web.sessions.v1',
  settings: 'codex-web.settings.v1',
  theme: 'codex-web.theme',
  token: 'codex-web.access-token',
};

const DEFAULT_SETTINGS = Object.freeze({
  workingDirectory: '.',
  model: '',
  reasoningEffort: 'high',
  sandboxMode: 'workspace-write',
  webSearchMode: 'disabled',
  networkAccessEnabled: false,
});

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
const THREAD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{5,127}$/;

const BENIGN_DIAGNOSTICS = [
  /^Codex is ignoring \d+ unrecognized configuration settings/i,
  /^Model metadata for .+ not found\. Defaulting to fallback metadata/i,
];

const ui = {
  sidebar: document.querySelector('#sidebar'),
  sidebarBackdrop: document.querySelector('#sidebarBackdrop'),
  menuButton: document.querySelector('#menuButton'),
  closeSidebarButton: document.querySelector('#closeSidebarButton'),
  sessionList: document.querySelector('#sessionList'),
  sessionCount: document.querySelector('#sessionCount'),
  newChatButton: document.querySelector('#newChatButton'),
  topNewChatButton: document.querySelector('#topNewChatButton'),
  topSettingsButton: document.querySelector('#topSettingsButton'),
  resumeButton: document.querySelector('#resumeButton'),
  settingsButton: document.querySelector('#settingsButton'),
  themeButton: document.querySelector('#themeButton'),
  themeLabel: document.querySelector('#themeLabel'),
  serverPill: document.querySelector('#serverPill'),
  serverState: document.querySelector('#serverState'),
  sessionTitle: document.querySelector('#sessionTitle'),
  sessionMeta: document.querySelector('#sessionMeta'),
  copyThreadButton: document.querySelector('#copyThreadButton'),
  messages: document.querySelector('#messages'),
  emptyState: document.querySelector('#emptyState'),
  emptyWorkspaceLabel: document.querySelector('#emptyWorkspaceLabel'),
  emptySandboxLabel: document.querySelector('#emptySandboxLabel'),
  emptyModelLabel: document.querySelector('#emptyModelLabel'),
  timeline: document.querySelector('#timeline'),
  errorBanner: document.querySelector('#errorBanner'),
  errorTitle: document.querySelector('#errorTitle'),
  errorMessage: document.querySelector('#errorMessage'),
  dismissErrorButton: document.querySelector('#dismissErrorButton'),
  composerForm: document.querySelector('#composerForm'),
  promptInput: document.querySelector('#promptInput'),
  composerContext: document.querySelector('#composerContext'),
  sendButton: document.querySelector('#sendButton'),
  stopButton: document.querySelector('#stopButton'),
  stopLabel: document.querySelector('#stopLabel'),
  settingsDialog: document.querySelector('#settingsDialog'),
  workspaceInput: document.querySelector('#workspaceInput'),
  workspaceHint: document.querySelector('#workspaceHint'),
  modelInput: document.querySelector('#modelInput'),
  reasoningSelect: document.querySelector('#reasoningSelect'),
  sandboxSelect: document.querySelector('#sandboxSelect'),
  dangerOption: document.querySelector('#dangerOption'),
  webSearchSelect: document.querySelector('#webSearchSelect'),
  networkCheckbox: document.querySelector('#networkCheckbox'),
  tokenInput: document.querySelector('#tokenInput'),
  saveSettingsButton: document.querySelector('#saveSettingsButton'),
  resumeDialog: document.querySelector('#resumeDialog'),
  resumeThreadInput: document.querySelector('#resumeThreadInput'),
  confirmResumeButton: document.querySelector('#confirmResumeButton'),
  toastRegion: document.querySelector('#toastRegion'),
};

const state = {
  config: {
    workspaceRoot: '',
    authRequired: false,
    allowDangerFullAccess: false,
    defaults: { ...DEFAULT_SETTINGS },
  },
  settings: loadSettings(),
  settingsCustomized: false,
  sessions: loadSessions(),
  current: null,
  controllers: new Map(),
  error: null,
  token: sessionStorage.getItem(STORAGE_KEYS.token) || '',
  unauthorizedNoticeShown: false,
  renderQueued: false,
  forceScroll: true,
  persistTimer: null,
  timelineViews: new Map(),
  timelineSessionKey: null,
};

state.settingsCustomized = hasStoredSettings();

class ApiError extends Error {
  constructor(status, message, payload) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

function loadSettings() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.settings) || 'null');
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_SETTINGS };
    return sanitizeSettings(parsed);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function hasStoredSettings() {
  try {
    return Boolean(JSON.parse(localStorage.getItem(STORAGE_KEYS.settings) || 'null'));
  } catch {
    return false;
  }
}

function sanitizeSettings(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  return {
    workingDirectory:
      typeof input.workingDirectory === 'string' && input.workingDirectory.trim()
        ? input.workingDirectory.trim()
        : '.',
    model: typeof input.model === 'string' ? input.model.trim().slice(0, 120) : '',
    reasoningEffort: REASONING_EFFORTS.has(input.reasoningEffort)
      ? input.reasoningEffort
      : DEFAULT_SETTINGS.reasoningEffort,
    sandboxMode: SANDBOX_MODES.has(input.sandboxMode)
      ? input.sandboxMode
      : DEFAULT_SETTINGS.sandboxMode,
    webSearchMode: WEB_SEARCH_MODES.has(input.webSearchMode)
      ? input.webSearchMode
      : DEFAULT_SETTINGS.webSearchMode,
    networkAccessEnabled: Boolean(input.networkAccessEnabled),
  };
}

function loadSessions() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.sessions) || '[]');
    if (!Array.isArray(parsed)) return [];
    const seen = new Set();
    const sessions = [];
    for (const raw of parsed.slice(0, 20)) {
      if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || seen.has(raw.id)) {
        continue;
      }
      seen.add(raw.id);
      sessions.push({
        id: raw.id,
        title: typeof raw.title === 'string' && raw.title ? raw.title.slice(0, 80) : '会话',
        codexThreadId:
          typeof raw.codexThreadId === 'string' && raw.codexThreadId ? raw.codexThreadId : null,
        createdAt: validDate(raw.createdAt),
        updatedAt: validDate(raw.updatedAt),
        status: 'idle',
        settings: sanitizeSettings(raw.settings),
        timeline: Array.isArray(raw.timeline)
          ? raw.timeline.filter((entry) => entry && typeof entry === 'object').slice(-120)
          : [],
        usage: raw.usage && typeof raw.usage === 'object' ? raw.usage : null,
        lastError: null,
        serverMissing: Boolean(raw.serverMissing),
      });
    }
    return sessions.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  } catch {
    return [];
  }
}

function validDate(value) {
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

function makeDraft(settings) {
  const now = new Date().toISOString();
  return {
    id: null,
    title: '新会话',
    codexThreadId: null,
    createdAt: now,
    updatedAt: now,
    status: 'idle',
    settings: { ...settings },
    timeline: [],
    usage: null,
    lastError: null,
    serverMissing: false,
  };
}

function newId(prefix = 'id') {
  const random = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
  return `${prefix}-${random}`;
}

function h(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function appendWithSeparators(parent, values) {
  values.filter(Boolean).forEach((value, index) => {
    if (index > 0) parent.append(h('span', 'sep'));
    parent.append(h('span', '', value));
  });
}

function sandboxLabel(mode) {
  if (mode === 'read-only') return '只读';
  if (mode === 'danger-full-access') return '完全访问';
  return '工作区写入';
}

function workspaceLabel(value) {
  const label = value || '.';
  return label === '.' ? '当前目录' : label;
}

function searchLabel(mode) {
  if (mode === 'live') return '实时搜索';
  if (mode === 'cached') return '缓存搜索';
  return '不联网搜索';
}

function formatRelativeTime(value) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '刚刚';
  const diff = Date.now() - timestamp;
  if (diff < 45_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return new Date(timestamp).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

function formatMessageTime(value) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '';
  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function createTime(value) {
  const label = formatMessageTime(value);
  if (!label) return null;
  const time = h('time', 'message-time', label);
  time.dateTime = new Date(value).toISOString();
  return time;
}

function formatUsage(usage) {
  if (!usage) return '';
  const input = Number(usage.input_tokens || 0);
  const output = Number(usage.output_tokens || 0);
  if (!input && !output) return '';
  const total = input + output;
  if (total >= 10_000) return `${(total / 1_000).toFixed(1)}k tokens`;
  return `${total} tokens`;
}

function shortThreadId(id) {
  if (!id) return '';
  return id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inlineMarkdown(value) {
  const inlineCodes = [];
  let text = escapeHtml(value).replace(/`([^`\n]+)`/g, (_, code) => {
    inlineCodes.push(code);
    return `\u0001IC${inlineCodes.length - 1}\u0001`;
  });

  text = text
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>',
    )
    .replace(/\u0001IC(\d+)\u0001/g, (_, index) => `<code>${inlineCodes[Number(index)]}</code>`);

  return text;
}

function codeBlockHtml(block) {
  const language = escapeHtml(block.lang || 'code');
  return `<div class="code-block"><div class="code-head"><span>${language}</span><button class="code-copy" type="button" data-copy="code">复制</button></div><pre><code>${escapeHtml(block.code)}</code></pre></div>`;
}

function isTableSeparator(line) {
  const cells = parseTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function parseTableRow(line) {
  let value = line.trim();
  if (value.startsWith('|')) value = value.slice(1);
  if (value.endsWith('|')) value = value.slice(0, -1);
  return value.split('|').map((cell) => cell.trim());
}

function isBlockStart(lines, index) {
  const line = lines[index];
  if (!line || !line.trim()) return true;
  if (/^```/.test(line) || /^@@CODEX_FENCE_\d+@@$/.test(line)) return true;
  if (/^#{1,4}\s+/.test(line)) return true;
  if (/^\s*(?:[-*+]|\d+[.)])\s+/.test(line)) return true;
  if (/^\s*>/.test(line)) return true;
  if (/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line)) return true;
  if (line.includes('|') && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
    return true;
  }
  return false;
}

function renderMarkdown(source) {
  const fences = [];
  let text = String(source || '').replace(/```([^\n`]*)\r?\n?([\s\S]*?)```/g, (_, lang, code) => {
    fences.push({ lang: lang.trim(), code: code.replace(/\r?\n$/, '') });
    return `\n@@CODEX_FENCE_${fences.length - 1}@@\n`;
  });

  const lines = text.split(/\r?\n/);
  const html = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fenceMatch = line.trim().match(/^@@CODEX_FENCE_(\d+)@@$/);
    if (fenceMatch) {
      html.push(codeBlockHtml(fences[Number(fenceMatch[1])]));
      index += 1;
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line)) {
      html.push('<hr>');
      index += 1;
      continue;
    }

    if (line.includes('|') && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
      const header = parseTableRow(line);
      index += 2;
      const rows = [];
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        rows.push(parseTableRow(lines[index]));
        index += 1;
      }
      const headHtml = header.map((cell) => `<th>${inlineMarkdown(cell)}</th>`).join('');
      const bodyHtml = rows
        .map(
          (row) =>
            `<tr>${header
              .map((_, cellIndex) => `<td>${inlineMarkdown(row[cellIndex] || '')}</td>`)
              .join('')}</tr>`,
        )
        .join('');
      html.push(`<table><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`);
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) {
        let item = lines[index].replace(/^\s*[-*+]\s+/, '');
        const task = item.match(/^\[([ xX])\]\s+(.*)$/);
        if (task) item = `${task[1].toLowerCase() === 'x' ? '☑' : '☐'} ${task[2]}`;
        items.push(`<li>${inlineMarkdown(item)}</li>`);
        index += 1;
      }
      html.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index])) {
        items.push(`<li>${inlineMarkdown(lines[index].replace(/^\s*\d+[.)]\s+/, ''))}</li>`);
        index += 1;
      }
      html.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    if (/^\s*>/.test(line)) {
      const quote = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) {
        quote.push(lines[index].replace(/^\s*>\s?/, ''));
        index += 1;
      }
      html.push(`<blockquote>${quote.map(inlineMarkdown).join('<br>')}</blockquote>`);
      continue;
    }

    const paragraph = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      (paragraph.length === 0 || !isBlockStart(lines, index))
    ) {
      paragraph.push(lines[index]);
      index += 1;
    }
    if (paragraph.length === 0) {
      paragraph.push(lines[index]);
      index += 1;
    }
    html.push(`<p>${paragraph.map(inlineMarkdown).join('<br>')}</p>`);
  }

  return html
    .join('')
    .replace(/@@CODEX_FENCE_(\d+)@@/g, (_, index) => codeBlockHtml(fences[Number(index)]));
}

const ICONS = {
  terminal:
    '<svg viewBox="0 0 24 24"><path d="m5 7 4 4-4 4M11 16h7"/></svg>',
  file:
    '<svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h4"/></svg>',
  search:
    '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></svg>',
  tool:
    '<svg viewBox="0 0 24 24"><path d="m14.5 6.5 3-3a4.2 4.2 0 0 1 0 6l-1.2 1.2a4.2 4.2 0 0 1-6 0"/><path d="m9.5 17.5-3 3a4.2 4.2 0 0 1 0-6l1.2-1.2a4.2 4.2 0 0 1 6 0"/><path d="m9 15 6-6"/></svg>',
  list:
    '<svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/></svg>',
  alert:
    '<svg viewBox="0 0 24 24"><path d="M12 4 3.5 20h17L12 4Z"/><path d="M12 9v5M12 17h.01"/></svg>',
  code:
    '<svg viewBox="0 0 24 24"><path d="m8 8-4 4 4 4M16 8l4 4-4 4M14 5l-4 14"/></svg>',
};

function assistantMark() {
  const mark = h('span', 'assistant-mark');
  mark.innerHTML =
    '<svg viewBox="0 0 24 24"><path d="M12 2.8 20 7.4v9.2L12 21.2 4 16.6V7.4L12 2.8Z"/><path d="m8.2 14.8 3-3.2-3-3.2M13.2 15.2h3.1"/></svg>';
  return mark;
}

function activityIcon(iconHtml) {
  const icon = h('span', 'activity-icon');
  icon.innerHTML = iconHtml;
  return icon;
}

function statusPill(status) {
  if (!status) return null;
  const labels = { in_progress: '运行中', completed: '完成', failed: '失败' };
  return h('span', `status-pill ${status}`, labels[status] || status);
}

function runningIndicator() {
  const indicator = h('span', 'running-indicator');
  indicator.append(h('span'), h('span'), h('span'));
  return indicator;
}

function createUserMessage(entry) {
  const article = h('article', 'timeline-entry message user');
  const stack = h('div', 'user-message-stack');
  const meta = h('div', 'user-message-meta');
  meta.append(h('span', '', '你'));
  const time = createTime(entry.createdAt);
  if (time) meta.append(time);
  stack.append(meta, h('div', 'bubble', entry.text));
  article.append(stack);
  return article;
}

function createAssistantMessage(entry, item) {
  const article = h('article', 'timeline-entry message assistant');
  const head = h('div', 'assistant-head');
  head.append(assistantMark(), h('span', 'assistant-name', 'Codex'));
  const time = createTime(entry.createdAt);
  if (time) head.append(time);
  const copy = h('button', 'card-copy', '复制');
  copy.type = 'button';
  copy.title = '复制回复';
  copy.dataset.copy = 'assistant';
  head.append(h('span', 'spacer'), copy);
  article.append(head);

  const bubble = h('div', 'bubble markdown');
  if (item.text) {
    bubble.innerHTML = renderMarkdown(item.text);
  } else {
    bubble.append(runningIndicator());
  }
  article.append(bubble);
  return article;
}

function createReasoning(entry, item) {
  const details = h('details', 'timeline-entry reasoning');
  const summary = h('summary', 'reasoning-summary');
  summary.append(activityIcon(ICONS.code), h('span', 'reasoning-label', '思考过程'));
  const time = createTime(entry.createdAt);
  if (time) summary.append(time);
  summary.append(h('span', 'reasoning-chevron', '⌄'));
  details.append(summary);
  const body = h('div', 'reasoning-body markdown');
  if (item.text) body.innerHTML = renderMarkdown(item.text);
  else body.append(runningIndicator());
  details.append(body);
  return details;
}

function createActivityCard({ icon, title, subtitle, status, body, copy, kind = 'tool' }) {
  const card = h('article', `timeline-entry activity-card${body?.length ? ' expanded' : ''}`);
  card.dataset.kind = kind;
  const head = h('div', 'activity-head');
  head.append(activityIcon(icon), h('span', 'activity-title', title));
  if (subtitle) head.append(h('span', 'activity-subtitle', subtitle));
  head.append(h('span', 'spacer'));
  if (copy) {
    const button = h('button', 'card-copy', '复制');
    button.type = 'button';
    button.title = copy === 'command' ? '复制命令' : '复制内容';
    button.dataset.copy = copy;
    head.append(button);
  }
  const pill = statusPill(status);
  if (pill) head.append(pill);
  card.append(head);

  if (body?.length) {
    const bodyNode = h('div', 'activity-body');
    for (const node of body) bodyNode.append(node);
    card.append(bodyNode);
  }
  return card;
}

function createCommandCard(item) {
  const body = [];
  const command = h('pre', 'command-text', item.command || '');
  body.push(command);

  if (item.aggregated_output) {
    body.push(h('div', 'output-label', '输出'));
    body.push(h('pre', '', item.aggregated_output));
  } else if (item.status === 'in_progress') {
    body.push(h('div', 'output-label', '等待输出…'));
  }

  const exit = Number.isFinite(item.exit_code) ? `exit ${item.exit_code}` : '';
  return createActivityCard({
    icon: ICONS.terminal,
    title: '终端命令',
    subtitle: exit,
    status: item.status,
    body,
    copy: 'command',
    kind: 'terminal',
  });
}

function createFileChangeCard(item) {
  const list = h('div', 'file-list');
  const kindLabels = { add: 'add', delete: 'del', update: 'mod' };
  for (const change of item.changes || []) {
    const row = h('div', 'file-row');
    row.append(
      h('span', `change-kind ${change.kind}`, kindLabels[change.kind] || change.kind),
      h('span', '', change.path),
    );
    list.append(row);
  }
  return createActivityCard({
    icon: ICONS.file,
    title: '文件变更',
    subtitle: `${item.changes?.length || 0} 个文件`,
    status: item.status,
    body: [list],
    kind: 'file',
  });
}

function safeJson(value, maxLength = 12_000) {
  try {
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength)}\n… 已截断`;
  } catch {
    return String(value);
  }
}

function createMcpCard(item) {
  const body = [h('pre', 'json-block', safeJson(item.arguments || {}))];
  if (item.result) {
    body.push(h('div', 'output-label', '结果'));
    body.push(h('pre', 'json-block', safeJson(item.result)));
  } else if (item.error) {
    body.push(h('div', 'output-label', '错误'));
    body.push(h('pre', 'json-block', item.error.message || safeJson(item.error)));
  } else if (item.status === 'in_progress') {
    body.push(h('div', 'output-label', '等待工具返回…'));
  }
  return createActivityCard({
    icon: ICONS.tool,
    title: `${item.server || 'MCP'} · ${item.tool || 'tool'}`,
    status: item.status,
    body,
    kind: 'mcp',
  });
}

function createWebSearchCard(item) {
  return createActivityCard({
    icon: ICONS.search,
    title: '网页搜索',
    subtitle: item.query,
    status: 'completed',
    body: [],
    kind: 'search',
  });
}

function createTodoCard(item) {
  const items = item.items || [];
  const done = items.filter((todo) => todo.completed).length;
  const progress = h('div', 'todo-progress');
  progress.setAttribute('role', 'progressbar');
  progress.setAttribute('aria-valuemin', '0');
  progress.setAttribute('aria-valuemax', String(items.length));
  progress.setAttribute('aria-valuenow', String(done));
  const progressFill = h('span');
  progressFill.style.width = items.length ? `${(done / items.length) * 100}%` : '0%';
  progress.append(progressFill);
  const list = h('ul', 'todo-list');
  for (const todo of items) {
    const row = h('li', `todo-item${todo.completed ? ' done' : ''}`);
    row.append(h('span', 'todo-check', '✓'), h('span', '', todo.text));
    list.append(row);
  }
  return createActivityCard({
    icon: ICONS.list,
    title: '任务清单',
    subtitle: `${done}/${items.length}`,
    status: items.length > 0 && done === items.length ? 'completed' : 'in_progress',
    body: [progress, list],
    kind: 'todo',
  });
}

function createUnknownItem(item) {
  return createActivityCard({
    icon: ICONS.tool,
    title: item.type || 'Codex 事件',
    body: [h('pre', 'json-block', safeJson(item))],
    kind: 'event',
  });
}

function isBenignDiagnostic(value) {
  if (typeof value !== 'string') return false;
  const firstLine = value.trim().split('\n', 1)[0];
  return BENIGN_DIAGNOSTICS.some((pattern) => pattern.test(firstLine));
}

function createItemEntry(entry) {
  const item = entry.item || {};
  switch (item.type) {
    case 'agent_message':
      return createAssistantMessage(entry, item);
    case 'reasoning':
      return createReasoning(entry, item);
    case 'command_execution':
      return createCommandCard(item);
    case 'file_change':
      return createFileChangeCard(item);
    case 'mcp_tool_call':
      return createMcpCard(item);
    case 'web_search':
      return createWebSearchCard(item);
    case 'todo_list':
      return createTodoCard(item);
    case 'error': {
      if (isBenignDiagnostic(item.message)) return null;
      const card = createActivityCard({
        icon: ICONS.alert,
        title: '执行错误',
        status: 'failed',
        body: [h('div', '', item.message || '未知错误')],
        kind: 'error',
      });
      card.classList.add('error-card');
      return card;
    }
    default:
      return createUnknownItem(item);
  }
}

function createNotice(entry) {
  const notice = h('div', `notice${entry.level === 'error' ? ' error' : ''}`);
  notice.append(h('span', 'notice-dot'), h('span', 'notice-text', entry.text || ''));
  return notice;
}

function timelineEntryKey(entry) {
  if (!entry || typeof entry !== 'object') return '';
  if (entry.type === 'item') return `item:${entry.item?.id || entry.id || ''}`;
  return entry.id ? `${entry.type}:${entry.id}` : '';
}

function timelineEntrySignature(entry) {
  if (entry.type !== 'item') {
    return `${entry.text || ''}|${entry.level || ''}`;
  }
  const item = entry.item || {};
  const todos = (item.items || []).map((todo) => (todo.completed ? '1' : '0')).join('');
  return [
    entry.updatedAt || entry.createdAt || '',
    item.type || '',
    item.status || '',
    (item.command || '').length,
    (item.text || '').length,
    (item.aggregated_output || '').length,
    item.exit_code ?? '',
    (item.changes || []).length,
    todos,
    item.result ? '1' : '',
    item.error?.message || '',
    item.query || '',
  ].join('|');
}

function createTimelineNode(entry) {
  if (entry.type === 'user_message') return createUserMessage(entry);
  if (entry.type === 'item') return createItemEntry(entry);
  if (entry.type === 'notice') return createNotice(entry);
  return null;
}

function commitTimelineViews(views) {
  const desired = new Set(views.map((view) => view.node));
  for (const node of [...ui.timeline.children]) {
    if (!desired.has(node)) node.remove();
  }

  for (let index = 0; index < views.length; index += 1) {
    const node = views[index].node;
    const previous = views[index - 1]?.node || null;
    const after = previous ? previous.nextSibling : ui.timeline.firstChild;
    if (node !== after) ui.timeline.insertBefore(node, after);
  }
}

function reconcileTimeline(entries, sessionKey) {
  const previous = state.timelineSessionKey === sessionKey
    ? state.timelineViews
    : new Map();
  const next = new Map();
  const views = [];
  const animateNew = state.timelineSessionKey === sessionKey ||
    (previous.size === 0 && entries.length <= 3);

  for (const entry of entries) {
    const key = timelineEntryKey(entry);
    if (!key) continue;
    const signature = timelineEntrySignature(entry);
    let view = previous.get(key);

    if (!view || view.signature !== signature) {
      const node = createTimelineNode(entry);
      if (!node) continue;
      if (view?.node.matches('details[open]') && node.matches('details')) node.open = true;
      view = { node, signature };
      if (!previous.has(key) && animateNew) {
        node.classList.add('is-new');
        setTimeout(() => node.classList.remove('is-new'), 360);
      }
    }

    view.node.dataset.timelineKey = key;
    next.set(key, view);
    views.push(view);
  }

  state.timelineViews = next;
  state.timelineSessionKey = sessionKey;
  commitTimelineViews(views);
  return views.length;
}

function renderTimeline() {
  const session = state.current;
  const entries = session?.timeline || [];
  const nearBottom =
    ui.messages.scrollHeight - ui.messages.scrollTop - ui.messages.clientHeight < 130;
  const sessionKey = session ? session.id || `draft:${session.createdAt}` : 'none';
  const count = reconcileTimeline(entries, sessionKey);

  ui.emptyState.hidden = count > 0;
  ui.timeline.hidden = count === 0;
  document.body.classList.toggle('has-messages', count > 0);

  if (state.forceScroll || nearBottom) {
    requestAnimationFrame(() => {
      ui.messages.scrollTop = ui.messages.scrollHeight;
      state.forceScroll = false;
    });
  }
}

function renderHeader() {
  const session = state.current;
  if (!session) return;
  const running = session.status === 'running' || session.status === 'stopping';
  ui.sessionTitle.textContent = session.title || '新会话';

  const parts = [];
  if (running) parts.push({ text: '运行中', kind: 'status' });
  parts.push(
    { text: workspaceLabel(session.settings.workingDirectory), kind: 'workspace' },
    { text: sandboxLabel(session.settings.sandboxMode), kind: 'sandbox' },
    { text: session.settings.model || 'Codex 默认模型', kind: 'model' },
  );
  const usage = formatUsage(session.usage);
  if (usage) parts.push({ text: usage, kind: 'usage' });
  ui.sessionMeta.replaceChildren();
  parts.forEach((part, index) => {
    if (index > 0) ui.sessionMeta.append(h('span', `sep sep-${part.kind}`));
    ui.sessionMeta.append(h('span', `meta-${part.kind}`, part.text));
  });

  ui.copyThreadButton.hidden = !session.codexThreadId;
  ui.copyThreadButton.title = session.codexThreadId
    ? `复制线程 ID：${session.codexThreadId}`
    : '复制线程 ID';
}

function renderComposerContext() {
  const session = state.current;
  if (!session) return;
  ui.composerContext.replaceChildren();
  appendWithSeparators(ui.composerContext, [
    workspaceLabel(session.settings.workingDirectory),
    sandboxLabel(session.settings.sandboxMode),
    session.settings.webSearchMode === 'disabled'
      ? ''
      : searchLabel(session.settings.webSearchMode),
    session.settings.networkAccessEnabled ? '命令联网' : '',
  ]);
}

function renderEmptyContext() {
  const session = state.current;
  if (!session) return;
  const workspace = workspaceLabel(session.settings.workingDirectory);
  const sandbox = sandboxLabel(session.settings.sandboxMode);
  const model = session.settings.model || 'Codex 默认模型';

  ui.emptyWorkspaceLabel.textContent = workspace;
  ui.emptySandboxLabel.textContent = sandbox;
  ui.emptyModelLabel.textContent = model;
  ui.emptyWorkspaceLabel.parentElement.title = `工作目录：${workspace} · 点击修改`;
  ui.emptySandboxLabel.parentElement.title = `沙箱：${sandbox} · 点击修改`;
  ui.emptyModelLabel.parentElement.title = `模型：${model} · 点击修改`;
}

function renderComposerState() {
  const session = state.current;
  const running = session?.status === 'running' || session?.status === 'stopping';
  const stopping = session?.status === 'stopping';
  const hasText = Boolean(ui.promptInput.value.trim());
  ui.stopButton.hidden = !running;
  ui.sendButton.hidden = running;
  ui.sendButton.disabled = !hasText || running;
  ui.stopButton.disabled = stopping;
  ui.stopLabel.textContent = stopping ? '停止中…' : '停止';
}

function renderSessions() {
  const sessions = [...state.sessions].sort(
    (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
  );
  ui.sessionCount.textContent = String(sessions.length);
  ui.sessionList.replaceChildren();

  if (sessions.length === 0) {
    ui.sessionList.append(h('div', 'session-empty', '还没有会话，先给 Codex 一个任务。'));
    return;
  }

  for (const session of sessions) {
    const item = h('div', 'session-item', undefined);
    item.dataset.sessionId = session.id;
    item.tabIndex = 0;
    item.setAttribute('role', 'button');
    if (state.current?.id === session.id) item.classList.add('active');

    item.append(h('span', 'session-item-title', session.title || '会话'));
    const sub = h('span', 'session-item-sub');
    const dot = h(
      'span',
      `session-item-dot${session.status === 'running' ? ' running' : ''}`,
    );
    const statusText = session.status === 'running' ? '运行中 · ' : '';
    sub.append(dot, h('span', '', `${statusText}${formatRelativeTime(session.updatedAt)}`));
    item.append(sub);

    const deleteButton = h('button', 'session-delete');
    deleteButton.type = 'button';
    deleteButton.dataset.deleteSession = session.id;
    deleteButton.setAttribute('aria-label', `删除会话 ${session.title || ''}`);
    deleteButton.innerHTML =
      '<svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg>';
    item.append(deleteButton);
    ui.sessionList.append(item);
  }
}

function renderErrorBanner() {
  if (!state.error) {
    ui.errorBanner.hidden = true;
    return;
  }
  ui.errorBanner.hidden = false;
  ui.errorTitle.textContent = state.error.title || '请求失败';
  ui.errorMessage.textContent = [state.error.message, state.error.hint]
    .filter(Boolean)
    .join('\n');
}

function render() {
  renderHeader();
  renderSessions();
  renderTimeline();
  renderEmptyContext();
  renderComposerContext();
  renderComposerState();
  renderErrorBanner();
}

function scheduleRender() {
  if (state.renderQueued) return;
  state.renderQueued = true;
  requestAnimationFrame(() => {
    state.renderQueued = false;
    render();
  });
}

function showError(title, message, hint = '') {
  state.error = { title, message, hint };
  renderErrorBanner();
}

function clearError() {
  state.error = null;
  renderErrorBanner();
}

function toast(message, type = '') {
  const node = h('div', `toast${type ? ` ${type}` : ''}`, message);
  ui.toastRegion.append(node);
  setTimeout(() => {
    node.classList.add('leaving');
    setTimeout(() => node.remove(), 200);
  }, 2_600);
}

function handleUnauthorized() {
  if (state.unauthorizedNoticeShown) return;
  state.unauthorizedNoticeShown = true;
  showError('需要访问令牌', '服务端启用了 AGENT_ACCESS_TOKEN，请在设置中填写。');
  openSettingsDialog();
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (state.token) headers.set('Authorization', `Bearer ${state.token}`);
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(path, { ...options, headers, cache: 'no-store' });
  if (!response.ok) {
    const payload = await readErrorPayload(response);
    if (response.status === 401) handleUnauthorized();
    throw new ApiError(response.status, payload?.error || `请求失败 (${response.status})`, payload);
  }
  if (response.status === 204) return null;
  return response.json();
}

async function readErrorPayload(response) {
  const text = await response.text().catch(() => '');
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { error: text.slice(0, 500) };
  }
}

function authHeaders(extra = {}) {
  const headers = new Headers(extra);
  if (state.token) headers.set('Authorization', `Bearer ${state.token}`);
  return headers;
}

async function readSse(response, onMessage) {
  if (!response.body) throw new Error('服务端没有返回事件流');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const consumeBlock = (block) => {
    const data = block
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!data) return;
    try {
      onMessage(JSON.parse(data));
    } catch (error) {
      console.warn('[codex-web] invalid SSE payload', error);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      consumeBlock(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf('\n\n');
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) consumeBlock(buffer);
}

function applyServerSession(session, serverSession) {
  if (!serverSession || typeof serverSession !== 'object') return;
  if (serverSession.title && serverSession.title !== '新会话') session.title = serverSession.title;
  if (serverSession.codexThreadId) session.codexThreadId = serverSession.codexThreadId;
  if (serverSession.status) session.status = serverSession.status;
  if (serverSession.settings) session.settings = sanitizeSettings(serverSession.settings);
  if (serverSession.usage) session.usage = serverSession.usage;
  if (serverSession.lastError) session.lastError = serverSession.lastError;
  if (serverSession.updatedAt) session.updatedAt = validDate(serverSession.updatedAt);
}

function upsertClientItem(session, item) {
  if (!item || typeof item !== 'object' || !item.id) return;
  let entry = session.timeline.find(
    (candidate) => candidate.type === 'item' && candidate.item?.id === item.id,
  );
  if (!entry) {
    entry = {
      type: 'item',
      id: item.id,
      item,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    session.timeline.push(entry);
  } else {
    entry.item = item;
    entry.updatedAt = new Date().toISOString();
  }
  session.updatedAt = new Date().toISOString();
}

function addNotice(session, text, level = '') {
  const last = session.timeline[session.timeline.length - 1];
  if (last?.type === 'notice' && last.text === text && last.level === level) return;
  session.timeline.push({
    type: 'notice',
    id: newId('notice'),
    text,
    level,
    createdAt: new Date().toISOString(),
  });
}

function handleCodexEvent(session, event) {
  if (!event || typeof event.type !== 'string') return;
  switch (event.type) {
    case 'thread.started':
      if (event.thread_id) session.codexThreadId = event.thread_id;
      break;
    case 'item.started':
    case 'item.updated':
    case 'item.completed':
      upsertClientItem(session, event.item);
      break;
    case 'turn.completed':
      if (event.usage) session.usage = event.usage;
      break;
    case 'turn.failed':
      session.lastError = event.error?.message || 'Codex 任务失败';
      showError('任务失败', session.lastError);
      break;
    case 'error':
      session.lastError = event.message || 'Codex 返回错误';
      showError('Codex 执行失败', session.lastError);
      break;
    default:
      break;
  }
}

function handleServerMessage(session, message) {
  if (!message || typeof message.type !== 'string') return;
  if (message.type === 'session') {
    applyServerSession(session, message.session);
  } else if (message.type === 'event') {
    handleCodexEvent(session, message.event);
  } else if (message.type === 'done') {
    applyServerSession(session, message.session);
    session.status = 'idle';
  } else if (message.type === 'aborted') {
    applyServerSession(session, message.session);
    session.status = 'idle';
    addNotice(session, '任务已停止');
  } else if (message.type === 'error') {
    session.lastError = message.message || 'Codex 执行失败';
    showError('Codex 执行失败', session.lastError, message.hint || '');
  }
  scheduleRender();
  persistSoon();
}

async function openTurnStream(session, prompt, messageId, controller) {
  const response = await fetch(`/api/sessions/${encodeURIComponent(session.id)}/turns`, {
    method: 'POST',
    headers: authHeaders({
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    }),
    body: JSON.stringify({ prompt, messageId }),
    signal: controller.signal,
    cache: 'no-store',
  });

  if (!response.ok) {
    const payload = await readErrorPayload(response);
    if (response.status === 401) handleUnauthorized();
    throw new ApiError(response.status, payload?.error || `请求失败 (${response.status})`, payload);
  }

  await readSse(response, (message) => handleServerMessage(session, message));
}

async function ensureServerSession(session) {
  if (session.id && !session.serverMissing) return;

  const payload = { settings: session.settings };
  if (session.codexThreadId) payload.resumeThreadId = session.codexThreadId;

  const data = await api('/api/sessions', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  session.id = data.session.id;
  session.serverMissing = false;
  session.codexThreadId = data.session.codexThreadId || session.codexThreadId;
  applyServerSession(session, data.session);
  if (!state.sessions.includes(session)) state.sessions.unshift(session);
  persistSoon();
}

async function streamWithRecovery(session, prompt, messageId, controller) {
  try {
    await openTurnStream(session, prompt, messageId, controller);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404 && !controller.signal.aborted) {
      session.serverMissing = true;
      await ensureServerSession(session);
      await openTurnStream(session, prompt, messageId, controller);
      return;
    }
    throw error;
  }
}

async function sendPrompt(rawPrompt) {
  const session = state.current;
  const prompt = String(rawPrompt || '').trim();
  if (!session || !prompt) return;
  if (session.status === 'running' || session.status === 'stopping') {
    toast('当前任务还在运行，请先停止。', 'error');
    return;
  }

  clearError();
  let userEntryAdded = false;
  const messageId = newId('message');

  try {
    await ensureServerSession(session);

    session.timeline.push({
      type: 'user_message',
      id: messageId,
      text: prompt,
      createdAt: new Date().toISOString(),
    });
    userEntryAdded = true;
    session.status = 'running';
    session.lastError = null;
    session.usage = null;
    session.updatedAt = new Date().toISOString();
    state.forceScroll = true;
    persistSoon();
    render();

    const controller = new AbortController();
    state.controllers.set(session, controller);
    await streamWithRecovery(session, prompt, messageId, controller);
  } catch (error) {
    if (error?.name === 'AbortError') {
      addNotice(session, '任务已停止');
    } else if (error instanceof ApiError && error.status === 401) {
      handleUnauthorized();
    } else {
      const message = error instanceof Error ? error.message : String(error);
      showError('无法执行任务', message);
      addNotice(session, `执行失败：${message.split('\n')[0]}`, 'error');
      if (!userEntryAdded) {
        ui.promptInput.value = prompt;
        resizePrompt();
      }
    }
  } finally {
    state.controllers.delete(session);
    if (session.status === 'running' || session.status === 'stopping') session.status = 'idle';
    session.updatedAt = new Date().toISOString();
    persistSoon();
    scheduleRender();
  }
}

async function stopCurrent() {
  const session = state.current;
  if (!session || session.status !== 'running') return;
  session.status = 'stopping';
  render();

  const controller = state.controllers.get(session);
  if (controller) {
    controller.abort();
    return;
  }
  if (session.id) {
    try {
      await api(`/api/sessions/${encodeURIComponent(session.id)}/cancel`, { method: 'POST' });
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 404)) {
        showError('停止失败', error instanceof Error ? error.message : String(error));
      }
    }
    session.status = 'idle';
    scheduleRender();
  }
}

function mergeTimelines(local, server) {
  const merged = new Map();
  const keyOf = (entry) => {
    if (entry.type === 'item') return `item:${entry.item?.id || entry.id}`;
    return `${entry.type}:${entry.id}`;
  };
  for (const entry of local || []) merged.set(keyOf(entry), entry);
  for (const entry of server || []) merged.set(keyOf(entry), entry);
  return [...merged.values()].sort((a, b) => {
    const aTime = Date.parse(a.createdAt || 0);
    const bTime = Date.parse(b.createdAt || 0);
    return (Number.isFinite(aTime) ? aTime : 0) - (Number.isFinite(bTime) ? bTime : 0);
  });
}

async function refreshSession(session) {
  if (!session?.id) return;
  try {
    const data = await api(`/api/sessions/${encodeURIComponent(session.id)}`);
    applyServerSession(session, data.session);
    session.timeline = mergeTimelines(session.timeline, data.timeline);
    session.serverMissing = false;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      session.serverMissing = true;
    } else if (!(error instanceof ApiError && error.status === 401)) {
      showError('读取会话失败', error instanceof Error ? error.message : String(error));
    }
  }
  persistSoon();
  scheduleRender();
}

async function selectSession(session) {
  if (!session) return;
  if (state.current === session) {
    closeSidebar();
    return;
  }
  state.current = session;
  clearError();
  state.forceScroll = true;
  render();
  closeSidebar();
  if (session.id) await refreshSession(session);
}

function newChat() {
  if (state.current && !state.current.id && state.current.timeline.length === 0) {
    closeSidebar();
    focusPrompt();
    return;
  }
  state.current = makeDraft(state.settings);
  clearError();
  state.forceScroll = true;
  render();
  closeSidebar();
  focusPrompt();
}

async function deleteSession(session) {
  if (!session) return;
  if (!window.confirm(`删除会话“${session.title || '未命名'}”？本地记录会一并移除。`)) return;

  state.sessions = state.sessions.filter((candidate) => candidate !== session);
  const controller = state.controllers.get(session);
  if (controller) controller.abort();
  if (session.id) {
    try {
      await api(`/api/sessions/${encodeURIComponent(session.id)}`, { method: 'DELETE' });
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 404)) {
        console.warn('[codex-web] failed to delete server session', error);
      }
    }
  }
  if (state.current === session) state.current = makeDraft(state.settings);
  persistSoon();
  render();
  toast('会话已删除');
}

function persistSoon() {
  if (state.persistTimer) return;
  state.persistTimer = setTimeout(() => {
    state.persistTimer = null;
    persistSessions();
  }, 280);
}

function persistSessions() {
  const serialized = state.sessions.slice(0, 20).map((session) => ({
    id: session.id,
    title: session.title,
    codexThreadId: session.codexThreadId,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    status: 'idle',
    settings: session.settings,
    usage: session.usage,
    serverMissing: Boolean(session.serverMissing),
    timeline: (session.timeline || []).slice(-120).map(serializeEntry),
  }));
  try {
    localStorage.setItem(STORAGE_KEYS.sessions, JSON.stringify(serialized));
  } catch (error) {
    console.warn('[codex-web] failed to persist sessions', error);
  }
}

function serializeEntry(entry) {
  let copy;
  try {
    copy = JSON.parse(JSON.stringify(entry));
  } catch {
    return null;
  }
  if (!copy || typeof copy !== 'object') return null;
  if (copy.type === 'user_message') copy.text = truncate(copy.text, 40_000);
  if (copy.type === 'notice') copy.text = truncate(copy.text, 2_000);
  if (copy.type === 'item' && copy.item) {
    if (copy.item.type === 'agent_message' || copy.item.type === 'reasoning') {
      copy.item.text = truncate(copy.item.text, 40_000);
    }
    if (copy.item.type === 'command_execution') {
      copy.item.command = truncate(copy.item.command, 8_000);
      copy.item.aggregated_output = truncate(copy.item.aggregated_output, 16_000);
    }
    if (copy.item.type === 'mcp_tool_call' && copy.item.result) {
      const resultText = safeJson(copy.item.result, 10_000);
      copy.item.result = { truncated_text: resultText };
    }
  }
  return copy;
}

function truncate(value, max) {
  if (typeof value !== 'string' || value.length <= max) return value;
  return `${value.slice(0, max)}\n… 已截断`;
}

function saveSettingsFromDialog() {
  let sandboxMode = ui.sandboxSelect.value;
  if (sandboxMode === 'danger-full-access' && !state.config.allowDangerFullAccess) {
    sandboxMode = 'workspace-write';
  }
  state.settings = sanitizeSettings({
    workingDirectory: ui.workspaceInput.value,
    model: ui.modelInput.value,
    reasoningEffort: ui.reasoningSelect.value,
    sandboxMode,
    webSearchMode: ui.webSearchSelect.value,
    networkAccessEnabled: ui.networkCheckbox.checked,
  });
  state.settingsCustomized = true;
  try {
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(state.settings));
  } catch {
    // Storage can be unavailable in private modes; the in-memory setting still works.
  }

  state.token = ui.tokenInput.value.trim();
  if (state.token) sessionStorage.setItem(STORAGE_KEYS.token, state.token);
  else sessionStorage.removeItem(STORAGE_KEYS.token);
  state.unauthorizedNoticeShown = false;

  if (state.current && !state.current.id && state.current.timeline.length === 0) {
    state.current.settings = { ...state.settings };
  }

  closeDialog(ui.settingsDialog);
  clearError();
  toast('设置已保存，将用于新会话');
  render();

  if (!state.config.workspaceRoot) {
    refreshConfig().catch(() => {});
  }
}

function openSettingsDialog() {
  ui.workspaceInput.value = state.settings.workingDirectory || '.';
  ui.modelInput.value = state.settings.model || '';
  ui.reasoningSelect.value = REASONING_EFFORTS.has(state.settings.reasoningEffort)
    ? state.settings.reasoningEffort
    : 'high';
  ui.dangerOption.hidden = !state.config.allowDangerFullAccess;
  ui.sandboxSelect.value =
    state.settings.sandboxMode === 'danger-full-access' && !state.config.allowDangerFullAccess
      ? 'workspace-write'
      : state.settings.sandboxMode;
  ui.webSearchSelect.value = WEB_SEARCH_MODES.has(state.settings.webSearchMode)
    ? state.settings.webSearchMode
    : 'disabled';
  ui.networkCheckbox.checked = Boolean(state.settings.networkAccessEnabled);
  ui.tokenInput.value = state.token;
  ui.workspaceHint.textContent = state.config.workspaceRoot
    ? `根目录：${state.config.workspaceRoot}`
    : '相对于允许的根目录，也可以填写根目录内的绝对路径。';
  openDialog(ui.settingsDialog);
}

function openResumeDialog() {
  ui.resumeThreadInput.value = '';
  openDialog(ui.resumeDialog);
  requestAnimationFrame(() => ui.resumeThreadInput.focus());
}

async function resumeThread() {
  const threadId = ui.resumeThreadInput.value.trim();
  if (!THREAD_ID_PATTERN.test(threadId)) {
    toast('线程 ID 格式不正确', 'error');
    return;
  }
  ui.confirmResumeButton.disabled = true;
  try {
    const data = await api('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ resumeThreadId: threadId, settings: state.settings }),
    });
    const session = {
      ...makeDraft(data.session.settings || state.settings),
      id: data.session.id,
      title: data.session.title || '恢复的会话',
      codexThreadId: data.session.codexThreadId || threadId,
      createdAt: validDate(data.session.createdAt),
      updatedAt: validDate(data.session.updatedAt),
      usage: data.session.usage || null,
      serverMissing: false,
    };
    state.sessions.unshift(session);
    state.current = session;
    clearError();
    closeDialog(ui.resumeDialog);
    state.forceScroll = true;
    persistSoon();
    render();
    toast('已恢复 Codex 线程');
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 401)) {
      toast(error instanceof Error ? error.message : String(error), 'error');
    }
  } finally {
    ui.confirmResumeButton.disabled = false;
  }
}

function openDialog(dialog) {
  if (!dialog.open) dialog.showModal();
}

function closeDialog(dialog) {
  if (dialog.open) dialog.close();
}

function openSidebar() {
  document.body.classList.add('sidebar-open');
}

function closeSidebar() {
  document.body.classList.remove('sidebar-open');
}

function focusPrompt() {
  requestAnimationFrame(() => ui.promptInput.focus());
}

function resizePrompt() {
  ui.promptInput.rows = 1;
  const rows = Math.min(8, Math.max(1, Math.ceil((ui.promptInput.scrollHeight - 22) / 22)));
  ui.promptInput.rows = rows;
}

function applyTheme(theme) {
  const resolved = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = resolved;
  localStorage.setItem(STORAGE_KEYS.theme, resolved);
  ui.themeLabel.textContent = resolved === 'dark' ? '切换浅色' : '切换深色';
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta) themeMeta.content = resolved === 'dark' ? '#0b0d10' : '#f5f7f8';
}

function toggleTheme() {
  const current = document.documentElement.dataset.theme;
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

async function copyText(text) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    toast('已复制');
  } catch {
    const helper = document.createElement('textarea');
    helper.className = 'clipboard-helper';
    helper.value = text;
    helper.setAttribute('readonly', '');
    document.body.append(helper);
    helper.select();
    document.execCommand('copy');
    helper.remove();
    toast('已复制');
  }
}

async function pingServer() {
  try {
    const response = await fetch('/api/health', { cache: 'no-store' });
    if (!response.ok) throw new Error(`health ${response.status}`);
    const data = await response.json();
    ui.serverPill.classList.add('online');
    ui.serverPill.classList.remove('offline');
    ui.serverState.textContent = `本地服务在线 · v${data.version}`;

    if (data.authRequired && !state.token) {
      showError(
        '需要访问令牌',
        '服务端启用了 AGENT_ACCESS_TOKEN。请在设置中填写令牌后继续。',
      );
      openSettingsDialog();
      return false;
    }
    await refreshConfig();
    return true;
  } catch (error) {
    ui.serverPill.classList.remove('online');
    ui.serverPill.classList.add('offline');
    ui.serverState.textContent = '本地服务未连接';
    showError('无法连接本地服务', '请确认 npm start 正在运行。', '如果设置在非本机地址，请检查 HOST 与访问令牌。');
    console.warn('[codex-web] health check failed', error);
    return false;
  }
}

async function refreshConfig() {
  try {
    const config = await api('/api/config');
    state.config = {
      workspaceRoot: config.workspaceRoot || '',
      authRequired: Boolean(config.authRequired),
      allowDangerFullAccess: Boolean(config.allowDangerFullAccess),
      defaults: { ...DEFAULT_SETTINGS, ...(config.defaults || {}) },
    };

    if (!state.settingsCustomized) {
      state.settings = sanitizeSettings(state.config.defaults);
      if (state.current && !state.current.id && state.current.timeline.length === 0) {
        state.current.settings = { ...state.settings };
      }
    }
    if (state.settings.sandboxMode === 'danger-full-access' && !config.allowDangerFullAccess) {
      state.settings = { ...state.settings, sandboxMode: 'workspace-write' };
    }
    ui.workspaceHint.textContent = state.config.workspaceRoot
      ? `根目录：${state.config.workspaceRoot}`
      : '相对于允许的根目录，也可以填写根目录内的绝对路径。';
    scheduleRender();
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 401)) {
      showError('读取服务端配置失败', error instanceof Error ? error.message : String(error));
    }
  }
}

function bindEvents() {
  ui.newChatButton.addEventListener('click', newChat);
  ui.topNewChatButton.addEventListener('click', newChat);
  ui.resumeButton.addEventListener('click', openResumeDialog);
  ui.themeButton.addEventListener('click', toggleTheme);
  ui.menuButton.addEventListener('click', openSidebar);
  ui.closeSidebarButton.addEventListener('click', closeSidebar);
  ui.sidebarBackdrop.addEventListener('click', closeSidebar);

  ui.sessionList.addEventListener('click', (event) => {
    const deleteButton = event.target.closest('[data-delete-session]');
    if (deleteButton) {
      event.stopPropagation();
      const session = state.sessions.find(
        (candidate) => candidate.id === deleteButton.dataset.deleteSession,
      );
      deleteSession(session);
      return;
    }
    const item = event.target.closest('[data-session-id]');
    if (!item) return;
    const session = state.sessions.find((candidate) => candidate.id === item.dataset.sessionId);
    selectSession(session);
  });
  ui.sessionList.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const item = event.target.closest('[data-session-id]');
    if (!item || event.target.closest('[data-delete-session]')) return;
    event.preventDefault();
    selectSession(state.sessions.find((candidate) => candidate.id === item.dataset.sessionId));
  });

  ui.composerForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = ui.promptInput.value;
    if (!text.trim()) return;
    ui.promptInput.value = '';
    resizePrompt();
    renderComposerState();
    sendPrompt(text);
  });

  ui.promptInput.addEventListener('input', () => {
    resizePrompt();
    renderComposerState();
  });
  ui.promptInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      ui.composerForm.requestSubmit();
    }
  });
  ui.stopButton.addEventListener('click', stopCurrent);
  ui.dismissErrorButton.addEventListener('click', clearError);

  document.addEventListener('click', (event) => {
    const settingsTrigger = event.target.closest('[data-open-settings]');
    if (settingsTrigger) {
      event.preventDefault();
      closeSidebar();
      openSettingsDialog();
      return;
    }
    const suggestion = event.target.closest('[data-prompt]');
    if (suggestion) {
      sendPrompt(suggestion.dataset.prompt);
    }
  });

  ui.timeline.addEventListener('click', (event) => {
    const copyButton = event.target.closest('[data-copy]');
    if (!copyButton) return;
    if (copyButton.dataset.copy === 'code') {
      const code = copyButton.closest('.code-block')?.querySelector('code')?.textContent || '';
      copyText(code);
    } else if (copyButton.dataset.copy === 'command') {
      const command = copyButton.closest('.activity-card')?.querySelector('.command-text');
      copyText(command?.textContent || '');
    } else if (copyButton.dataset.copy === 'assistant') {
      const bubble = copyButton.closest('.message.assistant')?.querySelector('.bubble');
      copyText(bubble?.textContent || '');
    }
  });

  ui.copyThreadButton.addEventListener('click', () => {
    copyText(state.current?.codexThreadId || '');
  });

  ui.saveSettingsButton.addEventListener('click', saveSettingsFromDialog);
  ui.confirmResumeButton.addEventListener('click', resumeThread);
  ui.resumeThreadInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      resumeThread();
    }
  });

  for (const button of document.querySelectorAll('[data-close-dialog]')) {
    button.addEventListener('click', () => {
      const dialog = document.querySelector(`#${button.dataset.closeDialog}`);
      if (dialog) closeDialog(dialog);
    });
  }
  for (const dialog of [ui.settingsDialog, ui.resumeDialog]) {
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) closeDialog(dialog);
    });
  }

  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') {
      event.preventDefault();
      newChat();
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      focusPrompt();
    }
    if (event.key === 'Escape') closeSidebar();
  });
}

function init() {
  applyTheme(localStorage.getItem(STORAGE_KEYS.theme) || 'dark');
  bindEvents();

  const sorted = [...state.sessions].sort(
    (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
  );
  state.current = sorted[0] || makeDraft(state.settings);
  render();
  resizePrompt();
  focusPrompt();

  pingServer()
    .then((online) => {
      if (online && state.current?.id) refreshSession(state.current);
    })
    .catch(() => {});
}

init();
