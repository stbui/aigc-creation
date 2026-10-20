/**
 * 运行环境标识。
 *
 * 取自构建时的 --mode（Vite 内建），与后端 NODE_ENV 一一对应：
 *   development 开发 / test 测试 / production 生产
 *
 * 用途：界面上的环境角标、只在非生产环境出现的调试入口。
 * 注意这是**构建时**常量 —— 同一份产物无法在不同环境复用，
 * 这是Vite 静态注入的固有约束，不是本项目的取舍。
 */
export const APP_ENV = import.meta.env.MODE;

/**
 * 后端基址。
 *
 * 留空（VITE_API_BASE=）时走同源相对路径，dev 阶段由 vite proxy 转发到
 * VITE_API_PROXY，生产由 Nginx 反代 /api —— 这两种部署都不需要配 CORS。
 * 跨域部署时才填绝对地址，此时后端的 CORS_ORIGINS 必须包含它。
 *
 * 兜底从http://localhost:3001 改为留空：留空走同源更安全
 * （生产若忘配 VITE_API_BASE，会得到「请求打到自己域名的 /api」这个明确失败，
 *  而不是静默打到开发机的 3001）。
 */
export const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/+$/, '');
export const API_PREFIX = '/api/v1';

/** 是否生产环境 */
export const IS_PROD = APP_ENV === 'production';

export const DEFAULT_PROJECT_NAME = '默认项目';
export const MAX_UPLOAD_MB = 20;
export const POLL_INTERVAL_MS = 1200;
export const POLL_MAX_TRIES = 60;

export const DEMO_CREDENTIALS = {
  email: 'admin@demo.com',
  password: 'demo1234',
};

/**
 * 能力清单不再硬编码在前端 —— 全部来自 GET /api/v1/capabilities
 * (后端 capability.registry 是唯一事实源)。这里只保留与能力无关的展示常量。
 */

/**
 * 能力模式对应的界面标注。
 *
 * ⚠️ `real` 的文案是「已接入」而非「本地算法」——
 * real 现在涵盖两类实现: Jimp 本地真实算法(7项) 与 已接云端真实模型
 * (自由创作 → 优云智算 qwen-image-3.0)。写成「本地算法」会让云端模型能力被错标。
 *
 * mode 只回答「这项能力是否已接入真实实现」, **不承诺每次都走远程**。
 * 单次请求实际走云端模型还是本地 Jimp 回落, 以 task.provider 为准,
 * 由结果卡按provider 显示徽标 (绿=真实模型 / 琥珀=本地算法)。
 */
export const MODE_LABELS: Record<string, string> = {
  real: '已接入',
  mock: '占位效果',
  planned: '规划中',
};

/** mock 能力在结果区必须显式提示, 不能让用户误以为是模型输出 */
export const MOCK_NOTICE =
  '当前为本地占位输出，未接入真实 AI 模型。图片上的变化用于区分不同能力的处理流程，接入模型后同一入口会返回真实结果。';
