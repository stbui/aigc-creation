/**
 * 能力匹配：请求意图 vs 能力合同。
 *
 * 移植自 open-ai-canvas `internal/app/model_router_capability.go` 的 `MatchCapability`。
 *
 * 输出既有 `matched` 也有**逐条原因**：后台模拟与 C 端失败提示都直接读
 * `reasons`，不接受「选了模型但没生成出来」这种无信息量结果。
 */

import { containsCapabilityString, normalizeCapability } from '../domain/capability-config';
import { resolveImageParameterValues } from './image-contract';
import { capabilityImageSizePresetMatches } from './model-intent';
import {
  canonicalModelOptionName,
  capabilityInputLabel,
  capabilityOptionLabel,
  inactiveCapabilityOptionValue,
  matchOptionConstraint,
} from './option-values';
import type { CapabilityIssue, CapabilityMatch, CapabilitySpec, ModelRequestIntent } from './spec-types';

/** 图片参数合同参与匹配时，`size` 可能已被解析成像素预设：先归一化再校验 */
function matchImageParameters(spec: CapabilitySpec, intent: ModelRequestIntent): CapabilityIssue[] {
  if (spec.imageParameters === undefined) return [];
  const issues: CapabilityIssue[] = [];
  const values: Record<string, unknown> = { ...(intent.options ?? {}) };
  let parameters = spec.imageParameters.map((parameter) => ({ ...parameter, required: false }));
  if (capabilityImageSizePresetMatches(spec, values.size, values)) {
    // 尺寸已经按预设归一，不再当作参数合同的普通取值
    delete values.size;
    parameters = parameters.filter((parameter) => parameter.name !== 'size');
  }
  try {
    resolveImageParameterValues(parameters, values);
  } catch (caught) {
    issues.push({
      kind: 'image_parameter',
      name: 'imageParameters',
      reason: caught instanceof Error ? caught.message : String(caught),
    });
  }
  return issues;
}

export function matchCapability(spec: CapabilitySpec, intent: ModelRequestIntent): CapabilityMatch {
  const reasons: string[] = [];
  const issues: CapabilityIssue[] = [];
  const addIssue = (kind: string, name: string, reason: string): void => {
    reasons.push(reason);
    issues.push({ kind, name, reason });
  };

  for (const issue of matchImageParameters(spec, intent)) addIssue(issue.kind, issue.name, issue.reason);

  if (normalizeCapability(intent.capability) !== normalizeCapability(spec.capability)) {
    addIssue('capability', 'capability', '能力类型不匹配');
  }

  const operation = String(intent.operation ?? '').trim().toLowerCase();
  const specOperations = spec.operations ?? [];
  if (operation !== '' && specOperations.length > 0 && !containsCapabilityString(specOperations, operation)) {
    addIssue('operation', 'operation', `不支持操作 ${intent.operation}`);
  }

  const inputs = spec.inputs ?? {};
  for (const [inputType, count] of Object.entries(intent.inputs ?? {})) {
    if (count < 0) {
      addIssue('input', inputType, '输入数量不能小于 0');
      continue;
    }
    const constraint = inputs[inputType];
    if (!constraint) {
      if (count > 0) addIssue('input', inputType, `不支持 ${capabilityInputLabel(inputType)}输入`);
      continue;
    }
    if (count < constraint.min || count > constraint.max) {
      addIssue(
        'input',
        inputType,
        `${capabilityInputLabel(inputType)}数量需在 ${constraint.min}-${constraint.max} 之间`,
      );
    }
  }
  for (const [inputType, constraint] of Object.entries(inputs)) {
    if ((intent.inputs?.[inputType] ?? 0) < constraint.min) {
      addIssue('input', inputType, `至少需要 ${constraint.min} 个${capabilityInputLabel(inputType)}`);
    }
  }

  const options = spec.options ?? {};
  for (const [rawName, value] of Object.entries(intent.options ?? {})) {
    const name = canonicalModelOptionName(spec.capability, rawName);
    if (inactiveCapabilityOptionValue(name, value)) continue;
    const constraint = options[name];
    if (!constraint) {
      addIssue('option', name, `不支持参数 ${capabilityOptionLabel(rawName)}`);
      continue;
    }
    if (!matchOptionConstraint(name, constraint, value)) {
      addIssue('option', name, `参数 ${capabilityOptionLabel(rawName)}超出支持范围`);
    }
  }

  return { matched: reasons.length === 0, reasons, issues };
}
