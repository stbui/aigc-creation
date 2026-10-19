import type { ReactNode } from 'react';
import { Activity, CircleCheck, ImagePlus } from 'lucide-react';
import { ToolEmptyIllustration } from './ToolShell';

/**
 * 结果栏空态 —— 工具页通用能力。
 *
 * 2026-10-19 抽取。此前 ToolShell 与 5 个自建页各写一遍
 * 「插画 + 标题 + 描述 (+ 流程步骤 / mock 披露)」。
 *
 * 只抽空态，**结果栏本体不抽**：各页的结果网格 class（`pk-result-grid` /
 * `tool-result-grid` 等）是参考站逐页 1:1 实拍值，强行统一会破坏复刻。
 */
export function ToolEmptyState({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children?: ReactNode;
}) {
  return (
    <div className="pk-preview-placeholder">
      <div className="pk-preview-inner">
        <ToolEmptyIllustration />
        <h3>{title}</h3>
        {desc && <p>{desc}</p>}
        {children}
      </div>
    </div>
  );
}

/** 流程步骤条（配置参数 → 提交生成 → 查看结果），参考站结果栏空态的固定三步 */
export function ToolWorkflowSteps() {
  return (
    <div className="pk-workflow-steps">
      <span>
        <CircleCheck size={14} /> 配置参数
      </span>
      <span>
        <Activity size={14} /> 提交生成
      </span>
      <span>
        <ImagePlus size={14} /> 查看结果
      </span>
    </div>
  );
}