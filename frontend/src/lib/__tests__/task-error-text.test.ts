import { describe, expect, it } from 'vitest';

import { taskErrorLabel } from '../admin-error-codes';
import { taskErrorText } from '../constants';

const TASK_CODES = ['42201', '42202', '42203', '42204', '42205', '42206'];

describe('taskErrorText', () => {
  it('returns user-facing copy for every task failure code', () => {
    for (const code of TASK_CODES) {
      expect(taskErrorText(code)).not.toBe(code);
    }
  });

  it('does not expose unknown numeric codes to users', () => {
    expect(taskErrorText('49999')).not.toBe('49999');
    expect(taskErrorText('49999')).toContain('任务未完成');
  });

  it('uses the same fallback when the code is missing', () => {
    expect(taskErrorText(null)).toContain('任务未完成');
    expect(taskErrorText(undefined)).toContain('任务未完成');
  });
});

describe('taskErrorLabel', () => {
  it('covers every task failure code', () => {
    for (const code of TASK_CODES) {
      expect(taskErrorLabel(code)).not.toBe(code);
    }
  });

  it('keeps unknown codes visible for administrators', () => {
    expect(taskErrorLabel('49999')).toBe('49999');
  });
});
