import { MultiFusionOutputSettings } from './MultiFusionOutputSettings';
import { Button, Alert, AlertDescription, Spinner } from './components';

/**
 * 提交区（参考站 §5.13 的 sticky 白底容器）。
 *
 * 2026-11-21 由同时挂 `image-tool-submit-area`（共享 CSS 覆盖游戏）改为
 * shadcn 结构：容器用 `sticky bottom-0` + 卡片底，禁止原因用 `Alert`，
 * 主 CTA 用 shadcn `Button`（全宽 43px 圆角 11px），价格作为按钮内 `small`。
 * 共享 `image-output-settings-*` 的整套实测皮肤随之退场（见 `MultiFusionOutputSettings`）。
 */
export function MultiFusionSubmitBar({
  submitting,
  disabled,
  blockedReason,
  creditLabel,
  settingsOpen,
  ratio,
  resolution,
  onToggleSettings,
  onRatioChange,
  onResolutionChange,
  onSubmit,
}: {
  submitting: boolean;
  /** 主体图 / 搭配图缺失、能力不可用等导致的提交禁用 */
  disabled: boolean;
  /** 能力不可用原因; null 表示不展示提示 */
  blockedReason: string | null;
  /** 提交按钮上的价格口径; null = 能力清单未到，不显示任何占位 */
  creditLabel: string | null;
  settingsOpen: boolean;
  ratio: string;
  resolution: string;
  onToggleSettings: () => void;
  onRatioChange: (value: string) => void;
  onResolutionChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="sticky bottom-0 z-10 mt-auto grid w-full min-w-0 gap-3.5 rounded-xl bg-card px-4 pt-3.5 pb-4">
      <MultiFusionOutputSettings
        open={settingsOpen}
        ratio={ratio}
        resolution={resolution}
        onToggle={onToggleSettings}
        onRatioChange={onRatioChange}
        onResolutionChange={onResolutionChange}
      />

      <Button
        type="button"
        className="h-10.75 w-full gap-1.75 rounded-[11px] text-xs font-bold"
        disabled={disabled}
        onClick={onSubmit}
      >
        {submitting ? (
          <>
            <Spinner className="size-4" />
            <span>生成中…</span>
          </>
        ) : (
          <>
            <span>立即生成</span>
            {/* creditLabel 为 null = 能力清单未到 (加载中)。
                此时不显示任何价格占位 —— "加载中…"放在价格位上会被读成价格文案,
                且用户点下按钮前看不到扣费提示。空着即可, 清单到达后会补上。 */}
            {creditLabel && (
              <small className="text-xs font-normal whitespace-nowrap text-primary-foreground/80">
                {creditLabel}
              </small>
            )}
          </>
        )}
      </Button>

      {blockedReason && (
        <Alert variant="destructive">
          <AlertDescription className="text-xs">{blockedReason}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
