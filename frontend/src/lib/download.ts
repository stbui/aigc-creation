/**
 * 浏览器端下载工具。
 *
 * JSON 导出用一次性 object URL：点击后立即 revoke，避免长页面常驻时累积未释放的 blob。
 * 账户中心的个人数据导出与后台渠道配置导出共用这一份，不再各写一份。
 */
export function downloadJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * 纯链接下载：逐字等价于原各页里的 createElement → href → download → click 四步。
 *
 * 只给无 rel / target / DOM 挂载 / object URL 回收的调用点用。带这些语义的实现
 * 各有安全属性与浏览器兼容考量（例如延迟 revoke 才不会中断下载），保持原样。
 */
export function triggerDownload(url: string, filename: string): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
}
