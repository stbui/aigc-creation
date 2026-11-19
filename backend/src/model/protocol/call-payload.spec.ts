import { describe, expect, it } from 'vitest';
import {
  CALL_PAYLOAD_PREVIEW_CHARS,
  previewCallPayload,
  previewCallText,
  truncateCallPayload,
} from './call-payload';

describe('调用记录报文预览', () => {
  it('保留提示词与正文原文，不按字段名抹掉', () => {
    const text = previewCallPayload({
      model: 'gpt-image-1',
      prompt: '一只在雨中的橘猫，胶片质感',
      messages: [{ role: 'system', content: '你是提示词润色助手' }],
      api_key: 'sk-user-supplied',
      authorization: 'Bearer abc',
    });
    const parsed = JSON.parse(text);
    expect(parsed.prompt).toBe('一只在雨中的橘猫，胶片质感');
    expect(parsed.messages[0].content).toBe('你是提示词润色助手');
    // 管理端要能看到请求里到底带了什么，不再出现 [REDACTED]
    expect(parsed.api_key).toBe('sk-user-supplied');
    expect(text).not.toContain('[REDACTED]');
  });

  it('折叠内嵌 base64 图片，避免整张图入库', () => {
    const image = `data:image/png;base64,${'A'.repeat(200)}`;
    const text = previewCallPayload({ prompt: 'hi', image });
    expect(text).toContain('data:image/png;base64,…');
    expect(text).not.toContain('A'.repeat(64));
  });

  it('超长报文按上限截断并写明原始长度', () => {
    const long = 'a'.repeat(CALL_PAYLOAD_PREVIEW_CHARS + 10);
    const cut = truncateCallPayload(long);
    expect(cut.length).toBeLessThanOrEqual(CALL_PAYLOAD_PREVIEW_CHARS);
    expect(cut).toContain(`[报文已截断，原始长度 ${long.length} 字符]`);
  });

  it('不会把代理对切成半个字符', () => {
    const text = `${'a'.repeat(9)}😀tail`;
    const cut = truncateCallPayload(text, 10);
    expect(cut.startsWith(`${'a'.repeat(9)}…`)).toBe(true);
  });

  it('非 JSON 响应原样保留，二进制只报体积', () => {
    expect(previewCallText('plain upstream text')).toBe('plain upstream text');
    expect(previewCallPayload(Buffer.from('abc'))).toBe('<binary 3 bytes>');
  });
});