/**
 * 用户分组的纯函数与外部工具入口 —— 目录内文件的唯一外部工具来源。
 *
 * 倍率 / 汇率在「表单百分比 / 普通积分」与「万分比 / 微积分」之间换算，
 * 只在 `toDraft`（回填）与 `buildGroupPayload`（提交）两处发生。
 */

import { parseCredits, toCreditsInput } from '../../../lib/microcredits';
import type { UserGroupView } from '../../../types/model';
import type { GroupDraft } from './constants';
import { auditReason } from '../../../admin-ui/lib/auditReason';

export { parseCredits, toCreditsInput };

export function toDraft(group: UserGroupView): GroupDraft {
  return {
    code: group.code,
    name: group.name,
    description: group.description,
    badgeLabel: group.badgeLabel,
    badgeStyle: group.badgeStyle || 'none',
    sortOrder: String(group.sortOrder),
    // 万分比 → 百分比：9500 → 95
    ratioPercent: String(Math.round(group.ratioBasisPoints / 100)),
    pointsPerUsd: toCreditsInput(group.pointsPerUsdMicrocredits),
    pointsPerCny: toCreditsInput(group.pointsPerCnyMicrocredits),
    allChannels: group.allChannels,
    channelIds: [...group.channelIds],
    overrides: group.modelOverrides.map((item) => ({
      modelKey: item.modelKey,
      ratioPercent: String(Math.round(item.ratioBasisPoints / 100)),
      pointsPerUsd: toCreditsInput(item.pointsPerUsdMicrocredits),
      pointsPerCny: toCreditsInput(item.pointsPerCnyMicrocredits),
    })),
  };
}

export type GroupPayloadResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; error: string };

/**
 * 表单 → 提交体。校验失败返回首条错误文案，成功返回请求体。
 *
 * `code` 创建后不可改：会员套餐按编码映射分组，改编码等于把存量会员整体换组。
 */
export function buildGroupPayload(draft: GroupDraft): GroupPayloadResult {
  const code = draft.code.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(code)) {
    return { ok: false, error: '分组编码只能使用小写字母、数字、下划线或连字符，最多 40 位' };
  }
  if (!draft.name.trim()) return { ok: false, error: '请填写分组名称' };

  const ratioPercent = Number(draft.ratioPercent);
  if (!Number.isFinite(ratioPercent) || ratioPercent <= 0 || ratioPercent > 100) {
    return { ok: false, error: '倍率必须是 0–100 之间的百分比（100 = 原价）' };
  }
  const pointsPerUsd = parseCredits(draft.pointsPerUsd);
  const pointsPerCny = parseCredits(draft.pointsPerCny);
  if (pointsPerUsd === null || pointsPerCny === null) {
    return { ok: false, error: '点数汇率必须是「积分」数字，最多 6 位小数' };
  }
  if (!draft.allChannels && draft.channelIds.length === 0) {
    return { ok: false, error: '取消「全部渠道可见」后至少要勾选一条渠道' };
  }

  const overrides: Array<Record<string, unknown>> = [];
  for (const item of draft.overrides) {
    const modelKey = item.modelKey.trim();
    if (!modelKey) return { ok: false, error: '覆盖项的模型编码不能为空' };
    const ratio = Number(item.ratioPercent);
    if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 100) {
      return { ok: false, error: `覆盖项「${modelKey}」的倍率必须是 0–100` };
    }
    const usd = parseCredits(item.pointsPerUsd);
    const cny = parseCredits(item.pointsPerCny);
    if (usd === null || cny === null) {
      return { ok: false, error: `覆盖项「${modelKey}」的点数汇率格式不正确` };
    }
    overrides.push({
      modelKey,
      ratioBasisPoints: Math.round(ratio * 100),
      pointsPerUsdMicrocredits: usd,
      pointsPerCnyMicrocredits: cny,
    });
  }

  const body: Record<string, unknown> = {
    code,
    name: draft.name.trim(),
    description: draft.description.trim(),
    badgeLabel: draft.badgeLabel.trim(),
    badgeStyle: draft.badgeStyle,
    sortOrder: Number(draft.sortOrder) || 0,
    ratioBasisPoints: Math.round(ratioPercent * 100),
    pointsPerUsdMicrocredits: pointsPerUsd,
    pointsPerCnyMicrocredits: pointsPerCny,
    allChannels: draft.allChannels,
    channelIds: draft.allChannels ? [] : draft.channelIds,
    modelOverrides: overrides,
    reason: auditReason('保存用户分组'),
  };
  return { ok: true, body };
}
