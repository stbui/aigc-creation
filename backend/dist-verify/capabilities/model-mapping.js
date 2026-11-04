"use strict";
/**
 * 能力参数 → 模型请求意图的公共构造器。
 *
 * 16 项能力的参数表各不相同，但落到模型请求上只有三种形状：
 *   · 生图（有参考图走图生图，没有走文生图）；
 *   · 编辑（参考图就是底图，恒为图生图）；
 *   · 图生视频。
 *
 * 所有能力共用这里的换算，避免每项能力各写一份「ratio 怎么变成 size」——
 * 一旦分叉，匹配、计价、实际请求就会各说各话（`docs/channel-model-design.md` §8.2）。
 *
 * 约定：
 *   · `ratio` 参数里的 `original` 是**能力侧**的「保持原图比例」语义，不是模型预设，
 *     因此不进入意图；由能力合同里的默认尺寸兜底。
 *   · 画质档位统一成小写 `1k/1.5k/2k/4k`；上游要像素时由协议层的图片参数合同换算。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.imageOptions = imageOptions;
exports.videoOptions = videoOptions;
exports.generateImageIntent = generateImageIntent;
exports.editImageIntent = editImageIntent;
exports.fusionImageIntent = fusionImageIntent;
exports.imageToVideoIntent = imageToVideoIntent;
/** 画质档位：只承认规范档位，其余值（如 'original' / 空串）不进意图 */
const QUALITY_TIERS = new Set(['1k', '1.5k', '2k', '4k']);
function text(value) {
    return String(value ?? '').trim();
}
/** 比例参数 → 意图 `size`；`original` 与空值不参与（交给模型默认值） */
function intentSize(rawRatio) {
    const ratio = text(rawRatio);
    if (ratio === '' || ratio.toLowerCase() === 'original')
        return '';
    return ratio;
}
/** 画质参数 → 意图 `imageResolution` 档位 */
function intentTier(rawQuality) {
    const tier = text(rawQuality).toLowerCase();
    return QUALITY_TIERS.has(tier) ? tier : '';
}
/**
 * 图片类能力共用的请求参数。
 *
 * @param params 能力参数（已 `sanitizeParams`）
 * @param count  张数（多图融合的变体数）；缺省不进意图
 */
function imageOptions(params, count) {
    const options = {};
    const size = intentSize(params?.ratio);
    if (size !== '')
        options.size = size;
    // `matting` 用 `resolution` 表达画质，其余能力用 `size`（画质档）
    const tier = intentTier(params?.resolution) || intentTier(params?.size);
    if (tier !== '')
        options.imageResolution = tier;
    if (count !== undefined && count > 0)
        options.count = count;
    return options;
}
/** 视频类能力共用的请求参数：时长按秒、分辨率档、画面比例 */
function videoOptions(params) {
    const options = {};
    const seconds = Number.parseInt(text(params?.duration), 10);
    if (Number.isFinite(seconds) && seconds > 0)
        options.videoSeconds = seconds;
    const resolution = text(params?.resolution).toLowerCase();
    if (resolution !== '' && resolution !== 'original')
        options.vquality = resolution;
    const size = intentSize(params?.ratio);
    if (size !== '')
        options.size = size;
    return options;
}
/** 参考素材数量 → 意图 `inputs`（只带实际传了的类型，0 值不带） */
function intentInputs(inputs) {
    const result = {};
    if (inputs.image > 0)
        result.image = inputs.image;
    if (inputs.video > 0)
        result.video = inputs.video;
    return result;
}
/**
 * 生图类：带参考图 → 图生图，否则文生图。
 *
 * `operation` 由**实际参考图数量**决定而不是能力声明 —— 自由创作允许 0 张，
 * 声明层只能给出「最多 1 张」，真实请求要按本次提交判断。
 */
function generateImageIntent(params, inputs) {
    const references = Math.max(0, inputs.image);
    return {
        capability: 'image',
        operation: references > 0 ? 'image_to_image' : 'text_to_image',
        inputs: intentInputs({ image: references, video: 0 }),
        options: imageOptions(params),
    };
}
/** 编辑类：参考图即底图，恒为图生图（不允许退化成文生图） */
function editImageIntent(params, inputs) {
    const references = Math.max(0, inputs.image);
    const requestInputs = intentInputs({ image: references, video: 0 });
    // 遮罩是编辑请求的必选供给侧能力：必须进入意图，路由才能在候选阶段排除
    // 不支持 mask 的线路，而不是选中后到准入阶段才报 42205。
    if (text(params?.modelGuideAssetId) !== '' || text(params?.maskAssetId) !== '') {
        requestInputs.mask = 1;
    }
    return {
        capability: 'image',
        operation: 'image_to_image',
        inputs: requestInputs,
        options: imageOptions(params),
    };
}
/** 多图融合：图生图 + 变体张数（`variantCount` 参与价格档与供给能力匹配） */
function fusionImageIntent(params, inputs) {
    const references = Math.max(0, inputs.image);
    const count = Math.max(1, Math.min(4, Math.trunc(Number(params?.variantCount) || 1)));
    return {
        capability: 'image',
        operation: 'image_to_image',
        inputs: intentInputs({ image: references, video: 0 }),
        options: imageOptions(params, count),
    };
}
/** 图生视频 */
function imageToVideoIntent(params, inputs) {
    return {
        capability: 'video',
        operation: 'image_to_video',
        inputs: intentInputs({ image: Math.max(0, inputs.image), video: 0 }),
        options: videoOptions(params),
    };
}
//# sourceMappingURL=model-mapping.js.map