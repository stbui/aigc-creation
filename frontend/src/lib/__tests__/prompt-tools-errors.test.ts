import { afterEach, describe, expect, it, vi } from 'vitest';
import { promptToolsApi, type ApiError } from '../api';
import { promptToolErrorMessage } from '../promptToolMessages';

const REQUEST_ID = '65edfbca-0ed8-4171-bf21-2bdad67c0c83';

function errorResponse(message: string): Response {
  return {
    ok: false,
    status: 502,
    headers: new Headers({ 'X-Request-Id': REQUEST_ID }),
    json: async () => ({ code: 50201, data: null, message, requestId: REQUEST_ID }),
  } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('提示词工具的用户提示', () => {
  it('服务不可用时只显示自然语言，不把请求号和技术名称带到界面', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errorResponse('文字处理暂时不可用，请稍后再试')));

    const caught = await promptToolsApi
      .polish('把背景换成暖色')
      .then(() => null, (error: unknown) => error as ApiError);

    expect(caught?.message).toBe('文字处理暂时不可用，请稍后再试');
    expect(caught?.message).not.toMatch(/text|渠道|模型|配置|请求号/i);
    expect(caught?.message).not.toContain(REQUEST_ID);
    // 界面上不展示，但仍保留给后台日志关联。
    expect(caught?.requestId).toBe(REQUEST_ID);
  });

  it('网络异常时显示友好的中文兜底文案', () => {
    expect(promptToolErrorMessage(new TypeError('Failed to fetch'), 'image')).toBe(
      '图片分析暂时不可用，请稍后再试',
    );
  });

  it('未登录时提示先登录', () => {
    expect(promptToolErrorMessage({ status: 401 }, 'polish')).toBe('请先登录');
  });

  it('技术英文报错不会进入界面', () => {
    expect(
      promptToolErrorMessage(
        Object.assign(new Error('model gateway unavailable'), { status: 400 }),
        'polish',
      ),
    ).toBe('润色暂时不可用，请稍后再试');
  });

  it('普通英文报错也不会进入界面', () => {
    expect(
      promptToolErrorMessage(Object.assign(new Error('Invalid input'), { status: 400 }), 'image'),
    ).toBe('图片分析暂时不可用，请稍后再试');
  });
});
