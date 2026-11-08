import { describe, expect, it } from 'vitest';
import {
  deleteBlockedReason,
  perCreditYuanText,
  validDaysText,
  yuanTextToCents,
} from './utils';

describe('validDaysText', () => {
  it('0 天是「永久有效」，不是「0 天」', () => {
    expect(validDaysText(0)).toBe('永久有效');
  });

  it('有限期按天显示', () => {
    expect(validDaysText(365)).toBe('365 天');
  });
});

describe('perCreditYuanText', () => {
  it('按分 / 积分折算，保留四位小数', () => {
    expect(perCreditYuanText(990, 500)).toBe('¥0.0198');
  });

  it('整数价不省略尾零，同排卡片的数字对齐', () => {
    expect(perCreditYuanText(1000, 100)).toBe('¥0.1000');
  });

  it('免费商品没有可比单价，返回 null 让调用方换文案', () => {
    expect(perCreditYuanText(0, 100)).toBeNull();
  });

  it('不发积分的商品同样返回 null，不写除零结果', () => {
    expect(perCreditYuanText(990, 0)).toBeNull();
  });
});

describe('deleteBlockedReason', () => {
  it('从没卖出过的 SKU 可以删', () => {
    expect(deleteBlockedReason({ orderCount: 0 })).toBeNull();
  });

  it('有历史订单时给出去处，而不是只说不能删', () => {
    expect(deleteBlockedReason({ orderCount: 3 })).toBe(
      '该商品已有 3 笔历史订单，不能删除；请改为下架',
    );
  });
});

describe('yuanTextToCents', () => {
  it('两位小数按分收口', () => {
    expect(yuanTextToCents('9.9')).toBe(990);
  });

  it('非法输入返回 null，不静默兜底成 0', () => {
    expect(yuanTextToCents('9.999')).toBeNull();
    expect(yuanTextToCents('')).toBeNull();
  });
});
