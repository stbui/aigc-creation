import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button, Result } from 'antd';

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
}

/**
 * 全局错误边界: 兜住渲染期异常, 避免整页白屏。
 * React 只能捕获渲染/生命周期/构造中的错误, 事件回调与异步错误不在此列
 * (那类错误由各处的 try/catch 与 message 提示处理)。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // 开发期保留完整现场, 生产环境可在此接入上报
    console.error('[ErrorBoundary] 渲染异常', error, info.componentStack);
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
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);

    return (
      <div className="app-boot">
        <Result
          status="error"
          title="页面出现异常"
          subTitle={error.message || '渲染时发生未知错误，可尝试刷新或返回工作台。'}
          extra={[
            <Button type="primary" key="retry" onClick={this.reset}>
              重试
            </Button>,
            <Button key="home" onClick={() => (window.location.href = '/workbench')}>
              返回工作台
            </Button>,
          ]}
        />
      </div>
    );
  }
}
