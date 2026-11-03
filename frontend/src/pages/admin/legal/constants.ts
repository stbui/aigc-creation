/**
 * AdminLegalPage 的本地常量与类型。
 */

import type { AdminLegalDoc, LegalSlug, LegalStatus } from '../../../types/api';

export const SLUGS: { value: LegalSlug; label: string }[] = [
  { value: 'user-agreement', label: '用户协议' },
  { value: 'privacy-policy', label: '隐私政策' },
  { value: 'minors-policy', label: '未成年人保护' },
  { value: 'account-rules', label: '账号规则' },
];

export const SLUG_LABEL: Record<string, string> = Object.fromEntries(SLUGS.map((s) => [s.value, s.label]));

export const STATUS_LABEL: Record<LegalStatus, string> = {
  draft: '草稿',
  published: '生效中',
  archived: '已归档',
};

export const STATUS_TONE_KEY: Record<LegalStatus, string> = {
  draft: 'pending',
  published: 'active',
  archived: 'deleted',
};
