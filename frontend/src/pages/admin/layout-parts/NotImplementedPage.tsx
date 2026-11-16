import { useLocation } from 'react-router-dom';
import { findAdminMenuItem } from '../../../components/admin/adminNav';
import { ExceptionPage } from '../../../components/ExceptionPage';

/**
 * 占位页：让「待建」菜单项点了有明确反馈，而不是看起来像坏了。
 *
 * catch-all 同时接住了「纯打错的 URL」（如 /admin/uesrs）。比对侧栏菜单：
 * 命中 planned 项 → 说「尚未开放」；未命中任何菜单项 → 如实说「页面不存在」。
 */
export function NotImplementedPage() {
  const location = useLocation();
  const hit = findAdminMenuItem(location.pathname);

  if (!hit?.planned) {
    return (
      <ExceptionPage
        kind="not-found"
        title="页面不存在"
        desc={`后台没有 ${location.pathname} 这个页面，可能是地址输入有误，或该功能已调整。`}
        detail={`unmatched admin path: ${location.pathname}`}
        action={{ to: '/admin', label: '返回平台概览' }}
        showBack={false}
      />
    );
  }

  return (
    <ExceptionPage
      kind="info"
      title={`${hit.label} 尚未开放`}
      desc="该模块已在后台菜单中占位，计划在后续批次交付。可以先回平台概览，或查看其他已可用的模块。"
      action={{ to: '/admin', label: '返回平台概览' }}
      showBack={false}
    />
  );
}
