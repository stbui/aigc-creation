import { useEffect } from 'react';

/**
 * 路由级基础 SEO 元信息。
 *
 * 项目没有引入 Helmet；内页此前全部共用 index.html 的标题/描述，
 * 搜索结果与分享卡片无法区分页面。这里在页面挂载时设置 title、
 * description 与 canonical，卸载时恢复上一页（SPA 切页不会刷新 head）。
 */
export function useDocumentMeta(title: string, description?: string): void {
  useEffect(() => {
    const prevTitle = document.title;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const prevDescription = meta?.getAttribute('content') ?? '';

    document.title = title;
    if (description && meta) meta.setAttribute('content', description);

    let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    const createdCanonical = !canonical;
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.rel = 'canonical';
      document.head.appendChild(canonical);
    }
    const prevCanonical = canonical.href;
    canonical.href = `${window.location.origin}${window.location.pathname}`;

    return () => {
      document.title = prevTitle;
      if (description && meta) meta.setAttribute('content', prevDescription);
      if (createdCanonical) canonical?.remove();
      else if (canonical) canonical.href = prevCanonical;
    };
  }, [title, description]);
}
