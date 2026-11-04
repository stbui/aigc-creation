"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CAPABILITY_PLUGINS = void 0;
const capability_plugin_type_1 = require("../capability-plugin.type");
const main_image_1 = require("./main_image");
const detail_image_1 = require("./detail_image");
const hot_remake_1 = require("./hot_remake");
const creative_image_1 = require("./creative_image");
const multi_fusion_1 = require("./multi_fusion");
const sku_image_1 = require("./sku_image");
const local_redraw_1 = require("./local_redraw");
const expand_1 = require("./expand");
const matting_1 = require("./matting");
const remove_watermark_1 = require("./remove_watermark");
const image_translate_1 = require("./image_translate");
const enhance_1 = require("./enhance");
const recolor_1 = require("./recolor");
const rotate_1 = require("./rotate");
const free_create_1 = require("./free_create");
const image_to_video_1 = require("./image_to_video");
const shoppable_carousel_1 = require("./shoppable_carousel");
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
exports.CAPABILITY_PLUGINS = [
    main_image_1.MainImage,
    detail_image_1.DetailImage,
    hot_remake_1.HotRemake,
    creative_image_1.CreativeImage,
    multi_fusion_1.MultiFusion,
    sku_image_1.SkuImage,
    local_redraw_1.LocalRedraw,
    expand_1.Expand,
    matting_1.Matting,
    remove_watermark_1.RemoveWatermark,
    image_translate_1.ImageTranslate,
    enhance_1.Enhance,
    recolor_1.Recolor,
    rotate_1.Rotate,
    free_create_1.FreeCreate,
    image_to_video_1.ImageToVideo,
    shoppable_carousel_1.ShoppableCarousel,
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
(0, capability_plugin_type_1.assertCapabilityIntegrity)(exports.CAPABILITY_PLUGINS);
//# sourceMappingURL=index.js.map