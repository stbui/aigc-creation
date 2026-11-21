import { Sparkles } from 'lucide-react';

import {
  Button,
  Field,
  FieldLabel,
  InlineAlert,
  InlineAlertDescription,
  Surface,
  SurfaceContent,
  SurfaceHeader,
  SurfaceTitle,
  TextAction,
  Textarea,
} from './components';

/**
 * AI 分析卡（参考站 S-7：独立成卡）。
 *
 * 「AI 分析」按主体图做真实识图，结果写进可编辑的「画面描述」；
 * 描述也可随时手动展开，不依赖分析成功。留空不报错：
 * 提示词会退回场景版式语义，这与「分析失败」是两回事。
 *
 * 组件视觉走 shadcn：卡片 `Surface`、主 CTA `Button`、展开入口 `TextAction`、
 * 行内提示 `InlineAlert`、描述编辑 `Field` + `Textarea`。
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
    <Surface className="gap-0 rounded-xl border-border/70 bg-card px-4.5 py-4 shadow-card">
      <SurfaceHeader className="mb-3 px-0">
        <SurfaceTitle className="text-sm leading-5.5 font-bold text-foreground">
          AI 分析
        </SurfaceTitle>
      </SurfaceHeader>

      <SurfaceContent className="flex flex-col items-start gap-0 px-0">
        <Button
          type="button"
          className="h-9 w-full gap-1.5 rounded-md text-xs font-semibold shadow-card"
          disabled={analyzing}
          onClick={onAnalyze}
        >
          <Sparkles aria-hidden />
          {analyzing ? '分析中…' : 'AI 分析'}
        </Button>

        <TextAction
          className="mt-2.5 px-0"
          aria-expanded={descriptionOpen}
          aria-controls="multi-image-fusion-prompt"
          onClick={onToggleDescription}
        >
          {descriptionOpen ? '收起画面描述' : prompt.trim() ? '编辑画面描述' : '手动填写画面描述'}
        </TextAction>

        {message && (
          <InlineAlert
            className="mt-2 w-full"
            variant={message.kind === 'error' ? 'destructive' : 'default'}
            role="status"
          >
            <InlineAlertDescription className="text-xs">{message.text}</InlineAlertDescription>
          </InlineAlert>
        )}

        {/* 手动入口始终可用；分析成功时也会自动展开 */}
        {descriptionOpen && (
          <Field className="mt-3 gap-1.5">
            <FieldLabel
              htmlFor="multi-image-fusion-prompt"
              className="text-xs font-semibold text-foreground"
            >
              画面描述
            </FieldLabel>
            <Textarea
              id="multi-image-fusion-prompt"
              rows={6}
              maxLength={4000}
              value={prompt}
              placeholder="分析后生成场景描述，可继续修改"
              className="max-h-80 min-h-40 resize-y bg-muted text-xs leading-5.25"
              onChange={(event) => onPromptChange(event.target.value)}
            />
          </Field>
        )}
      </SurfaceContent>
    </Surface>
  );
}
