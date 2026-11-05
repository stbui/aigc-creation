import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  ChannelHeadersEditor,
} from '../ChannelHeadersEditor';
import {
  DEFAULT_USER_AGENT,
  normalizeChannelHeaders,
  validateChannelHeaders,
} from '../utils';

/**
 * 自定义请求头编辑器的校验口径。
 *
 * 这些规则在后端 `normalizeOutboundHeaders` 已经强制执行，前端复刻一份的目的
 * 是**在保存前指出是哪一行**，不是放宽或加严。用例锁住三件事：
 *   1. 系统托管的头（鉴权 / 协议 / `x-forwarded-*`）一律拒绝；
 *   2. 名称大小写不敏感去重 —— `X-Trace` 与 `x-trace` 是同一个头；
 *   3. 空行不算错误，否则点了「添加请求头」还没填就被报错。
 */

describe('validateChannelHeaders', () => {
  it('没有请求头时通过', () => {
    expect(validateChannelHeaders([])).toBe('');
  });

  it('空行（名称与值都为空）不算错误', () => {
    expect(validateChannelHeaders([{ name: '', value: '' }])).toBe('');
  });

  it('允许普通的自定义请求头', () => {
    expect(validateChannelHeaders([{ name: 'x-api-version', value: '2' }])).toBe('');
  });

  it('拒绝系统托管的请求头', () => {
    expect(validateChannelHeaders([{ name: 'Authorization', value: 'Bearer x' }])).toContain('由系统管理');
    expect(validateChannelHeaders([{ name: 'content-type', value: 'application/json' }])).toContain('由系统管理');
    expect(validateChannelHeaders([{ name: 'x-forwarded-for', value: '1.2.3.4' }])).toContain('由系统管理');
    expect(validateChannelHeaders([{ name: 'x-canvas-trace', value: '1' }])).toContain('由系统管理');
  });

  it('名称大小写不敏感去重', () => {
    expect(
      validateChannelHeaders([
        { name: 'X-Trace', value: 'a' },
        { name: 'x-trace', value: 'b' },
      ]),
    ).toContain('不能重复');
  });

  it('拒绝非法名称', () => {
    expect(validateChannelHeaders([{ name: 'bad header', value: 'x' }])).toContain('名称无效');
    expect(validateChannelHeaders([{ name: '头', value: 'x' }])).toContain('名称无效');
  });

  it('拒绝值中的控制字符，但允许横向制表符', () => {
    expect(validateChannelHeaders([{ name: 'x-a', value: 'a\nb' }])).toContain('不支持的字符');
    expect(validateChannelHeaders([{ name: 'x-a', value: 'a\tb' }])).toBe('');
  });

  it('拒绝超长名称与值', () => {
    expect(validateChannelHeaders([{ name: `x-${'a'.repeat(130)}`, value: '1' }])).toContain('过长');
    expect(validateChannelHeaders([{ name: 'x-a', value: 'a'.repeat(4097) }])).toContain('过长');
  });

  it('拒绝超过 32 项', () => {
    const headers = Array.from({ length: 33 }, (_, index) => ({ name: `x-h${index}`, value: '1' }));
    expect(validateChannelHeaders(headers)).toContain('最多支持 32 项');
  });
});

describe('normalizeChannelHeaders', () => {
  it('裁掉首尾空白并丢弃空行；只有名称的行保留（空值是合法请求头）', () => {
    expect(
      normalizeChannelHeaders([
        { name: ' x-api-version ', value: ' 2 ' },
        { name: '', value: '' },
        { name: ' x-trace ', value: '  ' },
      ]),
    ).toEqual([
      { name: 'x-api-version', value: '2' },
      { name: 'x-trace', value: '' },
    ]);
  });
});

describe('ChannelHeadersEditor', () => {
  it('按行渲染名称与值，并对疑似凭据的值遮起来', () => {
    const { container } = render(
      <ChannelHeadersEditor
        value={[
          { name: 'x-api-version', value: '2' },
          { name: 'x-auth-token', value: 'secret' },
        ]}
        onChange={() => {}}
      />,
    );
    expect(screen.getByLabelText('附加信息 1 名称')).toBeTruthy();
    expect(screen.getByLabelText('附加信息 1 内容').getAttribute('type')).toBe('text');
    expect(screen.getByLabelText('附加信息 2 内容').getAttribute('type')).toBe('password');
    expect(container.textContent).toContain('2/32 项');
  });

  it('添加 / 删除请求头会回写数组', () => {
    const onChange = vi.fn();
    const { rerender } = render(<ChannelHeadersEditor value={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '添加附加信息' }));
    expect(onChange).toHaveBeenCalledWith([{ name: '', value: '' }]);

    rerender(
      <ChannelHeadersEditor value={[{ name: 'x-a', value: '1' }]} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '删除附加信息 1' }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('没有 User-Agent 时提供快捷添加，添加后按钮消失', () => {
    const onChange = vi.fn();
    const { rerender } = render(<ChannelHeadersEditor value={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '添加客户端标识' }));
    expect(onChange).toHaveBeenCalledWith([{ name: 'User-Agent', value: DEFAULT_USER_AGENT }]);

    rerender(
      <ChannelHeadersEditor
        value={[{ name: 'user-agent', value: DEFAULT_USER_AGENT }]}
        onChange={onChange}
      />,
    );
    expect(screen.queryByRole('button', { name: '添加客户端标识' })).toBeNull();
  });
});
