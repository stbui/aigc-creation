"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeOutbox = writeOutbox;
const fs_1 = require("fs");
const path_1 = require("path");
function writeOutbox(entry) {
    /*
     * 生产环境**不落盘**。outbox 里是明文验证码与密码重置链接，
     * 生产上出现它只说明「通道没配好」；此时把凭据写进服务器磁盘，
     * 等于给任何能读日志目录的人开了一扇后门。缺通道的告警由
     * EmailService / SmsService 的启动 WARN 负责，不靠落盘补救。
     */
    if (process.env.NODE_ENV === 'production')
        return undefined;
    try {
        const dir = (0, path_1.resolve)(process.env.LOG_DIR || 'logs', 'outbox');
        (0, fs_1.mkdirSync)(dir, { recursive: true });
        const day = new Date().toISOString().slice(0, 10);
        const file = (0, path_1.resolve)(dir, `${entry.channel}-${day}.log`);
        (0, fs_1.appendFileSync)(file, `${JSON.stringify(entry)}\n`, 'utf8');
        return file;
    }
    catch {
        // 落盘失败不能影响业务：控制台实现本身只是开发辅助，
        // 真正的错误由调用方从 DeliveryResult.ok 判断
        return undefined;
    }
}
//# sourceMappingURL=console-outbox.js.map