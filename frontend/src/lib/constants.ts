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
import type { CapabilityDef, CapabilityRuntime } from '../types/api';

export const APP_ENV = import.meta.env.MODE;

/**
 * 后端基址。
 *
 * 留空（VITE_API_BASE=）时走同源相对路径，dev 阶段由 vite proxy 转发到
 * VITE_API_PROXY，生产由 Nginx 反代 /api —— 这两种部署都不需要配 CORS。
 * 跨域部署时才填绝对地址，此时后端的 CORS_ORIGINS 必须包含它。
 *
 * 兜底不写死开发机地址：留空走同源更安全
 * （生产若忘配 VITE_API_BASE，会得到「请求打到自己域名的 /api」这个明确失败，
 *  而不是静默打到开发机的固定端口）。
 */
export const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/+$/, '');
export const API_PREFIX = '/api/v1';

/** 是否生产环境 */
export const IS_PROD = APP_ENV === 'production';

export const DEFAULT_PROJECT_NAME = '默认项目';
/**
 * 单张图片体积上限 —— **全站唯一事实源**。
 *
 * 2026-10-22 收敛。此前是三套并存: 定制工具页 10MB、通用 ToolPage 20MB、
 * 素材库完全不校验。后果是运营按素材库的提示准备文件, 在工具页被拒、
 * 在素材库又"成功", 拿到一张破图, 且不知道到底该信哪个数。
 * 新增上传入口时引用这里, 不要再写字面量。
 */
export const MAX_IMAGE_MB = 10;
export const MAX_IMAGE_BYTES = MAX_IMAGE_MB * 1024 * 1024;
/** 后端图片解码与生成通道接受的三种真实格式；GIF 不在其中。 */
export const SUPPORTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const SUPPORTED_IMAGE_ACCEPT = SUPPORTED_IMAGE_TYPES.join(',');
export const SUPPORTED_IMAGE_LABEL = 'PNG / JPG / WebP';

/** 与后端 `inspectUploadedImage` 的格式白名单保持一致；GIF 等格式会被服务端拒绝。 */
export function isSupportedImageFile(file: { type: string }): boolean {
  return (SUPPORTED_IMAGE_TYPES as readonly string[]).includes(file.type);
}
export const POLL_INTERVAL_MS = 1200;

/** 后端任务进入终态后还要下载、写 AIGC 标识并落盘，前端多留 2 分钟取结果。 */
const POLL_RESULT_GRACE_MS = 2 * 60_000;

/**
 * 普通图像任务的轮询上限。
 *
 * 后端 `TaskWorkerService` 对图像任务的总轮询时限是 15 分钟；此前前端只等
 * 60 × 1.2s ≈ 72s，模型稍慢就会把仍在后台运行的任务误报成 `POLL_TIMEOUT`。
 * 2026-11-05 的自由创作任务实际耗时约 4 分钟并在后台成功，用户却先看到失败。
 */
export const POLL_MAX_TRIES = Math.ceil((15 * 60_000 + POLL_RESULT_GRACE_MS) / POLL_INTERVAL_MS);
/**
 * 多图融合的轮询上限。
 *
 * 多图融合仍是图像模态，后台沿用统一的 15 分钟总时限；不能因为一次生成
 * 多个变体反而比普通图片更早被前端判失败。
 */
export const POLL_MULTI_FUSION_MAX_TRIES = POLL_MAX_TRIES;
/**
 * 视频任务的轮询上限。
 *
 * 后端 `TaskWorkerService` 对视频任务的总轮询时限是 60 分钟；前端窗口必须
 * 覆盖后台终态，否则任务还在跑、已扣费，界面却会提前报失败。
 */
export const POLL_VIDEO_MAX_TRIES = Math.ceil((60 * 60_000 + POLL_RESULT_GRACE_MS) / POLL_INTERVAL_MS);

/**
 * 能力清单不再硬编码在前端 —— 全部来自 GET /api/v1/capabilities
 * (后端 capability.registry 是唯一事实源)。这里只保留与能力无关的展示常量。
 */

/**
 * 能力模式对应的界面标注。
 *
 * mode 只回答「这项能力是否已接入真实模型通道」。
 */
export const MODE_LABELS: Record<string, string> = {
  real: '已接入',
  planned: '规划中',
};

/**
 * 运行时结论对应的界面标注（2026-10-21）。
 *
 * 与 MODE_LABELS 的分工：MODE 是「代码里实现到什么程度」，RUNTIME 是
 * 「此刻按下去会发生什么」。用户要的信息永远是后者 —— 一项 real 能力
 * 在没配通道时不可提交，标「已接入」并不告诉他这一点。
 */
