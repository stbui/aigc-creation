/**
 * 接入地址（网关基址）的归一化与格式校验 —— 唯一事实源。
 *
 * ## 为什么需要它
 *
 * 本项目的基址语义是**厂商根域**: `/v1` 由协议层自己补
 * (openai / minimax 拼 `/v1/...`, volcengine 拼 `/images/generations`,
 * 它的基址自带 `/api/v3`)。而各家官方文档几乎都写 `https://api.openai.com/v1`,
 * 运营照抄过来就会拼成 `/v1/v1/images/generations`, 上游直接回:
 *
 *   HTTP 404 {"error":{"code":"api_route_not_found",
 *                      "message":"Invalid URL (POST /v1/v1/images/generations)"}}
 *
 * 生成侧只看到「通道全部失败」, 根因(地址多了一段)埋在 404 正文里 ——
 * 2026-10-23 实际发生过: 一条 `https://api.a6api.com/v1` 的图像线路
 * 让自由创作每次 42204 并退款, 同批的文本线路也带着 /v1。
 *
 * 厂商目录 (`vendors/vendor.catalog.ts`) 内置的基址由装配期
 * `collectCatalogIssues()` 拦; 本文件补的是**运营手填**的那条路径
 * (模型线路 + 全局设置 `gateway.<模态>.baseUrl`)、环境变量注入的值,
 * 以及库里已经存错的存量行。
 *
 * ## 为什么归一化而不是报错
 *
 * 尾部 `/v1` 对本项目的所有协议都是**必然重复**的段: 协议层一定会再补一次,
 * 没有任何一家把 [OI] 兼容端点挂在 `/v1/v1`。剥掉它不改变语义 —— 拼出的 URL
 * 与运营的原意一致。故在**每个读写边界**都调用本函数: 存量配置、env 配置、
 * 以及运营下次照抄文档粘贴的值, 一并自愈, 不必等人工重存。
 *
 * 格式错误 (非 URL / 非 http(s)) 仍然拒绝: 那不是「多写了一段」, 是填错了。
 */

/** 末尾一整段 `/v1` (大小写不敏感)。`/openai-v1` 这类长段不匹配 */
const TRAILING_VERSION = /\/v1$/i;

/**
 * 归一化接入地址: 去首尾空白 → 去末尾斜杠 → 去末尾 `/v1` → 再去末尾斜杠。
 *
 * ⚠️ 只剥**尾部**一整段 v1。路径中段的 v1 (如反代挂在 `/v1/gw`) 不动 ——
 * 那可能是网关真实前缀; 火山方舟的 `/api/v3` 同样必须原样保留。
 */
export function normalizeBaseUrl(raw: string | undefined | null): string {
  const trimmed = String(raw ?? '').trim().replace(/\/+$/, '');
  return trimmed.replace(TRAILING_VERSION, '').replace(/\/+$/, '');
}

/**
 * 格式校验。`/v1` 不在这里拦 —— 它已由 `normalizeBaseUrl` 消化。
 *
 * @param options.required 该字段是否必填 (线路启用时必填; 全局设置可留空)
 * @returns 可直接展示给运营的问题描述; `null` = 通过
 */
export function baseUrlIssue(
  raw: string | undefined | null,
  options: { required: boolean } = { required: true },
): string | null {
  const value = normalizeBaseUrl(raw);
  if (!value) {
    return options.required ? '启用线路时必须填写接入地址' : null;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return '接入地址必须是合法的 URL';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return '接入地址只支持 http / https';
  }
  return null;
}
