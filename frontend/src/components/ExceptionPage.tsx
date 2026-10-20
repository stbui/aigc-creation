import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, Copy, Home, RotateCcw } from 'lucide-react';
import { StateIllustration } from './illustrations';

/**
 * 全站统一异常页。
 *
 * 2026-10-20 抽取。此前异常态散落 7 处各写一遍 antd `<Result>`:
 *   ErrorBoundary.tsx / App.tsx 能力清单 / ToolPage ×2 / AdminDashboard ×2 / AdminWidgets。
 * 问题是三重的:
 *   1. **视觉脱节** —— 项目配了品牌紫 antd token、77 个语义 token、自绘了
 *      `ToolEmptyIllustration`, 但异常页用的是 antd Result 默认插画 (灰蓝图标),
 *      与站内自绘插画不是一个设计语言。
 *   2. **技术信息直给用户** —— ErrorBoundary 直接把 `error.message` 当 subTitle 展示,
 *      用户看到的是 "Objects are not valid as a React child" 这类内部文案, 无从处置。
 *   3. **操作出口不一致** —— 有的给「重试」有的给「返回工作台」, 有的一个都没有
 *      (如 ToolPage 能力不存在 / AdminDashboard 未开放), 用户只能改地址栏。
 *
 * 本组件统一: 插画 + 人话标题/描述 + 可折叠技术详情 + 明确的下一步出口。
 */

/** 异常语义。决定插画配色与徽标符号, 不决定业务文案 (业务文案由调用方传入)。 */
export type ExceptionKind = 'error' | 'warning' | 'info' | 'not-found';

/** 操作项: 传字符串视为站内路由 (渲染为 Link), 否则原样作为节点 (通常是 <button>) */
export type ExceptionAction = ReactNode | { to: string; label: string } | undefined;

interface Props {
  kind?: ExceptionKind;
  /** 主标题: 说清「发生了什么」, 不说「出错了」 */
  title: string;
  /** 副标题: 给用户可执行的下一步, 不要塞技术信息 */
  desc?: string;
  /**
   * 技术详情: error.message / componentStack / 后端原始错误。
   * 传入即渲染为默认收起的折叠面板 —— 用户看得见「有更多信息」,
   * 但不会被内部文案干扰; 需要反馈给开发时可一键复制。
   */
  detail?: string;
  /** 主操作 */
  action?: ExceptionAction;
  /** 次操作。缺位且 showBack 为真时, 由「返回上一页」补位 */
  secondaryAction?: ExceptionAction;
  /**
   * 是否附「返回上一页」。默认 true —— 用户误入异常页的第一诉求通常是回退而非跳首页,
   * 直跳工作台会丢掉他原本的浏览上下文。
   * 无 referrer (直接输网址) 或无历史记录时, 返回上一页等于原地不动,
   * 故实现里退化为回工作台而非留一个死按钮。
   */
  showBack?: boolean;
  /**
   * 整屏容器 (true) 用于路由级异常页 —— 撑满可视区并居中。
   * 内容区容器 (false, 默认) 用于页面内的局部失败态 —— 嵌在已有布局里, 不抢整屏。
   */
  fullScreen?: boolean;
  /** 附在详情折叠面板下方的补充说明, 如「重试不会重复扣费」这类用户关切 */
  footnote?: string;
}

/** 404 专用大字: 让用户第一眼知道是路径问题而不是应用崩了 */
function NotFoundCode() {
  return (
    <div className="exc-code" aria-hidden>
      4<span className="exc-code-mark">0</span>4
    </div>
  );
}

/**
 * 插画已移至 `illustrations.tsx` 的 `StateIllustration` (2026-10-20)。
 * 此处原先有一份内联副本, 与 `ToolEmptyIllustration` 属同一设计语言却各画各的;
 * 现统一到单一来源, 异常页与普通空态看起来是同一套东西。
 */

/** 技术详情折叠面板: 默认收起, 展开后可一键复制全文 */
function DetailPanel({ detail, footnote }: { detail: string; footnote?: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(detail);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 剪贴板不可用 (非 https / 无权限) —— 详情文本本身仍可手动选中, 不额外打扰用户
    }
  }

  return (
    <div className="exc-detail">
      <div className="exc-detail-head">
        <button
          type="button"
          className="exc-detail-toggle"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <ChevronDown size={14} className={`exc-detail-caret${open ? ' is-open' : ''}`} />
          技术详情
        </button>
        <button type="button" className="exc-detail-copy" onClick={() => void copy()}>
          <Copy size={13} />
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      {open && (
        <>
          <pre className="exc-detail-body">{detail}</pre>
          {footnote && <p className="exc-footnote">{footnote}</p>}
        </>
      )}
    </div>
  );
}

