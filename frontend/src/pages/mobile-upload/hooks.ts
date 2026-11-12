/**
 * 手机上传页面的 hooks —— 目录内文件的唯一 hooks 入口。
 *
 * 本页使用原生 DOM 上传区，没有外部共享控件；SEO hook 从这里转出，
 * 选图 / 压缩 / 排序 / 回传状态直接定义在下方。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { mobileUploadApi } from './api';
import { MAX_EDGE, MAX_FILES, MAX_TOTAL_BYTES, MAX_TOTAL_MB, type Phase, type Picked } from './constants';
import { MAX_IMAGE_MB, SUPPORTED_IMAGE_LABEL, compressImage, isSupportedImageFile } from './utils';

/** 路由级 SEO 元信息 */
export { useDocumentMeta } from '../../hooks/useDocumentMeta';

/**
 * 手机端选图与回传。
 *
 * 选图逐张压缩（失败回退原图），并对张数、单张体积与整批体积做三重校验；
 * objectURL 只在真正卸载时释放（按 picked 释放会把仍被引用的预览撤销成破图）。
 */
export function useMobileUpload(sessionId: string, token: string) {
  const [picked, setPicked] = useState<Picked[]>([]);
  const [phase, setPhase] = useState<Phase>('pick');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** 当前列表的同步镜像：分两批选图时避免读到陈旧的 picked.length */
  const pickedRef = useRef<Picked[]>([]);

  useEffect(() => {
    pickedRef.current = picked;
  }, [picked]);

  /*
   * 只在**真正卸载**时释放 objectURL。
   *
   * 之前依赖 [picked]，每次新增/删除/排序都会先执行 cleanup，把上一轮
   * 所有 URL 撤销 —— 但旧条目仍留在新数组里继续被 <img> 引用，
   * 添加第二批图片后前面的预览就会变成破图。
   */
  useEffect(
    () => () => {
      for (const item of pickedRef.current) URL.revokeObjectURL(item.url);
    },
    [],
  );

  /** 选择图片 (可多选) */
  const addFiles = useCallback(async (list: FileList | File[] | null) => {
    if (!list) return;
    const files = Array.from(list).filter(isSupportedImageFile);
    if (!files.length) {
      setError(`请选择图片文件（${SUPPORTED_IMAGE_LABEL}）`);
      return;
    }
    const remaining = MAX_FILES - pickedRef.current.length;
    if (remaining <= 0) {
      setError(`最多上传 ${MAX_FILES} 张，请先移除部分图片`);
      return;
    }
    if (files.length > remaining) {
      setError(`最多上传 ${MAX_FILES} 张，本次还可添加 ${remaining} 张`);
      return;
    }
    setError(null);
    setNotice(null);

    // 逐张压缩 (参考站: 「图片已自动压缩，压缩到 X」)
    const results: Picked[] = [];
    let compressedCount = 0;
    let minEdge = Infinity;
    for (const file of files) {
      if (file.size > MAX_IMAGE_MB * 1024 * 1024) {
        setError(`单张不超过 ${MAX_IMAGE_MB}MB`);
        return;
      }
      const compressed = await compressImage(file);
      if (compressed.compressed) {
        compressedCount++;
        minEdge = Math.min(minEdge, compressed.edge ?? 0);
      }
      results.push({
        file: compressed.file,
        url: URL.createObjectURL(compressed.file),
        size: compressed.file.size,
        compressed: compressed.compressed,
        edge: compressed.edge,
      });
    }
    const nextTotal = [...pickedRef.current, ...results].reduce((sum, item) => sum + item.size, 0);
    if (nextTotal > MAX_TOTAL_BYTES) {
      for (const item of results) URL.revokeObjectURL(item.url);
      setError(`一次上传总大小不能超过 ${MAX_TOTAL_MB}MB`);
      return;
    }
    pickedRef.current = [...pickedRef.current, ...results];
    setPicked((prev) => [...prev, ...results]);
    if (compressedCount > 0) {
      setNotice(
        `图片已自动压缩，压缩到 ${Number.isFinite(minEdge) ? minEdge : MAX_EDGE}px 以内` +
          (compressedCount < results.length ? `（${compressedCount} 张被压缩）` : ''),
      );
    }
  }, []);

  /** 移除某张 */
  const removeAt = (index: number) => {
    setPicked((prev) => {
      const target = prev[index];
      if (target) {
        URL.revokeObjectURL(target.url);
        pickedRef.current = pickedRef.current.filter((item) => item.url !== target.url);
      }
      return prev.filter((_, current) => current !== index);
    });
  };

  /** 调整顺序 —— 参考站的左右箭头, 顺序即电脑端参考图位的构图顺序 */
  const move = (index: number, delta: -1 | 1) => {
    setPicked((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  /** 提交 */
  const submit = useCallback(async () => {
    if (!picked.length) {
      setError('请先选择图片');
      return;
    }
    setPhase('uploading');
    setError(null);
    try {
      await mobileUploadApi.receive(
        sessionId,
        token,
        picked.map((item) => item.file),
      );
      setPhase('success');
    } catch (cause) {
      setPhase('error');
      setError((cause as Error).message || '上传失败');
    }
  }, [picked, sessionId, token]);

  const totalSize = useMemo(
    () => picked.reduce((sum, item) => sum + item.size, 0),
    [picked],
  );

  return { picked, phase, setPhase, error, notice, totalSize, addFiles, removeAt, move, submit };
}
