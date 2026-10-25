import {
  MAX_IMAGE_BYTES,
  MAX_IMAGE_MB,
  SUPPORTED_IMAGE_ACCEPT,
  SUPPORTED_IMAGE_LABEL,
  isSupportedImageFile,
} from '../lib/constants';
import { useEffect, useRef, useState } from 'react';
import { App, Modal, Spin } from 'antd';
import { ImagePlus, X } from 'lucide-react';
import { assetsApi, promptToolsApi, toAbsoluteUrl } from '../lib/api';
import { useProject } from '../hooks/useProject';
import type { PromptToolResult } from '../types/api';

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
 *   │ │ +  │  支持 PNG、JPG、WEBP,             │
 *   │ └────┘  单张不超过 10MB                 │
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

/** 单张上限 —— 与参考站文案一致 (10MB) */

export function ImageToPromptModal({ open, onApply, onCancel }: ImageToPromptModalProps) {
  const { message } = App.useApp();
  const { ensureProject } = useProject();
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const pickFile = (f: File | undefined | null) => {
    if (!f) return;
    if (!isSupportedImageFile(f)) {
      message.warning(`请选择图片文件（${SUPPORTED_IMAGE_LABEL}）`);
      return;
    }
    if (f.size > MAX_IMAGE_BYTES) {
      message.error(`单张不超过 ${MAX_IMAGE_MB}MB`);
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
      if (!r.text) message.warning('模型没有返回内容，请重试');
    } catch (e) {
      message.error((e as Error).message || '解析失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      footer={null}
      width={600}
      centered
      className="pt-i2p-modal"
      closeIcon={<X size={18} />}
      title={
        <div className="pt-modal-head">
          <span className="pt-modal-eyebrow">创意生图</span>
          <h2 className="pt-modal-title">图片转提示词</h2>
        </div>
      }
    >
      {/* 上传区 */}
      <div className="pt-i2p-upload">
        <input
          ref={fileInputRef}
          type="file"
          accept={SUPPORTED_IMAGE_ACCEPT}
          hidden
          onChange={(e) => {
            pickFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          className={`pt-i2p-upload-btn${file ? ' is-filled' : ''}`}
          onClick={() => fileInputRef.current?.click()}
        >
          {preview ? (
            <img src={preview} alt="待解析图片" />
          ) : (
            <>
              <ImagePlus size={20} />
              <span>上传图片</span>
            </>
          )}
        </button>
        <div className="pt-i2p-upload-text">
          <strong>{file ? file.name : '上传一张图片'}</strong>
          <span>支持 {SUPPORTED_IMAGE_LABEL}，单张不超过 {MAX_IMAGE_MB}MB</span>
        </div>
      </div>

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
            <Spin size="small" />
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

      {result?.model && <p className="pt-polish-source-note">由 {result.model} 生成</p>}
    </Modal>
  );
}
