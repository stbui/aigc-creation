import { useCallback, useState } from 'react';

import { MAX_TOTAL } from './constants';
import type { ToolAsset, ToolResult } from './components';
import { generateApi, resolveModelKey } from './api';
import { downloadFilenameOf, outputsOf, resultsOf, taskErrorText, type FusionFailureKind, type PolledResult } from './utils';
import { notifyCreditsChanged } from '../../context/CreditsContext';
import { useGenerateError } from '../../hooks/useGenerateError';
import { useIdempotencyKey } from '../../hooks/useIdempotencyKey';
import { useProject } from '../../hooks/useProject';
import { useTaskPoller } from '../../hooks/useTaskPoller';
import { useApp } from '../../ui';

/** 失败态: 失败类别 + 可直接渲染的结果占位 */
export interface MultiFusionFailure {
  kind: FusionFailureKind;
  result: ToolResult;
}

interface MultiFusionTaskOptions {
  subject: ToolAsset | null;
  accents: ToolAsset[];
  scene: string;
  variantCount: string;
  ratio: string;
  resolution: string;
  prompt: string;
  /** 能力不可用原因；非空时阻止提交（访客不传，交给登录弹窗） */
  blockedReason: string | null;
}

/**
 * 多图融合的提交 / 轮询 / 结果状态机。
 *
 * 一次提交 = 一条 `multi_fusion` 任务 = N 张变体；结果面板要同时表达
 * 「请求几张 / 回来几张 / 是否结果不明」，故把这三件事收在同一处：
 * - `requestedVariantCount` / `requestedRatio` 是**提交时快照**，
 *   生成后改选项不能反过来改写结果状态；
 * - 轮询超时保留 `taskId`，允许「重新查询」而**不重新建单**（避免重复扣费）；
 * - 建任务后的查询失败是「结果未知」而不是「生成失败」，语义不同。
 */
