import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { StateButton, StateEmpty, StateError, StateLoading, StateSkeleton } from '../StateViews';

/**
 * 全站状态组件。
 *
 * 这里守的是「状态语义」而不是样式：失败态有 role=alert、加载态有 role=status、
 * 失败必须给出重试出口、空态的主动作能点。样式（间距/配色）由截图与 E2E 管。
 */
describe('StateError', () => {
  it('渲染失败语义、技术细节与重试出口', async () => {
    const onRetry = vi.fn();
    render(<StateError desc="网络不通" detail="HTTP 500" onRetry={onRetry} />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('加载失败')).toBeInTheDocument();
    expect(screen.getByText('网络不通')).toBeInTheDocument();
    expect(screen.getByText('HTTP 500')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /重试/ }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('没有 onRetry 时不渲染重试按钮', () => {
    render(<StateError desc="加载失败" />);
    expect(screen.queryByRole('button', { name: /重试/ })).not.toBeInTheDocument();
  });

  it('compact 模式不渲染插画，适合弹窗/小卡片', () => {
    const { container } = render(<StateError compact title="操作失败" />);
    expect(container.querySelector('svg')).toBeNull();
    expect(screen.getByText('操作失败')).toBeInTheDocument();
  });
});

describe('StateEmpty', () => {
  it('渲染标题、说明与主动作', async () => {
    const onClick = vi.fn();
    render(
      <StateEmpty
        title="还没有作品"
        desc="生成的第一张图会出现在这里"
        action={<button onClick={onClick}>去创作</button>}
      />,
    );

    expect(screen.getByText('还没有作品')).toBeInTheDocument();
    expect(screen.getByText('生成的第一张图会出现在这里')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '去创作' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('compact 模式去掉插画', () => {
    const { container } = render(<StateEmpty title="空" compact />);
    expect(container.querySelector('svg')).toBeNull();
  });
});

describe('StateLoading', () => {
  it('暴露 role=status 与可读文案，不只靠转圈', () => {
    render(<StateLoading tip="正在加载能力清单…" />);

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent('正在加载能力清单…');
  });

  it('full / small 只影响类名', () => {
    const { container } = render(<StateLoading full size="small" />);
    expect(container.querySelector('.state-loading')).toHaveClass('is-full');
    expect(container.querySelector('.state-spinner')).toHaveClass('is-small');
  });
});

describe('StateSkeleton', () => {
  it('按 count 渲染占位项，并对辅助技术隐藏', () => {
    const { container } = render(<StateSkeleton variant="card" count={3} />);

    expect(container.querySelector('.state-skeleton')).toHaveAttribute('aria-hidden');
    expect(container.querySelectorAll('.state-skeleton-item')).toHaveLength(3);
  });

  it('columns 通过 CSS 变量传入，避免内联重复布局逻辑', () => {
    const { container } = render(<StateSkeleton columns={4} />);
    const root = container.querySelector('.state-skeleton') as HTMLElement;
    expect(root.style.getPropertyValue('--skeleton-columns')).toBe('4');
  });

  it('block 变体渲染可见占位块，而不是空容器', () => {
    const { container } = render(<StateSkeleton variant="block" count={1} />);

    expect(container.querySelectorAll('.state-skeleton-block')).toHaveLength(1);
  });
});

describe('StateButton', () => {
  it('disabled 时不可点击', async () => {
    const onClick = vi.fn();
    render(
      <StateButton onClick={onClick} disabled>
        不可用
      </StateButton>,
    );

    await userEvent.click(screen.getByRole('button', { name: '不可用' }));
    expect(onClick).not.toHaveBeenCalled();
  });
});
