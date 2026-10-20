import { useEffect, useRef, useState } from 'react';
import { App, Modal, Spin } from 'antd';
import { RefreshCw, X } from 'lucide-react';
import { promptToolsApi } from '../lib/api';
import type { PromptToolResult } from '../types/api';

/**
 * AI 润色弹窗 —— 1:1 复刻参考站 (ijihua.cn/free-creation) 的「AI润色」弹窗。
 *
 * ## 参考站实拍结构 (2026-10-20 浏览器实测 + 截图)
 *
 *   ┌────────────────────────────────────────┐
 *   │ 创意生图                            [×] │  ← 眉标 + 右上关闭
 *   │ AI润色                                  │  ← 标题 18px/700
 *   ├────────────────────────────────────────┤
 *   │ ┌────────────────────────────────────┐ │
 *   │ │ 原始提示词          仅润色文字     │ │  ← 只读原文区, 右上为开关
 *   │ │ 把这款产品放在未来感厨房场景中…   │ │
 *   │ └────────────────────────────────────┘ │
 *   │ ┌────────────────────────────────────┐ │
 *   │ │ 点击下方"开始润色"后, AI 将在这里  │ │  ← 输出区 (可编辑)
 *   │ │ 生成优化后的提示词                 │ │
 *   │ │                                    │ │
 *   │ └────────────────────────────────────┘ │
 *   │ 0 字              [开始润色]  [应用]    │  ← 字数 / 提交 / 应用
 *   └────────────────────────────────────────┘
 *
 * ## 行为
 *
 *   - 打开时把当前提示词填入「原始提示词」区 (只读, 供对照)
 *   - 「开始润色」→ 调后端 → 文本写入输出区, 「应用」按钮转为可用
 *   - 「应用」→ 把输出区文本回填到主表单提示词框, 关闭弹窗
 *   - 「仅润色文字」→ 只改措辞不增删要素 (对应后端 textOnly)
 *
 * ## 诚实披露
 *
 * 输出区下方标注产出来源与模型名 —— 文本没有本地兜底, 输出必来自真实模型,
 * 但**具体是哪个模型**要让用户知道 (不同模型的润色风格差别很大)。
 */

export interface PromptPolishModalProps {
  open: boolean;
  /** 当前主表单里的提示词 (作为润色输入) */
  value: string;
  /** 应用时的回填回调 */
  onApply: (text: string) => void;
  onCancel: () => void;
}

export function PromptPolishModal({ open, value, onApply, onCancel }: PromptPolishModalProps) {
  const { message } = App.useApp();
  const [output, setOutput] = useState('');
  const [textOnly, setTextOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PromptToolResult | null>(null);
  /** 每次打开都重置: 上一次的润色结果不该留在新弹窗里 */
  const openedRef = useRef(false);

  useEffect(() => {
    if (open && !openedRef.current) {
      openedRef.current = true;
      setOutput('');
      setTextOnly(false);
      setResult(null);
    }
    if (!open) openedRef.current = false;
  }, [open]);

  const run = async () => {
    if (!value.trim()) {
      message.warning('请先在提示词框中输入内容');
      return;
    }
    setLoading(true);
    try {
      const r = await promptToolsApi.polish(value.trim(), textOnly);
      setOutput(r.text);
      setResult(r);
      if (!r.text) message.warning('模型没有返回内容，请重试');
    } catch (e) {
      message.error((e as Error).message || '润色失败');
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
      className="pt-polish-modal"
      closeIcon={<X size={18} />}
      title={
        <div className="pt-modal-head">
          <span className="pt-modal-eyebrow">创意生图</span>
          <h2 className="pt-modal-title">AI润色</h2>
        </div>
      }
    >
      {/* 原始提示词 (只读, 供对照) */}
      <div className="pt-polish-source">
        <div className="pt-polish-source-head">
          <span className="pt-polish-source-label">原始提示词</span>
          <button
            type="button"
            className={`pt-polish-textonly${textOnly ? ' is-on' : ''}`}
            onClick={() => setTextOnly((v) => !v)}
            title="仅润色文字：不增删画面要素"
          >
            仅润色文字
          </button>
        </div>
        <div className="pt-polish-source-body">{value || '（提示词为空）'}</div>
      </div>

      {/* 输出区 */}
      <div className="pt-polish-output">
        <textarea
          className="pt-polish-textarea"
          value={output}
          placeholder={'点击下方"开始润色"后, AI 将在这里生成优化后的提示词'}
          onChange={(e) => setOutput(e.target.value)}
        />
        {loading && (
          <div className="pt-polish-loading">
            <Spin size="small" />
          </div>
        )}
      </div>

      {/* 底部: 字数 + 操作 */}
      <div className="pt-polish-foot">
        <span className="pt-polish-count">{output.length} 字</span>
        <div className="pt-polish-actions">
          <button type="button" className="pt-btn pt-btn-ghost" onClick={() => void run()} disabled={loading}>
            <RefreshCw size={13} />
            开始润色
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

      {result?.model && (
        <p className="pt-polish-source-note">
          由 {result.model} 生成
        </p>
      )}
    </Modal>
  );
}
