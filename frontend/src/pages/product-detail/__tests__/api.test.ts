import { afterEach, describe, expect, it, vi } from 'vitest';

import { generateApi, startDetailGeneration } from '../api';

describe('startDetailGeneration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('一次提交只发送模块选择，提示词由后端模板统一生成', async () => {
    const start = vi.spyOn(generateApi, 'start').mockResolvedValue({ taskId: 'task-1' });

    await startDetailGeneration({
      projectId: 'project-1',
      modelKey: 'model-1',
      inputAssetIds: ['asset-1'],
      productName: ' 轻音循环扇 ',
      brand: ' 清风 ',
      platform: 'taobao',
      language: 'zh-CN',
      description: ' 三档风速 ',
      sections: ['hero', 'selling_points'],
      ratio: '3:4',
      resolution: '1k',
    });

    expect(start).toHaveBeenCalledOnce();
    const request = start.mock.calls[0][0];
    expect(request.params).not.toHaveProperty('sectionPrompts');
    expect(request.params.sections).toBe('hero,selling_points');
  });
});
