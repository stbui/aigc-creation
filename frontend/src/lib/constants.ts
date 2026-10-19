export const API_BASE = (import.meta.env.VITE_API_BASE ?? 'http://localhost:3001').replace(/\/+$/, '');
export const API_PREFIX = '/api/v1';

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

/** 能力模式对应的界面标注 */
export const MODE_LABELS: Record<string, string> = {
  real: '本地算法',
  mock: '占位效果',
  planned: '规划中',
};

/** mock 能力在结果区必须显式提示, 不能让用户误以为是模型输出 */
export const MOCK_NOTICE =
  '当前为本地占位输出，未接入真实 AI 模型。图片上的变化用于区分不同能力的处理流程，接入模型后同一入口会返回真实结果。';
