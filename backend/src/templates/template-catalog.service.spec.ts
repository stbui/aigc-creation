import { describe, expect, it } from 'vitest';

import { normalizeTemplateTags, parseTemplateTags } from './template-catalog.service';

describe('写真模板标签', () => {
  it('解析 JSON 数组；坏数据回落空数组', () => {
    expect(parseTemplateTags('["龙凤褂","中式"]')).toEqual(['龙凤褂', '中式']);
    expect(parseTemplateTags(null)).toEqual([]);
    expect(parseTemplateTags('not-json')).toEqual([]);
    expect(parseTemplateTags('{"a":1}')).toEqual([]);
    expect(parseTemplateTags('[1,"ok",""]')).toEqual(['ok']);
  });

  it('归一化：去空白、去重、单条截断、最多 8 条', () => {
    const raw = ['  龙凤褂 ', '龙凤褂', '', '  ', '中式', ...Array.from({ length: 10 }, (_, i) => `标签${i}`)];
    const parsed = parseTemplateTags(normalizeTemplateTags(raw));
    expect(parsed).toHaveLength(8);
    expect(parsed[0]).toBe('龙凤褂');
    expect(parsed[1]).toBe('中式');
    expect(new Set(parsed).size).toBe(parsed.length);
  });

  it('超长标签截断到 20 字', () => {
    const parsed = parseTemplateTags(normalizeTemplateTags(['一'.repeat(30)]));
    expect(parsed[0]).toHaveLength(20);
  });
});
