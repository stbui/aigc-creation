import { useEffect, useMemo, useRef, useState } from 'react';
import { modelsApi } from '../lib/api';
import { toCredits } from '../lib/microcredits';
import { loadModels, modelsForCapability, type PublicModelGroup } from '../lib/models';
import {
  readSelectedModelId,
  subscribeModelSelection,
  writeSelectedModelId,
} from '../lib/modelSelection';
import type { ModelQuoteView } from '../types/model';
import { Button } from '../ui';

/**
 * 前台模型选择器。
 *
 * 用户在这里选的是**模型分组**（名称 / 图标 / 价格），不是上游渠道或线路 ——
 * 渠道信息不出现在 C 端任何位置。选择按能力记忆（`lib/modelSelection`），
 * 建任务时由 `resolveModelKey` 读取，因此各入口的默认模型一致。
 *
 * 不可用模型仍然列出但置灰：用户需要知道「有更贵的模型，只是现在没线路」，
 * 直接隐藏会让人以为产品只有一档。
 *
 * 复用工具页高级设置的 `pk-settings-group` 样式，不新增 CSS 类。
 */

export interface ModelPickerProps {
  /** 能力 id（与后端 capability.registry 一致） */
  capability: string;
  /** 本次请求必然提交的输入槽位（如局部重绘的 `mask`） */
  requiredInputs?: readonly string[];
  /**
   * 当前参数（比例 / 画质等）。给出时按所选模型实时报价，
   * 让「换模型 = 换价」在点提交前就看见。
   */
  options?: Record<string, unknown>;
  /**
   * 实时报价（单次/单张，积分）。null = 未取到报价。
   *
   * 页面提交按钮的价签应优先用这份报价，而不是能力清单里的基础价 ——
   * 用户选了更贵的模型时，两个数字并存会直接造成“按钮一个价、实际扣另一个价”。
   */
  onQuoteChange?: (credits: number | null) => void;
  /**
   * 当前真正会被 `resolveModel` 选中的模型。目录尚未加载或加载失败时为 null。
   * 上传数量等模型相关约束应从这里读，不能假设前端的页面上限就等于模型上限。
   */
  onModelChange?: (model: PublicModelGroup | null) => void;
  className?: string;
}

/** 价格文案：优先展示后端给的口径，避免前端自己拼「起」字造成误导 */
function priceText(model: PublicModelGroup): string {
  if (model.priceLabel) return model.priceLabel;
  if (model.displayPrice !== null) return `${model.displayPrice} 积分`;
  return '按渠道价格档';
}

