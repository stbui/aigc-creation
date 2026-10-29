import type { Response } from 'express';
import { csvFilename } from './csv';

/**
 * 统一的 CSV 下载响应。
 *
 * 后台所有导出都必须走这里, 而不是各 controller 自己 `setHeader(...)`:
 *
 *   · **必须用 `@Res()` 直接写响应** —— 全局 ResponseInterceptor 会把返回值
 *     包成 `{code,data}` JSON, 浏览器拿到的是一个 JSON 字符串而非可下载文件。
 *   · **文件名只由服务端生成** —— `csvFilename()` 用固定前缀加时间戳,
 *     不拼任何用户输入, 避免中文/空格在不同浏览器上各自编码导致乱码。
 *   · 权限与审计不在这里处理: 调用方须挂 `data.export` 权限点与
 *     `@AuditAction('data.export')`, 导出即把用户数据带出系统。
 */
export function sendCsv(res: Response, prefix: string, csv: string): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${csvFilename(prefix)}"`);
  res.send(csv);
}
