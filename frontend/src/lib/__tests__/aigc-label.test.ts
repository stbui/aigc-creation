import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicAigcLabel } from '../../types/api';

/**
 * AIGC 标识配置：色值换算、样式映射、加载与缓存。
 *
 * 合规相关的两条硬约束在这里守：
 *   1. 配置请求失败必须回落内置文案，不能因为一次网络错误就不显示角标；
 *   2. 缓存是模块级的，一页里多个视频只能发一次请求（force 除外）。
 */

const LABEL: PublicAigcLabel = {
  enabled: true,
  text: 'AI 生成',
  textColor: '#ffffff',
  backgroundColor: '#5546d8',
  backgroundOpacity: 72,
  radius: 18,
  dotColor: '#5546d8',
  position: 'bottom-right',
};

async function loadModule() {
  return import('../aigc-label');
}

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('hexToRgba', () => {
  it('把 #rrggbb + 0-100 不透明度转成 rgba()', async () => {
    const { hexToRgba } = await loadModule();
    expect(hexToRgba('#5546d8', 72)).toBe('rgba(85, 70, 216, 0.72)');
  });

  it('接受大写与 0 / 100 两个端点', async () => {
    const { hexToRgba } = await loadModule();
    expect(hexToRgba('#FFFFFF', 0)).toBe('rgba(255, 255, 255, 0)');
    expect(hexToRgba('#000000', 100)).toBe('rgba(0, 0, 0, 1)');
  });

  it('非法色值回落到默认深色底，不返回透明', async () => {
    const { hexToRgba } = await loadModule();
    expect(hexToRgba('red', 50)).toBe('rgba(23, 26, 43, 0.5)');
    expect(hexToRgba('#fff', 50)).toBe('rgba(23, 26, 43, 0.5)');
  });
});

describe('aigcBadgeStyle', () => {
  it('按 2x 位图与 12px 播放器角标的比例折算圆角', async () => {
    const { aigcBadgeStyle } = await loadModule();
    expect(aigcBadgeStyle(LABEL)).toEqual({
      background: 'rgba(85, 70, 216, 0.72)',
      color: '#ffffff',
      borderRadius: 5,
    });
  });

  it('圆角不小于 2，避免小字号变成胶囊', async () => {
    const { aigcBadgeStyle } = await loadModule();
    expect(aigcBadgeStyle({ ...LABEL, radius: 1 }).borderRadius).toBe(2);
  });
});

describe('loadAigcLabel', () => {
  it('成功响应剥掉统一信封并写入缓存，后续调用不再发请求', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, data: LABEL, message: '' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { loadAigcLabel } = await loadModule();
    const first = await loadAigcLabel();
    const second = await loadAigcLabel();

    expect(first).toEqual(LABEL);
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('/api/v1/aigc-label');
  });

  it('force=true 绕过缓存重新拉取', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, data: LABEL }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { loadAigcLabel } = await loadModule();
    await loadAigcLabel();
    await loadAigcLabel(true);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('并发调用共享同一个 in-flight 请求', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, data: LABEL }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { loadAigcLabel } = await loadModule();
    const [a, b] = await Promise.all([loadAigcLabel(), loadAigcLabel()]);

    expect(a).toBe(b);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('HTTP 失败时回落内置文案，不抛出', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));

    const { loadAigcLabel, AIGC_LABEL_FALLBACK } = await loadModule();
    await expect(loadAigcLabel()).resolves.toEqual(AIGC_LABEL_FALLBACK);
  });

  it('网络异常时同样回落内置文案', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    const { loadAigcLabel, AIGC_LABEL_FALLBACK } = await loadModule();
    await expect(loadAigcLabel()).resolves.toEqual(AIGC_LABEL_FALLBACK);
  });

  it('失败不写缓存：下一次调用会重新尝试', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ code: 0, data: LABEL }) });
    vi.stubGlobal('fetch', fetchMock);

    const { loadAigcLabel, AIGC_LABEL_FALLBACK } = await loadModule();
    await expect(loadAigcLabel()).resolves.toEqual(AIGC_LABEL_FALLBACK);
    await expect(loadAigcLabel()).resolves.toEqual(LABEL);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
