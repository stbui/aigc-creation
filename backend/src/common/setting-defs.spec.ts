import { describe, expect, it } from 'vitest';

import { findSettingDef, validateSettingValue } from './setting-defs';

function defOf(key: string) {
  const def = findSettingDef(key);
  if (!def) throw new Error(`missing setting definition: ${key}`);
  return def;
}

describe('上传限制设置定义', () => {
  it.each(['upload.maxSizeMb', 'upload.maxPixels'])('%s 拒绝小数', (key) => {
    const def = defOf(key);
    expect(() => validateSettingValue(def, 12.5)).toThrow('必须是整数');
  });

  it('上传大小与像素总量仍按各自范围校验', () => {
    expect(() => validateSettingValue(defOf('upload.maxSizeMb'), 101)).toThrow(
      '不得大于 100',
    );
    expect(() => validateSettingValue(defOf('upload.maxPixels'), 999_999)).toThrow(
      '不得小于 1000000',
    );
  });
});
