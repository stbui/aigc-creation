/**
 * 阿里云 RPC 签名的**离线交叉校验**（短信 SendSms / 邮件 SingleSendMail）。
 *
 * 为什么需要这个脚本
 * ------------------
 * 与 `verify-payment-signatures.ts` 同一个理由：**自己签、自己验**永远通过。
 * 签名规则少排一次序、少编码一个 `*`、把 Signature 也算进 canonical string，
 * 只要签名与「我们认为服务端会怎么算」错得一致，本地一路绿灯；
 * 上线后第一条真实短信只会得到 `SignatureDoesNotMatch`，而那需要 AccessKey
 * 才能复现 —— 本项目默认不持有凭据。
 *
 * 所以这里用**独立的百分号编码实现**（按 UTF-8 字节逐个处理，而不是
 * encodeURIComponent + 替换）把签名重算一遍，再与被测实现逐字节比对。
 *
 * 覆盖：
 *   1. percentEncode 的 RFC3986 边界（`*` `'` `(` `)` `!` 空格 `~` 中文 `/`）
 *   2. 参数名排序、Signature 不参与待签串
 *   3. buildRpcRequest：nonce/timestamp 注入、请求体 === canonical query
 *   4. parseRpcResult：SendSms 的 `Code=OK`、失败码、SingleSendMail 的「成功无 Code」、
 *      HTTP 4xx 带 Code
 *   5. 两个 provider 的真实请求体（stub fetch 抓包）：模板变量、发信地址、AddressType
 *
 * 不覆盖（需要真实 AccessKey，交付时如实标注「已实现未实测」）：
 *   · 打向 dysmsapi.aliyuncs.com / dm.aliyuncs.com 的真实投递
 *
 * 运行: cd backend && npx ts-node -T scripts/verify-channel-signatures.ts
 */
import { createHmac } from 'crypto';
import {
  buildRpcRequest,
  canonicalQuery,
  parseRpcResult,
  percentEncode,
  signRpc,
  stringToSign,
} from '../src/channels/aliyun-signature';
import { AliyunSmsProvider } from '../src/channels/sms/aliyun-sms.provider';
import { AliyunEmailProvider } from '../src/channels/email/aliyun-email.provider';

let pass = 0;
const fails: string[] = [];

