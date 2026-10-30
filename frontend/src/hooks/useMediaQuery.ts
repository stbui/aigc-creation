import { useEffect, useState } from 'react';

/**
 * 订阅一条 CSS 媒体查询，随视口变化重渲染。
 *
 * 断点只在 JS 需要「换一套结构」时才用（例如表格在窄屏改成列表）；
 * 纯样式收放仍写在 global.css 的媒体查询里，不要两边各存一份。
 *
 * 项目是 SPA，没有 SSR，初值直接读 `matchMedia`；jsdom 下由 test/setup 兜底。
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    // query 变化时先同步一次，避免沿用上一个断点的结果
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
