import type { ValidationError } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { firstValidationMessage } from './app-validation.pipe';

describe('firstValidationMessage', () => {
  it('优先返回第一层字段的约束消息', () => {
    const errors = [
      {
        property: 'page',
        constraints: { isInt: '页码必须是整数' },
      },
    ] as ValidationError[];

    expect(firstValidationMessage(errors)).toBe('页码必须是整数');
  });

  it('递归返回嵌套字段的约束消息', () => {
    const errors = [
      {
        property: 'filter',
        children: [
          {
            property: 'status',
            constraints: { isEnum: '状态不合法' },
          },
        ],
      },
    ] as ValidationError[];

    expect(firstValidationMessage(errors)).toBe('状态不合法');
  });

  it('没有约束消息时返回稳定兜底文案', () => {
    expect(firstValidationMessage([])).toBe('参数校验失败');
  });
});
