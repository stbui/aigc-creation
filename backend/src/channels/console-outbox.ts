import { appendFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

/**
 * 控制台通道落盘目录 —— 开发/测试环境「伪投递」的唯一出口。
 *
 * 为什么落盘而不是只打日志
 * ----------------------
 * 1. `start.sh` 每次启动都会清空 `.run/backend.log`（stdout 重定向），只打日志
 *    的话上一轮的验证码在重启后就查不到了；
 * 2. 冒烟脚本需要一个**稳定可读**的落点来取验证码 / 重置链接（`logs/outbox/*.log`
 *    一行一条 JSON），比解析人类可读的日志格式可靠得多；
 * 3. `logs/` 已在 gitignore 内，且与 AppFileLogger 的轮转/脱敏互不干扰。
 *
 * 只有 `console` 实现会写这里；`http` 实现真实投递，不落盘（避免二次泄露）。
 */
export interface OutboxEntry {
  channel: 'email' | 'sms';
  to: string;
  subject?: string;
  body: string;
  provider: string;
  at: string;
}

export function writeOutbox(entry: OutboxEntry): string | undefined {
  /*
   * 生产环境**不落盘**。outbox 里是明文验证码与密码重置链接，
   * 生产上出现它只说明「通道没配好」；此时把凭据写进服务器磁盘，
   * 等于给任何能读日志目录的人开了一扇后门。缺通道的告警由
   * EmailService / SmsService 的启动 WARN 负责，不靠落盘补救。
   */
  if (process.env.NODE_ENV === 'production') return undefined;
  try {
    const dir = resolve(process.env.LOG_DIR || 'logs', 'outbox');
    mkdirSync(dir, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    const file = resolve(dir, `${entry.channel}-${day}.log`);
    appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf8');
    return file;
  } catch {
    // 落盘失败不能影响业务：控制台实现本身只是开发辅助，
    // 真正的错误由调用方从 DeliveryResult.ok 判断
    return undefined;
  }
}