export const RUNTIME_LABELS: Record<CapabilityRuntime['effective'], string> = {
  remote: '云端模型',
  disabled: '已下线',
  unavailable: '暂不可用',
};

/** 前台不可用提示：后端 reason 可能包含运营/配置诊断信息，不直接透出给用户。 */
export const CAPABILITY_UNAVAILABLE_NOTICE = '当前生成服务暂不可用，请稍后再试。';

/**
 * 将能力运行时状态转换为前台可展示的数据。
 *
 * `unavailable` 的 reason 来自模型路由诊断，只供后台排障；C 端统一换成
 * 面向用户的提示，避免把「真实模型 / 线路配置」等内部信息暴露到页面。
 * 后台「能力与模型」直接使用管理接口返回的数据，不受这里影响。
 */
export function publicCapabilityRuntime(runtime: CapabilityRuntime): CapabilityRuntime {
  if (runtime.effective !== 'unavailable') return runtime;
  return { ...runtime, reason: CAPABILITY_UNAVAILABLE_NOTICE };
}

/**
 * 取能力的运行时状态；后端未下发时按定义兜底。
 *
 * 兜底刻意保守：没有 runtime 就当作「暂不可用」，不假称模型线路可用，
 * 也不能让界面承诺一条可能不存在的线路。
 */
export function runtimeOf(def: Pick<CapabilityDef, 'mode' | 'runtime'>): CapabilityRuntime {
  if (def.runtime) return publicCapabilityRuntime(def.runtime);
  return {
    enabled: def.mode !== 'planned',
    remoteAvailable: false,
    effective: def.mode === 'planned' ? 'disabled' : 'unavailable',
    reason: '尚未获取模型线路状态，请刷新后重试',
  };
}

/** 从能力清单按 id 取运行时结论；清单尚未加载时返回 undefined。 */
export function runtimeOfId(
  items: ReadonlyArray<Pick<CapabilityDef, 'id' | 'mode' | 'runtime'>> | undefined,
  id: string,
): CapabilityRuntime | undefined {
  const def = items?.find((item) => item.id === id);
  return def ? runtimeOf(def) : undefined;
}

/**
 * 任务失败码 → 用户可读文案（2026-10-21）。
 *
 * 未登记的码原样显示，和后台任务页同一个取向：隐藏未知错误码会让
 * 「出了问题」看起来像「没有问题」。
 */
const TASK_ERROR_TEXT: Record<string, string> = {
  // 生成侧异常 (42201) / 中断回收失败 (42202) / AIGC 角标失败 (42203) / 无通道 (42204)
  // / 遮罩不被通道支持 (42205) / 结果不确定待人工核对 (42206)。文案必须说清楚「钱退了吗」，
  // 否则用户只看到一个数字码。
  '42201': '生成失败，积分已退回',
  '42202': '任务中断，产出未完成（积分已退回）',
  '42203': 'AI 标识写入失败，本次未交付图片（积分已退回）',
  '42204': '暂无可用模型通道，本次未生成图片（积分已退回）',
  '42205': '当前模型通道不支持遮罩重绘，本次未生成图片（积分已退回）',
  '42206': '生成结果暂不明确，积分已冻结，等待人工核对',
  CANCELLED: '任务已取消，本次未产出图片；退款以账单处理结果为准',
  POLL_TIMEOUT: '等待超时：任务可能仍在后台生成，请稍后到「我的作品」查看（若失败会自动退回积分）',
};

export function taskErrorText(code?: string | null): string {
  if (!code) return '未知错误';
  return TASK_ERROR_TEXT[code] ?? code;
}

/**
 * 会员套餐的视觉标签 (仅文案与推荐位, 不含价格 / 积分)。
 *
 * 按 `sortOrder` 位置与在售付费档一一对应 —— **刻意不按 code 匹配**:
 * 套餐编码由后端种子定义, 前端再抄一份 code 等于把后端标识硬编码进来,
 * 后台改编码时这里会静默错位。价目与权益一律读 `/membership/plans`。
 *
 * 当前在售付费档 6 个 (标准 / 进阶 / 专业 / 尊享 / 旗舰 / 至尊)。首页与
 * 积分商城共用这一份, 避免两个页面各写一套标签后逐渐不一致。
 */
export const PLAN_VISUALS: ReadonlyArray<{ tag: string; recommended: boolean }> = [
  { tag: '入门试用', recommended: false },
  { tag: '首购推荐', recommended: false },
  { tag: '最热门', recommended: true },
  { tag: '团队使用', recommended: false },
  { tag: '超高算力', recommended: false },
  { tag: '企业使用', recommended: false },
];
