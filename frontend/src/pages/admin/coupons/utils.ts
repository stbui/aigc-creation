/**
 * 优惠券的纯函数与外部工具入口 —— 目录内文件的唯一外部工具来源。
 */

import type { AdminCoupon, CouponType, UpsertCouponPayload } from '../../../types/api';
import type { FormState } from './constants';

/** 分 → 元 */
export const yuan = (cents: number) => (cents / 100).toFixed(2);

/** 面额展示：语义随类型而变，不统一按元显示 */
export function faceValue(c: { type: CouponType; value: number }): string {
  if (c.type === 'discount') {
    // 万分比 → 折数: 8500 → 8.5折
    const zhe = (c.value / 1000).toFixed(2).replace(/\.?0+$/, '');
    return `${zhe} 折`;
  }
  return `¥${yuan(c.value)}`;
}

/** 时间格式化为 datetime-local 需要的格式 */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function emptyForm(): FormState {
  const now = new Date();
  const later = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
  return {
    code: '',
    name: '',
    type: 'full_cut',
    value: '',
    threshold: '0',
    scope: 'all',
    totalCount: '0',
    perUserLimit: '1',
    validFrom: toLocalInput(now.toISOString()),
    validTo: toLocalInput(later.toISOString()),
    status: 'on',
  };
}

/** 表单 → payload，附带语义校验；返回字符串表示校验未通过 */
export function buildCouponPayload(
  form: FormState,
  editing: AdminCoupon | null,
): UpsertCouponPayload | string {
  const name = form.name.trim();
  if (!name) return '请填写券名称';

  // ⚠ value 的单位是**分**，与 thresholdCents 一致（后端直接拿两者比较，
  // 传元会让「满 100 减 200」这类负价校验失效）。用户在 UI 上输入的是元，
  // 这里负责换算。
  const raw = Number(form.value);
  if (!Number.isFinite(raw)) return '面额必须是数字';

  let value: number;
  if (form.type === 'discount') {
    // 折扣的 value 是万分比，不是金额 —— 不做元/分换算
    value = Math.round(raw);
    if (value < 1 || value >= 10000) return '折扣需小于 10 折(万分比 1~9999)';
  } else {
    if (raw <= 0) return '减免金额必须大于 0';
    value = Math.round(raw * 100); // 表单内是元 → 存库用分
  }

  const from = new Date(form.validFrom);
  const to = new Date(form.validTo);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return '有效期格式非法';
  if (to <= from) return '失效时间必须晚于生效时间';

  const thresholdYuan = Number(form.threshold);
  if (!Number.isFinite(thresholdYuan) || thresholdYuan < 0) return '使用门槛必须是非负数';

  const payload: UpsertCouponPayload = {
    name,
    type: form.type,
    value,
    // 门槛：表单内存元 → 存库用分（只在这里换算一次）
    thresholdCents: Math.round(thresholdYuan * 100),
    scope: form.scope,
    totalCount: Math.max(0, Number(form.totalCount) || 0),
    perUserLimit: Math.max(0, Number(form.perUserLimit) || 0),
    validFrom: from.toISOString(),
    validTo: to.toISOString(),
    status: form.status,
  };

  // 创建时券码必填；更新留空表示不改
  if (!editing) {
    const code = form.code.trim().toUpperCase();
    if (!/^[A-Z0-9]{4,24}$/.test(code)) {
      return '券码需为 4~24 位大写字母或数字';
    }
    payload.code = code;
  }
  return payload;
}
