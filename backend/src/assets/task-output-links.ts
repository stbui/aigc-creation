import type { Prisma } from '@prisma/client';

export interface TaskOutputLink {
  id: string;
  outputAssetId: string | null;
  outputAssetIds: string | null;
}

/** 数据库层粗筛：主产出或 JSON 多产出引用命中。调用方仍需 `orderedOutputIds` 精确校验。 */
export function taskOutputReferenceWhere(assetId: string): Prisma.GenerationTaskWhereInput {
  return {
    OR: [
      { outputAssetId: assetId },
      { outputAssetIds: { contains: assetId } },
    ],
  };
}

/** 产出素材 id 列表：首项优先，顺次去重（历史任务只有 outputAssetId）。 */
export function orderedOutputIds(
  primaryId: string | null | undefined,
  idsJson: string | null | undefined,
): string[] {
  const ids: string[] = [];
  if (primaryId) ids.push(primaryId);
  try {
    const parsed = JSON.parse(idsJson || '[]');
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        const id = String(item ?? '').trim();
        if (id && !ids.includes(id)) ids.push(id);
      }
    }
  } catch {
    // 历史脏数据：只剩首项可用
  }
  return ids;
}

/**
 * 从任务的多产出引用中移除一个素材。
 *
 * 返回 null 表示任务已没有任何产出，应连同任务记录一起删除；否则返回新的
 * 首产出与 JSON 引用。首产出被删时提升下一张，避免 outputAssetId 悬空。
 */
export function detachTaskOutput(
  task: Pick<TaskOutputLink, 'outputAssetId' | 'outputAssetIds'>,
  assetId: string,
): { outputAssetId: string; outputAssetIds: string } | null {
  const ids = orderedOutputIds(task.outputAssetId, task.outputAssetIds);
  if (!ids.includes(assetId)) return null;
  const remaining = ids.filter((id) => id !== assetId);
  if (remaining.length === 0) return null;
  return {
    outputAssetId: remaining[0],
    outputAssetIds: JSON.stringify(remaining),
  };
}

/**
 * 删除素材前清理任务对它的引用。
 *
 * `outputAssetIds` 是 JSON 字符串，无法建外键；只按 `outputAssetId` 删除任务
 * 会漏掉第 2..N 张图，并在任务上留下指向已删素材的悬空 id。这里同时处理首产出
 * 与非首产出，返回真正需要删除的任务数。
 */
export async function detachAssetFromTasks(
  tx: Prisma.TransactionClient,
  assetId: string,
): Promise<number> {
  const tasks = await tx.generationTask.findMany({
    where: taskOutputReferenceWhere(assetId),
    select: { id: true, outputAssetId: true, outputAssetIds: true },
  });

  let removedTasks = 0;
  for (const task of tasks) {
    const ids = orderedOutputIds(task.outputAssetId, task.outputAssetIds);
    if (!ids.includes(assetId)) continue;

    const next = detachTaskOutput(task, assetId);
    if (!next) {
      const deleted = await tx.generationTask.deleteMany({ where: { id: task.id } });
      removedTasks += deleted.count;
      continue;
    }
    await tx.generationTask.update({ where: { id: task.id }, data: next });
  }
  return removedTasks;
}
