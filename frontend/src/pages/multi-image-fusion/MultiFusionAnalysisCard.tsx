import { Sparkles } from 'lucide-react';

/**
 * AI 分析卡（参考站 S-7：独立成卡）。
 *
 * 「AI 分析」按主体图做真实识图，结果写进可编辑的「画面描述」；
 * 描述也可随时手动展开，不依赖分析成功。留空不报错：
 * 提示词会退回场景版式语义，这与「分析失败」是两回事。
 */
export function MultiFusionAnalysisCard({
  analyzing,
  message,
  descriptionOpen,
  prompt,
  onAnalyze,
  onPromptChange,
  onToggleDescription,
}: {
  analyzing: boolean;
  /** 分析结果的行内提示; null 表示不渲染 */
  message: { kind: 'error' | 'info'; text: string } | null;
  descriptionOpen: boolean;
  prompt: string;
  onAnalyze: () => void;
  onPromptChange: (value: string) => void;
  onToggleDescription: () => void;
}) {
  return (
    <div className="multi-image-fusion-card multi-image-fusion-analysis-card">
      <div className="multi-image-fusion-card-heading compact">
        <div>
          <h2>AI 分析</h2>
        </div>
      </div>
      <button
        type="button"
        className="multi-image-fusion-analyze-button"
        disabled={analyzing}
        onClick={onAnalyze}
      >
        <Sparkles size={14} />
        <span>{analyzing ? '分析中…' : 'AI 分析'}</span>
      </button>
      <button
        type="button"
        className="multi-image-fusion-description-toggle"
        aria-expanded={descriptionOpen}
        aria-controls="multi-image-fusion-prompt"
        onClick={onToggleDescription}
      >
        {descriptionOpen ? '收起画面描述' : prompt.trim() ? '编辑画面描述' : '手动填写画面描述'}
      </button>
      {message && (
        <p className={`multi-image-fusion-message ${message.kind}`} role="status">
          {message.text}
        </p>
      )}
      {/* 手动入口始终可用；分析成功时也会自动展开 */}
      {descriptionOpen && (
        <label className="multi-image-fusion-description" htmlFor="multi-image-fusion-prompt">
          <span>画面描述</span>
          <textarea
            id="multi-image-fusion-prompt"
            className="multi-image-fusion-description-editor"
            rows={6}
            maxLength={4000}
            value={prompt}
            placeholder="分析后生成场景描述，可继续修改"
            onChange={(e) => onPromptChange(e.target.value)}
          />
        </label>
      )}
    </div>
  );
}