export function useMultiFusionTask({
  subject,
  accents,
  scene,
  variantCount,
  ratio,
  resolution,
  prompt,
  blockedReason,
}: MultiFusionTaskOptions) {
  const { message } = useApp();
  const reportError = useGenerateError();
  const { ensureProject } = useProject();
  const pollTask = useTaskPoller();
  const { keyFor: idempotencyKeyFor, reset: resetIdempotencyKey } = useIdempotencyKey();

  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<ToolResult[]>([]);
  const [activeResultIndex, setActiveResultIndex] = useState(0);
  const [lastFailure, setLastFailure] = useState<MultiFusionFailure | null>(null);
  /** 轮询超时的任务仍可能成功；保留 taskId 供「重新查询」，并阻止误重复生成。 */
  const [timedOutTaskId, setTimedOutTaskId] = useState<string | null>(null);
  const [requestedVariantCount, setRequestedVariantCount] = useState(4);
  const [requestedRatio, setRequestedRatio] = useState<string | null>(null);

  const activeResult = results[activeResultIndex] ?? results[0] ?? null;

  const applyPolledResult = useCallback(
    (taskId: string, done: PolledResult, requestedCount: number) => {
      if (done.status === 'failed') {
        if (done.errorCode === 'POLL_TIMEOUT') {
          setTimedOutTaskId(taskId);
          setLastFailure({ kind: 'timeout', result: done });
          message.info('任务已提交，结果暂未返回，可稍后重新查询');
          return;
        }
        setTimedOutTaskId(null);
        setLastFailure({ kind: 'generation', result: done });
        message.error(taskErrorText(done.errorCode));
        return;
      }

      const outputs = outputsOf(done);
      if (outputs.length === 0) {
        setTimedOutTaskId(null);
        setLastFailure({
          kind: 'generation',
          result: { status: 'failed', errorCode: 'EMPTY_OUTPUT' },
        });
        message.error('模型没有返回可用图片，请重试');
        return;
      }

      setTimedOutTaskId(null);
      setLastFailure(null);
      setResults(resultsOf(done));
      message.success(
        outputs.length < requestedCount
          ? `已生成 ${outputs.length} / ${requestedCount} 张变体`
          : `融合结果已生成（${outputs.length} 张）`,
      );
    },
    [message],
  );

  const submit = useCallback(async () => {
    if (!subject || accents.length === 0 || submitting || timedOutTaskId) return;
    // guest 点击仍应走登录弹窗；已登录时才把「能力不可用」作为硬拦截。
    if (blockedReason) {
      message.warning(blockedReason);
      return;
    }
    const requestedCount = Math.max(1, Math.trunc(Number(variantCount)) || 1);
    const submittedRatio = ratio;
    let taskId: string | null = null;
    setRequestedVariantCount(requestedCount);
    setRequestedRatio(submittedRatio);
    setTimedOutTaskId(null);
    setSubmitting(true);
    setResults([]);
    setActiveResultIndex(0);
    setLastFailure(null);
    try {
      const projectId = await ensureProject();
      const modelKey = await resolveModelKey('multi_fusion');
      const payload = {
        projectId,
        capability: 'multi_fusion',
        modelKey,
        // 顺序即语义: [0]=主体图, [1..]=搭配图 (后端 processTask 按提交序保序)
        inputAssetIds: [subject.id, ...accents.map((a) => a.id)].slice(0, MAX_TOTAL),
        params: {
          scene,
          variantCount: String(requestedCount),
          ratio: submittedRatio,
          size: resolution,
          prompt: prompt.trim(),
        },
      };
      // 网络失败重试复用同一幂等键，避免同一输入建两次任务、扣两次费
      const idempotencyKey = idempotencyKeyFor(JSON.stringify(payload));
      const started = await generateApi.start({ ...payload, idempotencyKey });
      taskId = started.taskId;
      resetIdempotencyKey();
      const done = await pollTask(taskId);
      applyPolledResult(taskId, done, requestedCount);
    } catch (e) {
      if (!taskId) {
        setLastFailure({
          kind: 'submit',
          result: { status: 'failed', errorCode: (e as Error).message || 'GENERATE_FAILED' },
        });
        reportError(e);
      } else {
        // 任务已建立后查询失败：结果未知而不是生成失败，保留 taskId 避免重复建单。
        setTimedOutTaskId(taskId);
        setLastFailure({
          kind: 'timeout',
          result: { status: 'failed', errorCode: (e as Error).message || 'RESULT_UNKNOWN' },
        });
        message.info('任务已提交，暂时无法查询结果，请稍后重试');
      }
    } finally {
      setSubmitting(false);
      // 扣费在建任务时发生、失败会自动退还，两个方向都改了余额
      notifyCreditsChanged();
    }
  }, [
    accents,
    applyPolledResult,
    blockedReason,
    ensureProject,
    idempotencyKeyFor,
    message,
    pollTask,
    prompt,
    ratio,
    reportError,
    resetIdempotencyKey,
    resolution,
    scene,
    subject,
    submitting,
    timedOutTaskId,
    variantCount,
  ]);

  const retryPoll = useCallback(async () => {
    if (!timedOutTaskId || submitting) return;
    const taskId = timedOutTaskId;
    setSubmitting(true);
    setLastFailure(null);
    try {
      const done = await pollTask(taskId);
      applyPolledResult(taskId, done, requestedVariantCount);
    } catch (e) {
      setTimedOutTaskId(taskId);
      setLastFailure({
        kind: 'timeout',
        result: { status: 'failed', errorCode: (e as Error).message || 'RESULT_UNKNOWN' },
      });
      message.info('暂时无法查询结果，请稍后再试');
    } finally {
      setSubmitting(false);
      notifyCreditsChanged();
    }
  }, [applyPolledResult, message, pollTask, requestedVariantCount, submitting, timedOutTaskId]);

  const download = useCallback(() => {
    if (!activeResult?.url) return;
    const a = document.createElement('a');
    a.href = activeResult.url;
    a.download = downloadFilenameOf(activeResultIndex, activeResult.url);
    a.target = '_blank';
    a.rel = 'noreferrer';
    a.click();
  }, [activeResult, activeResultIndex]);

  return {
    submitting,
    results,
    activeResult,
    activeResultIndex,
    selectResult: setActiveResultIndex,
    lastFailure,
    timedOutTaskId,
    requestedVariantCount,
    requestedRatio,
    submit,
    retryPoll,
    download,
  };
}
