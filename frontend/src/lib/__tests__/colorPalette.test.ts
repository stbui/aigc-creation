import { describe, expect, it } from 'vitest';

import {
  COLOR_HEX,
  COLOR_LABEL,
  DEFAULT_CUSTOM_COLOR,
  MATTING_COLOR_SWATCHES,
  PRESET_COLORS,
  RECOLOR_COLOR_SWATCHES,
  isValidHexColor,
  normalizeHexColor,
  qrColors,
  tokenColor,
} from '../colorPalette';

/**
 * 色板的唯一事实源：两套色板必须从 `PRESET_COLORS` 派生。
 * 这里锁住「改一处、三处同时生效」—— 加一个预设色只需改 PRESET_COLORS。
 */

describe('预设色与两套色板', () => {
  it('五个预设色的色名与色值都是唯一的', () => {
    expect(PRESET_COLORS).toHaveLength(5);
    expect(new Set(PRESET_COLORS.map((c) => c.key)).size).toBe(5);
    expect(new Set(PRESET_COLORS.map((c) => c.hex)).size).toBe(5);
  });

  it('抠图色板 = 透明底 + 预设色，value 用后端色名', () => {
    expect(MATTING_COLOR_SWATCHES[0]).toEqual({ value: 'transparent', label: '透明底', css: 'transparent' });
    expect(MATTING_COLOR_SWATCHES.slice(1)).toEqual(
      PRESET_COLORS.map((c) => ({ value: c.key, label: c.label, css: c.hex })),
    );
  });

  it('换色色板 = 预设色，value 就是 HEX', () => {
    expect(RECOLOR_COLOR_SWATCHES).toEqual(
      PRESET_COLORS.map((c) => ({ value: c.hex, label: c.label, css: c.hex })),
    );
  });

  it('换色默认色（色板第一项）是白色', () => {
    expect(RECOLOR_COLOR_SWATCHES[0].value).toBe('#FFFFFF');
  });
});

describe('色名 / 色值映射', () => {
  it('COLOR_HEX 覆盖透明底与全部色名', () => {
    expect(COLOR_HEX.transparent).toBe('transparent');
    for (const color of PRESET_COLORS) expect(COLOR_HEX[color.key]).toBe(color.hex);
  });

  it('COLOR_LABEL 同时登记色名与色值', () => {
    expect(COLOR_LABEL.transparent).toBe('透明底');
    expect(COLOR_LABEL.custom).toBe('自定义');
    for (const color of PRESET_COLORS) {
      expect(COLOR_LABEL[color.key]).toBe(color.label);
      expect(COLOR_LABEL[color.hex]).toBe(color.label);
    }
  });
});

describe('HEX 归一化', () => {
  it('接受带不带 # 的六位 HEX，统一大写', () => {
    expect(normalizeHexColor('#abcdef')).toBe('#ABCDEF');
    expect(normalizeHexColor('abcdef')).toBe('#ABCDEF');
    expect(normalizeHexColor('  #ABCdef ')).toBe('#ABCDEF');
  });

  it('三位 / 非法值返回 null', () => {
    expect(normalizeHexColor('#fff')).toBeNull();
    expect(normalizeHexColor('white')).toBeNull();
    expect(isValidHexColor('#FFFFFF')).toBe(true);
    expect(isValidHexColor('#FFFFF')).toBe(false);
  });

  it('默认自定义色是品牌紫', () => {
    expect(DEFAULT_CUSTOM_COLOR).toBe('#5546D8');
  });
});

describe('令牌取值', () => {
  it('读取不到令牌时回落（测试环境没有样式表）', () => {
    expect(tokenColor('--brand', '#5546D8')).toBe('#5546D8');
    // 令牌存在时返回令牌值，空白会被裁掉
    document.documentElement.style.setProperty('--brand', ' #123456 ');
    expect(tokenColor('--brand', '#5546D8')).toBe('#123456');
    document.documentElement.style.removeProperty('--brand');
  });

  it('二维码前景 / 背景回落为标题色与白卡', () => {
    expect(qrColors()).toEqual({ dark: '#171A2B', light: '#FFFFFF' });
  });
});
