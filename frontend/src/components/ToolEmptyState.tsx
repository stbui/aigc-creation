import type { ReactNode } from 'react';
import { Activity, CircleCheck, ImagePlus } from 'lucide-react';
import { ToolEmptyIllustration } from './illustrations';
import { StateSkeleton } from './StateViews';

/**
 * 结果栏空态 —— 工具页通用能力。
 *
 * 2026-10-19 抽取。此前 ToolShell 与 5 个自建页各写一遍
 * 「插画 + 标题 + 描述 (+ 流程步骤 / 来源披露)」。
 *
 * 只抽空态，**结果栏本体不抽**：各页的结果网格 class（`pk-result-grid` /
 * `tool-result-grid` 等）是参考站逐页 1:1 实拍值，强行统一会破坏复刻。
 *
 * 2026-10-20: 插画改从 `illustrations.tsx` 取，解掉与 ToolShell 的循环依赖
 * （此前此处 import ToolShell，而 ToolShell 又 import 本文件）。
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

/**
 * 结果栏「生成中」态 —— 2026-10-20 新增。
 *
 * 为什么必须有: 生成任务提交后, 各页都会先 `setResult(null)` 清空旧结果,
 * 于是结果栏在生成期间整块退回**空态插画**, 文案还写着
 * 「提交任务后，生成结果将在此处展示」—— 用户明明已点了生成, 却看到
 * "你还没提交"。慢模型(数秒到数十秒)下尤其刺眼, 用户会以为按钮没生效
 * 而重复点击。这属于**欺骗性 UI**, 不是单纯的观感问题。
 *
 * 本组件给出骨架占位 + 明确的进行中提示, 让"已提交 → 出图"这条链路
 * 在视觉上连续。5 个自建工具页 + ToolShell 共用同一实现。
 */
export function ToolGeneratingState({ tip = '正在生成，请稍候…' }: { tip?: string }) {
  return (
    <div className="pk-result-generating">
      <StateSkeleton variant="block" count={1} />
      <p className="pk-result-generating-tip">{tip}</p>
    </div>
  );
}