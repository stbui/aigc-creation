/**
 * 限时活动的纯函数入口 —— 目录内文件的唯一纯函数来源。
 *
 * 金额只在提交边界换算一次（元 → 分）；编辑回填后不再乘 100。
 */

import type { AdminCampaign, UpsertCampaignPayload } from '../../../types/api';
import { formatYuanPlain } from '../../../admin-ui/lib/format';
import type { FormState } from './constants';

/** 分 → 元（统一实现在 admin-ui/lib/format.ts） */
export const yuan = formatYuanPlain;

export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** payload 摘要：不同类型展示不同内容，统一抽象成一行可读描述 */
export function payloadSummary(c: AdminCampaign): string {
  const p = c.payload ?? {};
  if (c.type === 'limited_price') {
    return p.priceCents !== undefined ? `活动价 ¥${yuan(p.priceCents)}` : '未设置活动价';
  }
  if (c.type === 'limited_free') {
    const ids = p.capabilityIds ?? [];
    return ids.length ? `${ids.length} 项能力免费` : '未选择能力';
  }
  return p.title || '未设置标题';
}

/** 是否在时间窗内 —— active 但不在窗内是「配置了但没生效」，需要能看出来 */
export function inWindow(c: AdminCampaign): boolean {
  const now = Date.now();
  return now >= new Date(c.startAt).getTime() && now <= new Date(c.endAt).getTime();
}

export function emptyForm(): FormState {
  const now = new Date();
  const later = new Date(now.getTime() + 7 * 24 * 3600 * 1000);
  return {
    name: '',
    type: 'limited_price',
    startAt: toLocalInput(now.toISOString()),
    endAt: toLocalInput(later.toISOString()),
    startAtRaw: '',
    endAtRaw: '',
    status: 'draft',
    onlyNewUsers: false,
    productId: '',
    priceCents: '',
    capabilityIds: '',
    title: '',
    body: '',
    ctaText: '',
    ctaUrl: '',
  };
}

/**
 * 表单 → 提交体。校验失败返回文案，成功返回 payload。
 *
 * `payload` 随类型而变，只提交当前类型需要的字段 —— 混着提交会让后端拿到
 * 属于其它类型的字段，后续改动类型时残留数据会意外生效。
 */
export function buildCampaignPayload(form: FormState): UpsertCampaignPayload | string {
  const name = form.name.trim();
  if (!name) return '请填写活动名称';

  /*
   * datetime-local 只到分钟：编辑回填后若用户只改了名称，直接提交会把原有
   * 秒/毫秒抹成 00，限时活动的边界被悄悄挪动。未改动时间输入时沿用原始 ISO。
   */
  const rawStart = form.startAtRaw ? new Date(form.startAtRaw) : null;
  const rawEnd = form.endAtRaw ? new Date(form.endAtRaw) : null;
  const typedStart = new Date(form.startAt);
  const typedEnd = new Date(form.endAt);
  const start =
    rawStart && Number.isFinite(rawStart.getTime()) && form.startAt === toLocalInput(form.startAtRaw)
      ? rawStart
      : typedStart;
  const end =
    rawEnd && Number.isFinite(rawEnd.getTime()) && form.endAt === toLocalInput(form.endAtRaw)
      ? rawEnd
      : typedEnd;
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '时间格式非法';
  if (end <= start) return '结束时间必须晚于开始时间';

  const payload: UpsertCampaignPayload = {
    name,
    type: form.type,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    status: form.status,
    onlyNewUsers: form.onlyNewUsers,
    payload: {},
  };

  if (form.type === 'limited_price') {
    const cents = Math.round(Number(form.priceCents) * 100);
    if (!form.productId.trim()) return '请填写目标商品 ID';
    if (!Number.isFinite(cents) || cents < 0) return '活动价必须是非负数';
    payload.payload = { productId: form.productId.trim(), priceCents: cents };
  } else if (form.type === 'limited_free') {
    const ids = form.capabilityIds.split(',').map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0) return '请至少填写一项能力 ID';
    payload.payload = { capabilityIds: ids };
  } else {
    if (!form.title.trim()) return '请填写弹窗标题';
    // 站内相对路径：后端限定不接受外链，前端先拦一道给出更友好的提示。
    // `//evil.com` 虽以 / 开头，但浏览器会当协议相对地址跳站外，C 端会静默兜底成 /packages。
    const ctaUrl = form.ctaUrl.trim();
    if (ctaUrl && (!ctaUrl.startsWith('/') || ctaUrl.startsWith('//'))) {
      return '跳转地址必须是站内相对路径(以 / 开头，不接受 // 开头的站外地址)';
    }
    payload.payload = {
      title: form.title.trim(),
      body: form.body.trim(),
      ctaText: form.ctaText.trim(),
      ctaUrl,
    };
  }
  return payload;
}
