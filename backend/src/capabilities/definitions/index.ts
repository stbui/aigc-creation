import type { CapabilityPlugin } from '../capability-plugin.type';
import { assertCapabilityIntegrity } from '../capability-plugin.type';

import { MainImage } from './main_image';
import { DetailImage } from './detail_image';
import { HotRemake } from './hot_remake';
import { CreativeImage } from './creative_image';
import { MultiFusion } from './multi_fusion';
import { SkuImage } from './sku_image';
import { LocalRedraw } from './local_redraw';
import { Expand } from './expand';
import { Matting } from './matting';
import { RemoveWatermark } from './remove_watermark';
import { ImageTranslate } from './image_translate';
import { Enhance } from './enhance';
import { Recolor } from './recolor';
import { Rotate } from './rotate';
import { FreeCreate } from './free_create';
import { ImageToVideo } from './image_to_video';

/**
 * 能力清单聚合入口 (2026-10-20 抽离)。
 *
 * ## 新增一项能力现在只需两步
 *
 *   1. 在 `definitions/` 下新建 `<id>.ts`, 导出一个 `CapabilityPlugin`
 *   2. 在**本文件**的数组里加一行 import + 一条数组项
 *
 * 提示词、模态、积分价都随第 1 步的自包含对象一起带过来,
 * 不再需要去 gateway-prompt / mock provider / channel-config 各改一次。
 *
 * ⚠️ 本文件是**唯一**需要手工维护的地方, 故刻意保持极短且一眼可数 ——
 * 它一长就说明有信息没被收进各自的定义文件里。
 *
 * 顺序即侧栏与工作台的展示顺序, 与参考站一致。
 */
export const CAPABILITY_PLUGINS: CapabilityPlugin[] = [
  MainImage,
  DetailImage,
  HotRemake,
  CreativeImage,
  MultiFusion,
  SkuImage,
  LocalRedraw,
  Expand,
  Matting,
  RemoveWatermark,
  ImageTranslate,
  Enhance,
  Recolor,
  Rotate,
  FreeCreate,
  ImageToVideo,
];

/*
 * 装配期完整性校验 —— **模块加载即执行**。
 *
 * 为什么放在模块顶层而不是启动钩子里: ES 模块的顶层语句在**首次 import**
 * 时就同步执行, 意味着任何一处忘了 import 新能力文件、漏声明 buildPrompt
 * 或 creditCost, 都会在**进程启动的第一时间**抛错, 而不是等到用户点了那个
 * 能力才在运行时静默降级。
 *
 * 这条断言是本次抽离的核心价值: 把"漏写"从运行时的静默错误
 * (裸能力 id 被当提示词发给真实模型、能力免费开放) 提前成启动期的硬失败。
 */
assertCapabilityIntegrity(CAPABILITY_PLUGINS);
