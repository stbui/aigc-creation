import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ExceptionPage } from './ExceptionPage';

interface Props {
  children: ReactNode;
  /**
   * 变化时自动清除错误状态 (通常传当前路由 path)。
   * 用户从崩溃页面切走后, 新页面不应继续显示上一页的错误兜底。
   */
  resetKeys?: unknown[];
  /** 自定义兜底渲染 */
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
  /** componentStack 存 state 而非仅日志: 展开技术详情时需要一并展示, 用户才能把现场反馈给开发 */
  stack: string;
}

/**
 * 全局错误边界: 兜住渲染期异常, 避免整页白屏。
 * React 只能捕获渲染/生命周期/构造中的错误, 事件回调与异步错误不在此列
 * (那类错误由各处的 try/catch 与 message 提示处理)。
 *
 * 2026-10-20: 兜底 UI 从 antd <Result> 换成 ExceptionPage。此前把 error.message
 * 直接当副标题展示, 用户看到的是 "Objects are not valid as a React child"
 * 这类内部文案 —— 既看不懂也无处可去。现在主文案说人话, 原始 message +
 * componentStack 收进默认收起的「技术详情」, 可一键复制。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, stack: '' };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // 开发期保留完整现场, 生产环境可在此接入上报
    console.error('[ErrorBoundary] 渲染异常', error, info.componentStack);
    // componentStack 由 React 在 didCatch 阶段补齐, getDerivedStateFromError 拿不到
    this.setState({ stack: info.componentStack ?? '' });
  }

  componentDidUpdate(prev: Props): void {
    if (!this.state.error) return;
    const changed =
      !prev.resetKeys ||
      !this.props.resetKeys ||
      prev.resetKeys.length !== this.props.resetKeys.length ||
      this.props.resetKeys.some((k, i) => k !== prev.resetKeys![i]);
    if (changed) this.reset();
  }

  reset = (): void => {
    this.setState({ error: null, stack: '' });
  };

  render(): ReactNode {
    const { error, stack } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);

    return (
      <ExceptionPage
        kind="error"
        fullScreen
        title="页面渲染出错"
        desc="当前页面遇到了一个未预期的错误。可以重试，若仍然失败请回到工作台，或把下方技术详情反馈给我们。"
        detail={[error.message, error.stack, stack].filter(Boolean).join('\n\n')}
        footnote="重试只会重新渲染本页，已上传的素材与已生成的作品不会丢失。"
        action={
          <button type="button" className="exc-btn is-primary" onClick={this.reset}>
            重试
          </button>
        }
        secondaryAction={{
          to: '/workbench',
          label: '返回工作台',
        }}
      />
    );
  }
}
