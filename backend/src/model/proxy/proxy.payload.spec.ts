import { describe, expect, it } from 'vitest';
import { ensureChatCompletionStreamUsage } from './proxy.payload';

const body = (value: unknown): Buffer => Buffer.from(JSON.stringify(value));

describe('ensureChatCompletionStreamUsage', () => {
  it('非流式请求原样返回，不改变接口合同', () => {
    const original = body({ model: 'gpt-4o', messages: [] });
    expect(ensureChatCompletionStreamUsage(original)).toBe(original);
  });

  it('流式请求补上 include_usage', () => {
    const parsed = JSON.parse(ensureChatCompletionStreamUsage(body({ model: 'gpt-4o', stream: true })).toString());
    expect(parsed.stream_options).toEqual({ include_usage: true });
  });

  it('保留已有的 stream_options 字段', () => {
    const parsed = JSON.parse(
      ensureChatCompletionStreamUsage(body({ stream: true, stream_options: { foo: 1 } })).toString(),
    );
    expect(parsed.stream_options).toEqual({ foo: 1, include_usage: true });
  });

  it('拒绝非法 JSON 与非对象报文', () => {
    expect(() => ensureChatCompletionStreamUsage(Buffer.from('not json'))).toThrow('请求报文不是合法 JSON');
    expect(() => ensureChatCompletionStreamUsage(body([1, 2]))).toThrow('请求报文必须是 JSON 对象');
  });

  it('拒绝非对象的 stream_options', () => {
    expect(() => ensureChatCompletionStreamUsage(body({ stream: true, stream_options: [] }))).toThrow(
      'stream_options 必须是 JSON 对象',
    );
  });
});