export function ModelPicker({
  capability,
  requiredInputs = [],
  options,
  onQuoteChange,
  onModelChange,
  className,
}: ModelPickerProps) {
  const [models, setModels] = useState<PublicModelGroup[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [quote, setQuote] = useState<ModelQuoteView | null>(null);
  const [quoteFailed, setQuoteFailed] = useState(false);
  // 回调通常是内联 setState，用 ref 避免它进入报价 effect 依赖导致重复请求
  const onQuoteChangeRef = useRef(onQuoteChange);
  const onModelChangeRef = useRef(onModelChange);
  useEffect(() => {
    onQuoteChangeRef.current = onQuoteChange;
  }, [onQuoteChange]);
  useEffect(() => {
    onModelChangeRef.current = onModelChange;
  }, [onModelChange]);

  const requiredInputsKey = requiredInputs.join('|');
  const candidates = useMemo(
    () =>
      modelsForCapability(
        capability,
        models,
        requiredInputsKey ? requiredInputsKey.split('|') : [],
      ),
    [capability, models, requiredInputsKey],
  );

  useEffect(() => {
    let alive = true;
    void loadModels()
      .then((list) => {
        if (!alive) return;
        setModels(list);
      })
      .catch(() => {
        // 目录拉取失败时选择器不出现（各入口提交时会给出更准确的原因）
        if (alive) setModels([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  // 选择：记忆值 → 默认（第一个可用）
  useEffect(() => {
    const remembered = readSelectedModelId(capability);
    const rememberedModel = remembered
      ? candidates.find((model) => model.id === remembered && model.available)
      : null;
    const fallback = candidates.find((model) => model.available) ?? null;
    setSelectedId(rememberedModel?.id ?? fallback?.id ?? '');
  }, [capability, candidates]);

  // 同页其它选择器改选时同步（如工作台与工具页同时打开）
  useEffect(
    () =>
      subscribeModelSelection(() => {
        const remembered = readSelectedModelId(capability);
        // 只跟随本目录里真实可用的模型：别的页面可能存了一个已下架 / 无线路的 id
        if (remembered && candidates.some((model) => model.id === remembered && model.available)) {
          setSelectedId(remembered);
        }
      }),
    [capability, candidates],
  );

  /**
   * 报价：参数或模型变化后重算，400ms 防抖。
   *
   * 报价失败不是错误态 —— 未登录、参数还没填全时接口会拒绝，
   * 此时不显示价格比显示一个错误更接近「还不知道多少钱」。
   */
  const optionsKey = options ? JSON.stringify(options) : '';
  useEffect(() => {
    if (!selectedId || !options) {
      setQuote(null);
      onQuoteChangeRef.current?.(null);
      return;
    }
    let alive = true;
    const timer = window.setTimeout(() => {
      setQuoteFailed(false);
      /*
       * 报价按「能力 id + 模型分组」：售价在能力级，切换线路不改价；
       * 报价与建任务共用同一份能力定价。
       */
      const quoteModel = candidates.find((model) => model.id === selectedId);
      modelsApi
        .quote(capability, quoteModel?.modelKey ?? selectedId, { options })
        .then((result) => {
          if (alive) {
            setQuote(result.quote);
            onQuoteChangeRef.current?.(
              result.quote.amountMicrocredits === null
                ? null
                : Number(toCredits(result.quote.amountMicrocredits)),
            );
          }
        })
        .catch(() => {
          if (alive) {
            setQuote(null);
            setQuoteFailed(true);
            onQuoteChangeRef.current?.(null);
          }
        });
    }, 400);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
    // optionsKey 是 options 的稳定序列化，直接依赖对象会在每次渲染重发请求；
    // candidates 变化（目录加载完成）时也必须重算报价。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, capability, optionsKey, candidates]);

  const selected = candidates.find((model) => model.id === selectedId) ?? null;

  useEffect(() => {
    onModelChangeRef.current?.(selected);
  }, [selected]);

  if (candidates.length === 0) {
    return (
      <div className={`pk-settings-group${className ? ` ${className}` : ''}`} data-testid="model-picker">
        <strong className="pk-settings-group-label">模型</strong>
        <p style={{ fontSize: 12, color: 'var(--text-desc)', margin: 0 }} data-testid="model-picker-empty">
          {requiredInputs.includes('mask')
            ? '当前没有支持遮罩重绘的模型，稍后再试。'
            : '该能力当前没有可用模型，稍后再试。'}
        </p>
      </div>
    );
  }

  return (
    <div className={`pk-settings-group${className ? ` ${className}` : ''}`} data-testid="model-picker">
      <strong className="pk-settings-group-label">模型</strong>
      <div className="pk-resolution-grid">
        {candidates.map((model) => {
          const active = model.id === selectedId;
          return (
            <Button
              key={model.id}
              type="text"
              data-testid="model-option"
              data-model-id={model.id}
              data-available={model.available ? 'true' : 'false'}
              className={`pk-resolution-option${active ? ' pk-option-active' : ''}`}
              aria-pressed={active}
              disabled={!model.available}
              title={model.description || (model.available ? model.name : '当前无可用线路')}
              onClick={() => {
                if (!model.available) return;
                setSelectedId(model.id);
                writeSelectedModelId(capability, model.id);
              }}
            >
              <strong>
                {model.icon ? `${model.icon} ` : ''}
                {model.name}
              </strong>
              <span>{model.available ? priceText(model) : '暂不可用'}</span>
            </Button>
          );
        })}
      </div>
      {selected && options && (
        <p style={{ fontSize: 12, color: 'var(--text-desc)', margin: '6px 0 0' }} data-testid="model-quote">
          {quote && quote.amountMicrocredits !== null
            ? `本次约 ${toCredits(quote.amountMicrocredits)} 积分${quote.estimated ? '（预估）' : ''}`
            : quoteFailed
              ? '当前参数下价格待定'
              : '正在计算价格…'}
        </p>
      )}
    </div>
  );
}
