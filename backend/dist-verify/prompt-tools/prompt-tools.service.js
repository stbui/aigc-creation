"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var PromptToolsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PromptToolsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const storage_service_1 = require("../storage/storage.service");
const app_exception_1 = require("../common/app.exception");
const text_tool_service_1 = require("../model/text/text-tool.service");
const image_format_1 = require("../model/media/image-format");
/**
 * 提示词工具服务 —— AI 润色 / 图片转提示词。
 *
 * ## 定位
 *
 * 这两个功能**不产出图片**, 产出的是一段文字, 故走模型的 text 能力,
 * 不进 generate 任务体系 —— 没有任务、没有轮询、没有积分扣减, 是同步调用。
 *
 * ## 为什么不复用 generate 任务
 *
 * generate 的产物是 Asset + GenerationTask, 面向"生成一张图并留档"。
 * 润色产出的是**待填入表单的文本**, 不是作品; 若走任务体系, 用户每按一次
 * 润色就多一条任务记录, 作品列表会被"润色"刷屏, 语义完全不对。
 *
 * ## 与模型层的关系
 *
 * 文本调用本身交给 `TextToolService`(选路 / 协议 / 出站 / 调用记录),
 * 本文件只负责**业务**:
 *   1. 改写指令的措辞 (提示词策略, 便于运营调整而不动调用链);
 *   2. 素材归属校验与字节读取 (站内权限, 模型层不该知道素材表)。
 *
 * ## 无本地兜底
 *
 * 文本没有"本地算法"可言, 通道不可用即如实报错(502), 不编造模板文案。
 * 调用方(前端)负责把错误呈现给用户。
 */
let PromptToolsService = PromptToolsService_1 = class PromptToolsService {
    constructor(prisma, storage, textTool) {
        this.prisma = prisma;
        this.storage = storage;
        this.textTool = textTool;
        this.log = new common_1.Logger(PromptToolsService_1.name);
    }
    /**
     * AI 润色 —— 把用户的原始提示词改写得更专业、更完整。
     *
     * @param text 原始提示词
     * @param textOnly 是否仅润色文字 (不增删画面要素)
     * @param userId 调用记录归属
     */
    async polish(text, textOnly = false, userId) {
        const instructions = textOnly
            ? '你是资深电商视觉提示词工程师。请在**不改变画面主体、场景、光线、构图**的前提下，' +
                '把用户的描述润色为更专业、更有画面感的电商视觉提示词。' +
                '只改写措辞与语序，不新增画面要素，不删减已有要素。'
            : '你是资深电商视觉提示词工程师。请把用户的描述补全为一段完整、专业、' +
                '可直接用于文生图的电商视觉提示词：补齐主体细节、场景、光线、镜头、质感与风格，' +
                '但**不得臆造用户未提及的品牌、价格、销量、功效承诺等事实性信息**。' +
                '输出一段连贯的中文提示词，不要分点，不要解释，不要加引号。';
        const result = await this.textTool.generate({
            operation: 'prompt_polish',
            instructions,
            messages: [{ role: 'user', content: text }],
            maxTokens: 1024,
            temperature: 0.7,
            userId,
        });
        return { text: result.text, source: SOURCE_MODEL, model: result.model, usage: result.usage };
    }
    /**
     * 图片转提示词 —— 让多模态模型看图并写出可用于生图的描述。
     *
     * ## 图片怎么传给模型
     *
     * 走 **base64 data URL 内联**, 不传公网 URL:
     *   网关要回拉 URL 时, 本站素材地址在本地开发是 `http://localhost:4100/...`,
     *   网关服务器根本拉不到 —— 会静默超时或返回"图里没有内容"。
     *   base64 内联没有回拉环节, 是开发与生产都成立的唯一稳法。
     *
     * ## 素材读取的归属校验
     *
     * 只读**当前用户自己的**素材: 别人的素材 id 猜出来也读不到,
     * 避免把站内接口变成任意图片读取代理。
     */
    async imageToPrompt(ownerId, assetId, extra) {
        const asset = await this.prisma.asset.findUnique({ where: { id: assetId } });
        if (!asset || asset.ownerId !== ownerId) {
            throw new app_exception_1.AppError(40400, '素材不存在或无权限', 404);
        }
        const buffer = await this.readAssetBytes(asset.storageKey, asset.storageBackend);
        if (!buffer) {
            throw new app_exception_1.AppError(40400, '素材文件已丢失，无法解析', 404);
        }
        const dataUrl = this.toDataUrl(buffer, asset.format);
        const instructions = '你是资深的电商视觉分析师。请分析这张图片, 写出一段可用于文生图模型的**中文提示词**。' +
            '要求: 客观描述画面里真实存在的内容 (主体/材质/颜色/构图/光线/场景/风格), ' +
            '不要臆造图片里没有的东西, 不要写品牌名/价格/销量等事实性信息, ' +
            '不要分点, 输出纯一段连贯中文。';
        const userText = extra
            ? `请在客观描述的基础上, 额外关注: ${extra}`
            : '请客观描述这张图片, 输出一段可直接用于生图的中文提示词。';
        const result = await this.textTool.generate({
            operation: 'image_to_prompt',
            instructions,
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: userText },
                        { type: 'image_url', image_url: { url: dataUrl } },
                    ],
                },
            ],
            maxTokens: 1024,
            temperature: 0.5,
            userId: ownerId,
        });
        return { text: result.text, source: SOURCE_MODEL, model: result.model, usage: result.usage };
    }
    /**
     * 读素材字节。
     *
     * ⚠️ 必须按**素材记录里的 storageBackend** 取 provider ——
     * 切换默认后端后老素材仍存在原后端, 用当前默认后端读会全部读不到
     * (与 storage.service.ts 的同款约定)。
     */
    async readAssetBytes(storageKey, backend) {
        if (!storageKey)
            return null;
        const provider = this.storage.get(backend ?? this.storage.activeBackend);
        if (!provider)
            return null;
        try {
            return await provider.get(storageKey);
        }
        catch (e) {
            this.log.warn(`读取素材字节失败 (key=${storageKey}): ${e.message}`);
            return null;
        }
    }
    /**
     * 字节 → data URL。
     *
     * ⚠️ **格式按字节魔数判定, 不看扩展名/URL 后缀** ——
     * 第三方上传的图可能没有扩展名, 按后缀猜会把 PNG 当 JPEG 标,
     * 模型侧可能因格式不符而拒收 (实测踩过: 优云智算返回的 OSS 链接无扩展名)。
     */
    toDataUrl(buffer, declaredFormat) {
        const mime = (0, image_format_1.detectImageFormat)(buffer) ?? (declaredFormat ? `image/${declaredFormat}` : 'image/png');
        return `data:${mime};base64,${buffer.toString('base64')}`;
    }
};
exports.PromptToolsService = PromptToolsService;
exports.PromptToolsService = PromptToolsService = PromptToolsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        storage_service_1.StorageService,
        text_tool_service_1.TextToolService])
], PromptToolsService);
/** 模型产出的来源标记（文本没有本地兜底，故恒为此值） */
const SOURCE_MODEL = 'model';
//# sourceMappingURL=prompt-tools.service.js.map