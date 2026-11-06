import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { AigcLabelSpecDto } from './aigc-label.controller';

const VALID_SPEC = {
  text: 'AI 生成',
  fontFamily: 'sans-serif',
  fontSize: 40,
  fontWeight: 600,
  letterSpacing: 2,
  textColor: '#ffffff',
  backgroundColor: '#171a2b',
  backgroundOpacity: 72,
  radius: 18,
  paddingX: 26,
  dotColor: '#5546d8',
  position: 'bottom-right',
  scalePercent: 16,
  minWidthPx: 64,
  maxWidthPx: 276,
  marginPercent: 1.5,
  opacity: 100,
} as const;

describe('AigcLabelSpecDto', () => {
  it('接受整数字距', async () => {
    const dto = plainToInstance(AigcLabelSpecDto, VALID_SPEC);

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('拒绝小数位字距', async () => {
    const dto = plainToInstance(AigcLabelSpecDto, { ...VALID_SPEC, letterSpacing: 2.5 });

    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'letterSpacing')).toBe(true);
  });
});