function renderAction(node: ExceptionAction): ReactNode {
  if (!node) return null;
  // 站内链接走 router, 避免整页刷新丢掉 SPA 状态
  if (typeof node === 'object' && 'to' in node) {
    return (
      <Link to={node.to} className="exc-btn is-primary">
        {node.label}
      </Link>
    );
  }
  return node;
}

export function ExceptionPage({
  kind = 'error',
  title,
  desc,
  detail,
  action,
  secondaryAction,
  showBack = true,
  fullScreen = false,
  footnote,
}: Props) {
  const primary = renderAction(action);
  const secondary = renderAction(secondaryAction);

  // 次操作缺位时「返回上一页」补位; 两者都无则不渲染按钮区 (纯信息态)
  const back =
    showBack && !secondary ? (
      <button
        type="button"
        className="exc-btn is-ghost"
        onClick={() => {
          // 无历史记录 (直接输网址进站) 时 history.back() 原地不动, 退化为回工作台
          if (window.history.length > 1) window.history.back();
          else window.location.assign('/workbench');
        }}
      >
        返回上一页
      </button>
    ) : null;

  return (
    <div className={`exc${fullScreen ? ' is-full' : ''}`} role="alert">
      <div className="exc-inner">
        {kind === 'not-found' ? <NotFoundCode /> : <StateIllustration kind={kind} />}
        <h2 className="exc-title">{title}</h2>
        {desc && <p className="exc-desc">{desc}</p>}
        {(primary || secondary || back) && (
          <div className="exc-actions">
            {primary}
            {secondary}
            {back}
          </div>
        )}
        {detail && <DetailPanel detail={detail} footnote={footnote} />}
      </div>
    </div>
  );
}

/**
 * 404 页。独立成文件而非在 App.tsx 内联 —— 它是「路由不存在」这一语义的唯一归属地,
 * 后续若要加「该链接可能已下线」这类引导, 改这里即可。
 *
 * ⚠ 与既有行为的差异 (2026-10-20): 此前 App.tsx 的 catch-all 是
 * `<Navigate to="/workbench" replace />`, 未知 URL 被静默弹回工作台。
 * 用户输错路径时只会看到「莫名其妙回到工作台」, 分不清是页面不存在还是页面坏了 ——
 * 这与 AdminDashboardPage.tsx:288 自己写的决策原则
 * 「⚠ 为什么不用 Navigate 静默弹回: 用户只会看到莫名其妙回到工作台」相互矛盾。现改为显式 404。
 */
export function NotFoundPage() {
  return (
    <ExceptionPage
      kind="not-found"
      fullScreen
      title="页面不存在"
      desc="链接可能已失效，或地址输入有误。可以回到工作台继续创作，也可以退回上一页。"
      action={{ to: '/workbench', label: '返回工作台' }}
      secondaryAction={
        <button type="button" className="exc-btn is-ghost" onClick={() => window.history.back()}>
          返回上一页
        </button>
      }
      // 三出口已由 action/secondaryAction 占满, 不再自动补「返回上一页」
      showBack={false}
    />
  );
}

/** 404 页的第三出口: 无 referrer 时「返回上一页」是死按钮, 首页才是可靠落点 */
export function HomeLink() {
  return (
    <Link to="/" className="exc-home-link">
      <Home size={13} />
      回到首页
    </Link>
  );
}

/**
 * 加载失败通用页。用于「某个数据请求失败但页面本身还在」的场景
 * (能力清单、后台统计、列表分页等) —— 与页面级崩溃的区别是给「重试」而非「返回」,
 * 因为原数据可能只是暂时不可达, 重试即可恢复。
 */
export function LoadFailedPage({
  title = '加载失败',
  message,
  onRetry,
  detail,
}: {
  title?: string;
  message: string;
  onRetry: () => void;
  detail?: string;
}) {
  return (
    <ExceptionPage
      kind="warning"
      title={title}
      desc={message}
      detail={detail}
      action={
        <button type="button" className="exc-btn is-primary" onClick={onRetry}>
          <RotateCcw size={14} />
          重试
        </button>
      }
      showBack={false}
    />
  );
}