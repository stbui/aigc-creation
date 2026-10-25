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
export const POLL_MAX_TRIES = 60;
/**
 * 视频任务的轮询上限。
 *
 * 视频生成实际需要 1–2 分钟（后端视频超时 600s），沿用图像那 60 次 ≈ 72s
 * 会让视频任务在前端**必然超时**：任务还在后台跑、已扣费，界面却报失败。
 * 550 × 1.2s ≈ 11 分钟，覆盖后端超时后再留一点下载余量。
 */
export const POLL_VIDEO_MAX_TRIES = 550;

/**
 * 能力清单不再硬编码在前端 —— 全部来自 GET /api/v1/capabilities
 * (后端 capability.registry 是唯一事实源)。这里只保留与能力无关的展示常量。
 */

/**
 * 能力模式对应的界面标注。
 *
 * mode 只回答「这项能力是否已接入真实模型通道」。
 * 单次请求实际走的线路以 task.provider 为准，由结果卡显示来源徽标。
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

/**
 * 取能力的运行时状态；后端未下发时按定义兜底（兼容旧后端 / 旧缓存）。
 *
 * 兜底刻意保守：没有 runtime 就当作「暂不可用」，不假称云端可用，
 * 也不能让界面承诺一条可能不存在的通道。
 */
export function runtimeOf(
  def: Pick<CapabilityDef, 'mode' | 'runtime'>,
): CapabilityRuntime {
  if (def.runtime) {
    // 旧后端/旧缓存可能仍下发 local；本地生成已删除，必须按不可用处理，
    // 不能让它绕过提交拦截去执行一条必然失败的任务。
    if ((def.runtime.effective as string) === 'local') {
      return {
        ...def.runtime,
        localQuality: 'none',
        effective: 'unavailable',
        reason: '本地生成已停用，请配置可用的模型通道',
      };
    }
    return def.runtime;
  }
  return {
    enabled: def.mode !== 'planned',
    route: 'auto',
    remoteAvailable: false,
    localQuality: 'none',
    effective: def.mode === 'planned' ? 'disabled' : 'unavailable',
    reason: '尚未获取模型通道状态，请刷新后重试',
  };
}

/**
 * 任务失败码 → 用户可读文案（2026-10-21）。
 *
 * 未登记的码原样显示，和后台任务页同一个取向：隐藏未知错误码会让
 * 「出了问题」看起来像「没有问题」。
 */
const TASK_ERROR_TEXT: Record<string, string> = {
  // 生成侧异常 (42201) / 中断回收失败 (42202) / AIGC 角标失败 (42203) / 无通道 (42204)
  // / 遮罩不被通道支持 (42205)。这些后端都会退款，文案必须说清楚「钱退了吗」，
  // 否则用户只看到一个数字码。
  '42201': '生成失败，积分已退回',
  '42202': '任务中断，产出未完成（积分已退回）',
  '42203': 'AI 标识写入失败，本次未交付图片（积分已退回）',
  '42204': '暂无可用模型通道，本次未生成图片（积分已退回）',
  '42205': '当前模型通道不支持遮罩重绘，本次未生成图片（积分已退回）',
  'POLL_TIMEOUT':
    '等待超时：任务可能仍在后台生成，请稍后到「我的作品」查看（若失败会自动退回积分）',
};

export function taskErrorText(code?: string | null): string {
  if (!code) return '未知错误';
  return TASK_ERROR_TEXT[code] ?? code;
}
