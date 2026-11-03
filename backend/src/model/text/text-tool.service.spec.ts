import { describe, expect, it, vi } from 'vitest';
import { TextToolService } from './text-tool.service';

describe('TextToolService 用户提示', () => {
  it('没有可用文字线路时不暴露内部配置用语', async () => {
    const prisma = {
      channelModel: { findMany: vi.fn().mockResolvedValue([]) },
      modelChannel: { findMany: vi.fn() },
    };
    const service = new TextToolService(prisma as never, {} as never, {} as never);

    const error = await service
      .generate({ operation: 'prompt_polish', instructions: '润色提示词' })
      .then(
        () => null,
        (caught: unknown) => caught as Error,
      );

    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toBe('文字处理暂时不可用，请稍后再试');
    expect(error?.message).not.toMatch(/text|渠道|模型|配置/i);
  });
});
