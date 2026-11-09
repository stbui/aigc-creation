/**
 * 后台跨页动作上下文。
 *
 * 高德地图式的「带参数跳过去」：来源页把目标实体、要执行的动作和返回地址
 * 编码进 URL，目标页打开对应抽屉/弹窗，完成后回到来源。只做导航与预填，
 * 不自动提交 —— 写操作仍由目标页的确认弹窗执行。
 *
 * `returnTo` 只接受站内 `/admin` 绝对路径，规则与 OAuth 的 returnTo 一致：
 * 不信任外部 origin，也不接受协议相对地址（`//evil.example`）。
 */

export type AdminActionIntent =
  | 'handle'
  | 'retry'
  | 'confirmRefund'
  | 'refund'
  | 'markPaid'
  | 'settle'
  | 'issue'
  | 'reject'
  | 'hide'
  | 'assign';

export interface AdminActionContext {
  intent: AdminActionIntent | null;
  from: string | null;
  returnTo: string | null;
}

const INTENTS: readonly AdminActionIntent[] = [
  'handle',
  'retry',
  'confirmRefund',
  'refund',
  'markPaid',
  'settle',
  'issue',
  'reject',
  'hide',
  'assign',
];

/** 只允许站内后台路径；长度上限防止把整页 URL 塞进参数 */
export function safeAdminReturnTo(value: string | null | undefined): string | null {
  if (!value) return null;
  const raw = value.trim();
  if (raw.length === 0 || raw.length > 512) return null;
  if (!raw.startsWith('/admin')) return null;
  if (raw.startsWith('//')) return null;
  if (/^\/admin[^/?#]/.test(raw) && raw !== '/admin') return null;
  return raw;
}

export function readAdminActionContext(params: URLSearchParams): AdminActionContext {
  const rawIntent = params.get('intent');
  const intent = INTENTS.includes(rawIntent as AdminActionIntent)
    ? (rawIntent as AdminActionIntent)
    : null;
  const from = params.get('from');
  return {
    intent,
    from: from && from.length <= 120 ? from : null,
    returnTo: safeAdminReturnTo(params.get('returnTo')),
  };
}

export function buildAdminContextLink({
  path,
  id,
  intent,
  from,
  returnTo,
  extra,
}: {
  path: string;
  id?: string | null;
  intent?: AdminActionIntent;
  from?: string | null;
  returnTo?: string | null;
  extra?: Record<string, string | undefined | null>;
}): string {
  const params = new URLSearchParams();
  if (id) params.set('id', id);
  if (intent) params.set('intent', intent);
  if (from) params.set('from', from);
  const safeReturn = safeAdminReturnTo(returnTo);
  if (safeReturn) params.set('returnTo', safeReturn);
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (value !== undefined && value !== null && value !== '') params.set(key, value);
  }
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

/** 在来源页标记「动作已完成」，只用于展示结果条，不参与权限判断 */
export function withAdminDone(path: string, done: string): string {
  const [base, query = ''] = path.split('?');
  const params = new URLSearchParams(query);
  params.set('done', done);
  return `${base}?${params.toString()}`;
}

export function readAdminDone(params: URLSearchParams): string | null {
  const done = params.get('done');
  return done && done.length <= 40 ? done : null;
}
