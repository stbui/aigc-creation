import { useCallback, useState } from 'react';

export interface PlatformPreset {
  ratio?: string;
  size?: string;
}

interface Options {
  defaultPlatform?: string;
  defaultRatio: string;
  defaultResolution: string;
  /** 平台 → 默认规格；返回 null 表示该平台没有可用预设 */
  specOf: (platform: string) => PlatformPreset | null;
  /** 是否跟随平台预设比例（详情图的比例独立选择，传 false） */
  trackRatio?: boolean;
}

/**
 * 生成设置：平台 / 比例 / 画质 / 高级设置开合。
 *
 * 用户手动改过比例或画质后，切换平台不再覆盖 —— 平台规格只是默认值，
 * 不能把用户已经调好的设置抢走。商品主图 / 商品详情 / 爆款复刻共用。
 */
export function useGenerationSettings({
  defaultPlatform = 'taobao',
  defaultRatio,
  defaultResolution,
  specOf,
  trackRatio = true,
}: Options) {
  const [platform, setPlatform] = useState(defaultPlatform);
  const [ratio, setRatio] = useState(defaultRatio);
  const [resolution, setResolution] = useState(defaultResolution);
  const [ratioTouched, setRatioTouched] = useState(false);
  const [resolutionTouched, setResolutionTouched] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const changePlatform = useCallback(
    (value: string) => {
      setPlatform(value);
      const spec = specOf(value);
      if (!spec) return;
      if (trackRatio && !ratioTouched && spec.ratio) setRatio(spec.ratio);
      if (!resolutionTouched && spec.size) setResolution(spec.size);
    },
    [specOf, trackRatio, ratioTouched, resolutionTouched],
  );

  const changeRatio = useCallback((value: string) => {
    setRatioTouched(true);
    setRatio(value);
  }, []);

  const changeResolution = useCallback((value: string) => {
    setResolutionTouched(true);
    setResolution(value);
  }, []);

  /** 稳定引用：高级设置浮层的「点外部 / Esc 收起」以它为依赖 */
  const toggleSettings = useCallback(() => setSettingsOpen((open) => !open), []);

  /**
   * 历史回填。只覆盖快照里真实存在的字段；比例 / 画质一旦回填即视为
   * 用户确认过的值，之后切换平台不再覆盖。
   */
  const applySettings = useCallback((next: { ratio?: string; resolution?: string }) => {
    if (next.ratio) {
      setRatio(next.ratio);
      setRatioTouched(true);
    }
    if (next.resolution) {
      setResolution(next.resolution);
      setResolutionTouched(true);
    }
  }, []);

  /**
   * 从历史任务回填整组设置。
   *
   * 与 `changePlatform` 的差别：快照缺失比例 / 画质时**保留当前值**，不能用
   * 平台预设覆盖。因此无论字段是否存在都把 touched 置真 —— 「历史任务没有这个
   * 值」不等于「允许换平台时顺手改掉用户现在选的值」。
   */
  const applySnapshot = useCallback(
    (next: { platform?: string; ratio?: string; resolution?: string }) => {
      if (next.platform) setPlatform(next.platform);
      if (next.ratio) setRatio(next.ratio);
      if (next.resolution) setResolution(next.resolution);
      setRatioTouched(true);
      setResolutionTouched(true);
    },
    [],
  );

  return {
    platform,
    ratio,
    resolution,
    settingsOpen,
    changePlatform,
    changeRatio,
    changeResolution,
    toggleSettings,
    applySettings,
    applySnapshot,
  };
}
