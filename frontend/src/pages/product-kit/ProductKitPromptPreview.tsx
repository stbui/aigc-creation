import { useCallback, useEffect, useState } from 'react';

import { Modal } from '../../ui';
import { promptPreviewApi, type PromptPreviewItem } from './api';
import { PRODUCT_KIT_CAPABILITY } from './constants';

/**
 * 提示词预览 —— 「模型到底会收到什么」。
 *
 * ## 为什么必须走后端
 *
 * 提示词是**能力定义的一部分**（后端 `CapabilityPlugin.buildPrompt`）。
 * 前端复刻一份模板必然与后端漂移，于是预览显示的提示词和实际发出去的
 * 不是一回事 —— 用户按错误的信息做决策，比没有预览更糟。
 *
 * 所以这里只负责**渲染**后端算好的提示词，一行模板都不复制。
 *
 * ## 语义
 *
 * · 不建任务、不选路、不扣费（后端接口就是纯计算）；
 * · 展示的是**本次提交会用的每一条**提示词（白底 ×1、场景 ×2…），
 *   张数与顺序与服务端拆出的任务一致；
 * · 参考图张数取自当前图片位 —— 与真实提交同源。
 */

export interface ProductKitPromptPreviewProps {
  open: boolean;
  onClose: () => void;
  /** 商品名称 */
  productName: string;
  /** 品牌 */
  brand: string;
  /** 投放平台 */
  platform: string;
  /** 输出语言 */
  language: string;
  /** 商品描述 */
  description: string;
  /** 画面比例 */
  ratio: string;
  /** 画质档 */
  resolution: string;
  /** 本次要产出的变体清单（逗号分隔，可重复） */
  variants: string;
  /** 当前图片位的张数（参考图张数） */
  refCount: number;
}

type PreviewState =
  | { status: 'loading' }
  | { status: 'ready'; items: PromptPreviewItem[] }
  | { status: 'error'; message: string };

export function ProductKitPromptPreview({
  open,
  onClose,
  productName,
  brand,
  platform,
  language,
  description,
  ratio,
  resolution,
  variants,
  refCount,
}: ProductKitPromptPreviewProps) {
  const [state, setState] = useState<PreviewState>({ status: 'loading' });

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const result = await promptPreviewApi.preview(
        PRODUCT_KIT_CAPABILITY,
        {
          productName: productName.trim(),
          brand: brand.trim(),
          platform,
          language,
          description: description.trim(),
          ratio,
          size: resolution,
          variants,
        },
        refCount,
      );
      setState({ status: 'ready', items: result.items });
    } catch (error) {
      setState({
        status: 'error',
        message: (error as Error).message || '提示词预览加载失败',
      });
    }
  }, [productName, brand, platform, language, description, ratio, resolution, variants, refCount]);

  // 打开时重新拉一次: 表单可能已经改过, 预览必须反映**当前**配置
  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  return (
    <Modal
      open={open}
      title="生成提示词预览"
      width={720}
      onCancel={onClose}
      footer={null}
    >
      <div className="pk-prompt-preview">
        <p className="pk-prompt-preview-hint">
          下面是本次提交会逐张发给模型的提示词。预览不生成图片、不扣积分。
        </p>

        {state.status === 'loading' && (
          <div className="pk-prompt-preview-state">正在计算提示词…</div>
        )}

        {state.status === 'error' && (
          <div className="pk-prompt-preview-state is-error">{state.message}</div>
        )}

        {state.status === 'ready' && state.items.length === 0 && (
          <div className="pk-prompt-preview-state">
            请先在「自定义配置」里选择至少一种主图类型。
          </div>
        )}

        {state.status === 'ready' &&
          state.items.map((item, index) => (
            <section key={item.key} className="pk-prompt-preview-item">
              <header className="pk-prompt-preview-head">
                <span className="pk-prompt-preview-index">第 {index + 1} 张</span>
                <strong>{item.label}</strong>
              </header>
              <pre className="pk-prompt-preview-text">{item.prompt}</pre>
            </section>
          ))}
      </div>
    </Modal>
  );
}
