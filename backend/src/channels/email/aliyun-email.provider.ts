import type { DeliveryResult, EmailMessage } from '../channel.types';
import type { EmailProvider } from './email.provider';
import { postForm } from '../http-client';
import { buildRpcRequest, parseRpcResult } from '../aliyun-signature';

/**
 * 阿里云邮件推送（SingleSendMail，2015-11-23）。
 *
 * 几处与直觉不同的地方：
 *   - 发信地址 `AccountName` 必须是控制台里**已配置的发信地址**（而不是任意
 *     `xx@example.com`）；`AddressType=1` 表示随机账号（发信地址），0 才是批量。
 *   - `ReplyToAddress=false` 表示回信地址与发信地址一致。
 *   - 成功响应没有 `Code`（只有 RequestId/EnvId），失败才带 `Code` ——
 *     所以成败判定不能用「Code === 'OK'」，见 `parseRpcResult`。
 *   - 端点固定 `dm.aliyuncs.com`（国际站另有 `dm.ap-southeast-1.aliyuncs.com`，
 *     需要时改 `ALIYUN_DM_ENDPOINT` 的代码常量，而不是加一个没人配的变量）。
 *
 * 纯文本正文一定要带：客户端不渲染 HTML 时的兜底，也是过滤器判断
 * 「是不是营销群发」的依据之一，缺了会显著提高进垃圾箱的概率。
 */
export class AliyunEmailProvider implements EmailProvider {
  readonly name = 'aliyun-dm';
  readonly delivers = true;

  constructor(
    private readonly accessKeyId: string,
    private readonly accessKeySecret: string,
    readonly from: string,
    private readonly fromAlias: string,
    private readonly addressType: string,
    private readonly endpoint = 'https://dm.aliyuncs.com/',
  ) {}

  async send(message: EmailMessage): Promise<DeliveryResult> {
    const req = buildRpcRequest({
      action: 'SingleSendMail',
      version: '2015-11-23',
      accessKeyId: this.accessKeyId,
      accessKeySecret: this.accessKeySecret,
      extra: {
        AccountName: this.from,
        AddressType: this.addressType,
        ReplyToAddress: 'false',
        ToAddress: message.to,
        Subject: message.subject,
        HtmlBody: message.html || message.text,
        TextBody: message.text,
        ...(this.fromAlias ? { FromAlias: this.fromAlias } : {}),
      },
    });

    const res = await postForm({ url: this.endpoint, body: req.body });
    const parsed = parseRpcResult(res.bodyText, res.status, res.ok);
    if (!parsed.ok) {
      return { ok: false, provider: this.name, delivered: false, error: parsed.error };
    }
    return { ok: true, provider: this.name, delivered: true, messageId: parsed.messageId };
  }
}