function ok(name: string, cond: boolean, detail?: unknown): void {
  const s = detail === undefined ? '' : ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail));
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}${s.length > 160 ? s.slice(0, 160) + '…' : s}`);
  } else {
    fails.push(name);
    console.log(`  FAIL  ${name}${s}`);
  }
}

// ───────────────── 独立的签名实现（不复用被测代码） ─────────────────

const UNRESERVED = /[A-Za-z0-9\-_.~]/;

/** 按 UTF-8 字节逐个编码：RFC3986 unreserved 原样，其余 %XX 大写 */
function refEncode(input: string): string {
  let out = '';
  for (const byte of Buffer.from(String(input), 'utf8')) {
    const ch = String.fromCharCode(byte);
    out += byte < 0x80 && UNRESERVED.test(ch) ? ch : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

function refCanonical(params: Record<string, string>): string {
  return Object.keys(params)
    .sort()
    .map((k) => `${refEncode(k)}=${refEncode(params[k])}`)
    .join('&');
}

function refSign(params: Record<string, string>, secret: string): string {
  const toSign = `POST&${refEncode('/')}&${refEncode(refCanonical(params))}`;
  return createHmac('sha1', `${secret}&`).update(toSign).digest('base64');
}

// ───────────────── 1. percentEncode 边界 ─────────────────

function verifyPercentEncode(): void {
  console.log('\n[1] percentEncode (RFC3986)');
  const cases: Array<[string, string]> = [
    ['hello world', 'hello%20world'],
    ['a*b', 'a%2Ab'],
    ["a'b", 'a%27b'],
    ['a(b)c', 'a%28b%29c'],
    ['a!b', 'a%21b'],
    ['a~b-c_d.e', 'a~b-c_d.e'],
    ['a/b', 'a%2Fb'],
    ['货觉AI', '%E8%B4%A7%E8%A7%89AI'],
    ['中文 空格', '%E4%B8%AD%E6%96%87%20%E7%A9%BA%E6%A0%BC'],
  ];
  for (const [input, expected] of cases) {
    ok(`percentEncode(${JSON.stringify(input)})`, percentEncode(input) === expected, percentEncode(input));
  }
  ok('与独立实现逐字节一致', cases.every(([input]) => percentEncode(input) === refEncode(input)));
}

// ───────────────── 2/3. canonical query 与签名 ─────────────────

function verifyRequestBuilding(): void {
  console.log('\n[2] canonical query / StringToSign / 签名');
  const params = {
    Action: 'SendSms',
    AccessKeyId: 'test-key-id',
    Format: 'JSON',
    SignatureMethod: 'HMAC-SHA1',
    SignatureNonce: 'fixed-nonce',
    SignatureVersion: '1.0',
    Timestamp: '2026-10-22T00:00:00Z',
    Version: '2017-05-25',
    PhoneNumbers: '13800138000',
    SignName: '货觉AI',
    TemplateCode: 'SMS_123456789',
    TemplateParam: '{"code":"123456"}',
  };
  const canonical = canonicalQuery(params);
  ok('canonical 与独立实现一致', canonical === refCanonical(params), canonical);
  ok(
    '参数名按字典序（Action 在 AccessKeyId 之后、Version 在 Timestamp 之后）',
    canonical.indexOf('AccessKeyId=') < canonical.indexOf('Action=') &&
      canonical.indexOf('Timestamp=') < canonical.indexOf('Version='),
    canonical.slice(0, 80),
  );
  ok('中文签名已百分号编码', canonical.includes('SignName=%E8%B4%A7%E8%A7%89AI'));
  ok('JSON 模板变量已编码', canonical.includes('TemplateParam=%7B%22code%22%3A%22123456%22%7D'));

  const expected = refSign(params, 'test-secret');
  ok('signRpc 与独立实现一致', signRpc(params, 'test-secret') === expected, signRpc(params, 'test-secret'));
  ok('StringToSign 前缀为 POST&%2F&', stringToSign(params).startsWith('POST&%2F&'));
  ok(
    'AccessKeySecret 参与密钥（换密钥即换签名）',
    signRpc(params, 'other-secret') !== expected,
  );

  console.log('\n[3] buildRpcRequest');
  const req = buildRpcRequest({
    action: 'SendSms',
    version: '2017-05-25',
    accessKeyId: 'test-key-id',
    accessKeySecret: 'test-secret',
    nonce: 'fixed-nonce',
    timestamp: '2026-10-22T00:00:00Z',
    extra: { PhoneNumbers: '13800138000', SignName: '货觉AI', TemplateCode: 'SMS_1', EmptyParam: '' },
  });
  const withoutSignature = { ...req.params };
  ok('Signature 不在待签参数里', !('Signature' in withoutSignature));
  ok('Signature 与独立重算一致', req.signature === refSign(withoutSignature, 'test-secret'), req.signature);
  ok(
    '请求体 === canonical query（含 Signature，签名同一份字符串）',
    req.body === refCanonical({ ...withoutSignature, Signature: req.signature }),
    req.body.slice(0, 90),
  );
  ok('nonce / timestamp 按注入值使用', req.params.SignatureNonce === 'fixed-nonce' && req.params.Timestamp === '2026-10-22T00:00:00Z');
  ok('空值业务参数被剔除', !('EmptyParam' in req.params));

  const auto = buildRpcRequest({
    action: 'SendSms',
    version: '2017-05-25',
    accessKeyId: 'k',
    accessKeySecret: 's',
    extra: {},
  });
  ok('默认 Timestamp 为秒级 ISO8601 UTC', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(auto.params.Timestamp), auto.params.Timestamp);
  ok('默认 nonce 非空', auto.params.SignatureNonce.length >= 8);
}

// ───────────────── 4. 响应解析 ─────────────────

function verifyResponseParsing(): void {
  console.log('\n[4] parseRpcResult');
  const smsOk = parseRpcResult('{"Code":"OK","BizId":"B1","RequestId":"R1","Message":"OK"}', 200, true);
  ok('SendSms 成功（Code=OK）', smsOk.ok && smsOk.messageId === 'B1', smsOk);

  const dmOk = parseRpcResult(
    '{"EnvId":"xxx","RequestId":"R2"}',
    200,
    true,
  );
  ok('SingleSendMail 成功（无 Code）', dmOk.ok && dmOk.messageId === 'R2', dmOk);

  const limited = parseRpcResult(
    '{"Code":"isv.BUSINESS_LIMIT_CONTROL","Message":"触发分钟级流控","RequestId":"R3"}',
    200,
    true,
  );
  ok('HTTP 200 但业务失败不被当成投递成功', !limited.ok && String(limited.error).includes('BUSINESS_LIMIT_CONTROL'), limited);

  const authFail = parseRpcResult('{"Code":"SignatureDoesNotMatch","Message":"签名错误"}', 400, false);
  ok('HTTP 4xx + Code 报出原始错误码', !authFail.ok && String(authFail.error).includes('SignatureDoesNotMatch'), authFail);

  const httpOnly = parseRpcResult('<html>bad gateway</html>', 502, false);
  ok('非 JSON 的失败回落到 HTTP 状态', !httpOnly.ok && String(httpOnly.error).includes('502'), httpOnly);
}

// ───────────────── 5. provider 请求体（stub fetch） ─────────────────

const realFetch = globalThis.fetch;

function stubFetch(response: { status: number; body: string }): { calls: Array<{ url: string; body: string; contentType: string }> } {
  const calls: Array<{ url: string; body: string; contentType: string }> = [];
  globalThis.fetch = (async (url: any, init: any) => {
    calls.push({
      url: String(url),
      body: String(init?.body ?? ''),
      contentType: String(init?.headers?.['content-type'] ?? ''),
    });
    return new Response(response.body, { status: response.status });
  }) as unknown as typeof fetch;
  return { calls };
}

async function verifySmsProvider(): Promise<void> {
  console.log('\n[5] AliyunSmsProvider 请求体');
  const stub = stubFetch({ status: 200, body: '{"Code":"OK","BizId":"B-sms","RequestId":"R-sms"}' });
  try {
    const provider = new AliyunSmsProvider('ak-id', 'ak-secret', '货觉AI', 'SMS_123', 'https://dysmsapi.aliyuncs.com/');
    const result = await provider.send({ to: '13800138000', code: '654321', text: '验证码 654321' });
    ok('投递成功并取到 BizId', result.ok && result.messageId === 'B-sms', result);
    ok('请求体是 form-urlencoded', stub.calls[0]?.contentType.includes('application/x-www-form-urlencoded'), stub.calls[0]?.contentType);
    const body = stub.calls[0]?.body ?? '';
    ok('Action=SendSms / Version=2017-05-25', body.includes('Action=SendSms') && body.includes('Version=2017-05-25'));
    ok('PhoneNumbers 已带上', body.includes('PhoneNumbers=13800138000'));
    ok('模板变量只有 code', body.includes('TemplateParam=%7B%22code%22%3A%22654321%22%7D'));
    ok('签名不落明文 AccessKeySecret', !body.includes('ak-secret'));
    ok('请求体与签名同源（重算一致）', bodySignatureMatches(body, 'ak-secret'));
  } finally {
    globalThis.fetch = realFetch;
  }

  const limited = stubFetch({ status: 200, body: '{"Code":"isv.BUSINESS_LIMIT_CONTROL","Message":"流控"}' });
  try {
    const provider = new AliyunSmsProvider('ak-id', 'ak-secret', '货觉AI', 'SMS_123', 'https://dysmsapi.aliyuncs.com/');
    const result = await provider.send({ to: '13800138000', code: '1', text: 'x' });
    ok('业务失败返回 ok:false 并带 Code', !result.ok && String(result.error).includes('BUSINESS_LIMIT_CONTROL'), result);
    ok('HTTP 200 的业务失败只请求一次（不重试）', limited.calls.length === 1, limited.calls.length);
  } finally {
    globalThis.fetch = realFetch;
  }
}

async function verifyEmailProvider(): Promise<void> {
  console.log('\n[6] AliyunEmailProvider 请求体');
  const stub = stubFetch({ status: 200, body: '{"RequestId":"R-mail","EnvId":"env"}' });
  try {
    const provider = new AliyunEmailProvider('ak-id', 'ak-secret', 'noreply@example.com', '货觉AI', '1');
    const result = await provider.send({
      to: 'user@example.com',
      subject: '【货觉AI】重置密码',
      text: '纯文本正文',
      html: '<p>HTML 正文</p>',
    });
    ok('投递成功（成功响应无 Code）', result.ok && result.messageId === 'R-mail', result);
    const body = stub.calls[0]?.body ?? '';
    ok('Action=SingleSendMail / Version=2015-11-23', body.includes('Action=SingleSendMail') && body.includes('Version=2015-11-23'));
    ok('AccountName 用发信地址', body.includes('AccountName=noreply%40example.com'));
    ok('AddressType / ReplyToAddress 正确', body.includes('AddressType=1') && body.includes('ReplyToAddress=false'));
    ok('HtmlBody 与 TextBody 都带', body.includes('HtmlBody=') && body.includes('TextBody='));
    ok('FromAlias 已百分号编码', body.includes('FromAlias=%E8%B4%A7%E8%A7%89AI'));
    ok('请求体与签名同源（重算一致）', bodySignatureMatches(body, 'ak-secret'));
  } finally {
    globalThis.fetch = realFetch;
  }
}

/** 从请求体里取出参数、剔除 Signature、独立重算签名并比对 */
function bodySignatureMatches(body: string, secret: string): boolean {
  const params: Record<string, string> = {};
  for (const pair of body.split('&')) {
    const idx = pair.indexOf('=');
    if (idx < 0) continue;
    params[decodeURIComponent(pair.slice(0, idx))] = decodeURIComponent(pair.slice(idx + 1));
  }
  const signature = params.Signature;
  if (!signature) return false;
  delete params.Signature;
  return refSign(params, secret) === signature;
}

async function main(): Promise<void> {
  verifyPercentEncode();
  verifyRequestBuilding();
  verifyResponseParsing();
  await verifySmsProvider();
  await verifyEmailProvider();

  console.log(`\n通过 ${pass} 项`);
  if (fails.length) {
    console.error(`\n失败 ${fails.length} 项:`);
    for (const f of fails) console.error('  x ' + f);
    process.exit(1);
  }
  console.log('阿里云 RPC 签名与公开规范一致（短信 / 邮件），失败语义不会把错误当成功');
}

void main();
