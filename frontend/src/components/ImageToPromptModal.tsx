import './PromptPolishModal.css';
import { useUploadLimits } from '../context/UploadLimitsContext';
import { useEffect, useRef, useState } from 'react';
import { assetsApi, promptToolsApi } from '../lib/api';
import { promptToolErrorMessage } from '../lib/promptToolMessages';
import { useProject } from '../hooks/useProject';
import type { PromptToolResult } from '../types/api';
import {
  useApp,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  ImageUploadArea,
  ImageUploadThumb,
  Spinner,
} from '../ui';

/**
 * 图片转提示词弹窗 —— 1:1 复刻参考站 (ijihua.cn/free-creation) 的同名弹窗。
 *
 * ## 参考站实拍结构 (2026-10-20 浏览器实测 + 截图)
 *
 *   ┌────────────────────────────────────────┐
 *   │ 创意生图                            [×] │
 *   │ 图片转提示词                            │
 *   ├────────────────────────────────────────┤
 *   │ ┌────┐  上传一张图片                    │  ← 左侧上传方块 + 右侧说明
 *   │ │ +  │  支持运行时允许的格式             │
 *   │ └────┘  单张不超过运行时上限            │
 *   │ ┌────────────────────────────────────┐ │
 *   │ │ 上传图片解析提示词                 │ │  ← 输出区
 *   │ │                                    │ │
 *   │ └────────────────────────────────────┘ │
 *   │ 0 字                [提交解析]  [应用]   │
 *   └────────────────────────────────────────┘
 *
 * ## 流程
 *
 *   选图 → 先上传到素材库 (拿到 assetId) → 后端读图送视觉模型 → 输出提示词
 *   → 「应用」回填主表单提示词框
 *
 * ⚠️ **先上传再解析, 而不是把图 base64 直接传给解析接口**:
 * 后端按 assetId 读字节, 天然带归属校验, 也不会让本站变成任意 URL 代理。
 */

export interface ImageToPromptModalProps {
  open: boolean;
  /** 应用时的回填回调 */
  onApply: (text: string) => void;
  onCancel: () => void;
}

/** accept / 格式标签 / 单张上限均由运行时 UploadLimits 提供。 */

export function ImageToPromptModal({ open, onApply, onCancel }: ImageToPromptModalProps) {
  const { message } = useApp();
  const { ensureProject } = useProject();
  const { accept, allowedLabel, maxMb, validateImageFile } = useUploadLimits();

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [output, setOutput] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PromptToolResult | null>(null);
  const openedRef = useRef(false);

  useEffect(() => {
    if (open && !openedRef.current) {
      openedRef.current = true;
      setFile(null);
      setPreview(null);
      setOutput('');
      setResult(null);
    }
    if (!open) {
      openedRef.current = false;
      // 释放 objectURL, 否则每次开弹窗都泄漏一个 blob 句柄
      setPreview((old) => {
        if (old) URL.revokeObjectURL(old);
        return null;
      });
    }
  }, [open]);

  const pickFile = async (f: File | undefined | null) => {
    if (!f) return;
    const validationError = await validateImageFile(f);
    if (validationError) {
      message.error(`${f.name}：${validationError}`);
      return;
    }
    setFile(f);
    setOutput('');
    setResult(null);
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(f);
    });
  };

  const clearFile = () => {
    setFile(null);
    setOutput('');
    setResult(null);
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return null;
    });
  };

  const submit = async () => {
    if (!file) {
      message.warning('请先上传一张图片');
      return;
    }
    setLoading(true);
    try {
      // 1) 先入素材库 (拿到 assetId) —— 后端按 id 读图, 带归属校验
      const projectId = await ensureProject();
      const asset = await assetsApi.upload(file, projectId);
      // 2) 送视觉模型解析
      const r = await promptToolsApi.imageToPrompt(asset.id);
      setOutput(r.text);
      setResult(r);
      if (!r.text) message.warning('这次没有生成可用内容，请重试');
    } catch (e) {
      message.error(promptToolErrorMessage(e, 'image'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="pt-i2p-modal gap-4 p-6 sm:max-w-[600px]">
        <DialogTitle className="sr-only">图片转提示词</DialogTitle>
        <DialogDescription className="sr-only">
          上传一张图片，由视觉模型解析出可直接使用的提示词。
        </DialogDescription>
        <div className="pt-modal-head">
          <span className="pt-modal-eyebrow">创意生图</span>
          <h2 className="pt-modal-title">图片转提示词</h2>
        </div>
        {/* 上传区 */}
        <ImageUploadArea
          images={file && preview ? [{ id: 'draft', url: preview, name: file.name }] : []}
          max={1}
          single
          accept={accept}
          replaceOnClick
          ariaLabel="上传图片"
          emptyTitle="点击或拖拽图片到此处上传"
          emptyHint={`支持 ${allowedLabel}，单张不超过 ${maxMb}MB`}
          renderPreview={(items) => {
            const image = items[0];
            if (!image) return null;
            return (
              <div className="flex w-full items-center gap-3">
                <ImageUploadThumb
                  item={image}
                  removeLabel="移除图片"
                  className="size-[72px] w-[72px] shrink-0"
                  onRemove={clearFile}
                />
                <div className="min-w-0">
                  <strong className="block truncate text-sm leading-[18px] text-foreground">
                    {image.name}
                  </strong>
                  <span className="block text-xs leading-[18px] text-[color:var(--text-desc)]">
                    支持 {allowedLabel}，单张不超过 {maxMb}MB
                  </span>
                </div>
              </div>
            );
          }}
          onFiles={(files) => {
            const list = Array.from(files);
            if (list.length > 1) {
              message.info(
                `一次只支持 1 张图片，已使用 ${list[0].name}，其余 ${list.length - 1} 张未采用`,
              );
            }
            void pickFile(list[0]);
          }}
        />

        {/* 输出区 */}
        <div className="pt-polish-output">
          <textarea
            className="pt-polish-textarea"
            value={output}
            placeholder="上传图片解析提示词"
            onChange={(e) => setOutput(e.target.value)}
          />
          {loading && (
            <div className="pt-polish-loading">
              <Spinner className="size-4" />
            </div>
          )}
        </div>

        <div className="pt-polish-foot">
          <span className="pt-polish-count">{output.length} 字</span>
          <div className="pt-polish-actions">
            <button
              type="button"
              className="pt-btn pt-btn-ghost"
              onClick={() => void submit()}
              disabled={loading || !file}
            >
              提交解析
            </button>
            <button
              type="button"
              className="pt-btn pt-btn-primary"
              disabled={!output.trim()}
              onClick={() => onApply(output.trim())}
            >
              应用
            </button>
          </div>
        </div>

        {result && <p className="pt-polish-source-note">内容由智能助手生成</p>}
      </DialogContent>
    </Dialog>
  );
}
