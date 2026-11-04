"use strict";
/**
 * 路由目录版本 —— 后台写入模型/价格/分组后递增，运行期按版本号决定是否重载快照。
 *
 * 为什么需要版本号而不是直接失效本地缓存：目录是进程内快照（P3 起使用），
 * 多实例部署时另一个进程改了价格，本进程的缓存仍然有效。短 TTL 能兜住，
 * 但「后台刚改完价格，前台仍然是旧价」在这套系统里是资损级问题，
 * 所以用一个数据库版本号做显式的跨进程信号：请求命中时比对版本，不一致就重载。
 *
 * 所有写入路径（渠道、渠道模型、价格档、前台模型、分组、插件）都必须调用
 * `invalidate()`；漏调不会报错，只会让其他实例在一段时间内用旧价 —— 因此
 * 这里的注释比代码更重要。
 */
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CatalogVersionService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const CATALOG_ROW_ID = 'catalog';
let CatalogVersionService = class CatalogVersionService {
    constructor(prisma) {
        this.prisma = prisma;
        this.listeners = new Set();
    }
    /** 读取当前版本（跨进程权威值）；表为空时返回 0，不创建行 */
    async current() {
        const row = await this.prisma.routeCatalogVersion.findUnique({ where: { id: CATALOG_ROW_ID } });
        return row?.version ?? 0;
    }
    /**
     * 递增版本并通知本进程订阅者。
     *
     * 用 `upsert + increment` 而不是「读-改-写」：两个管理员同时保存时，
     * 读改写会丢掉一次递增，导致第二个进程看不到第一次的变更。
     */
    async invalidate() {
        const row = await this.prisma.routeCatalogVersion.upsert({
            where: { id: CATALOG_ROW_ID },
            create: { id: CATALOG_ROW_ID, version: 1 },
            update: { version: { increment: 1 } },
        });
        for (const listener of this.listeners) {
            try {
                listener(row.version);
            }
            catch {
                // 订阅者异常不能影响写入结果：版本已经落库，重载失败会自然重试
            }
        }
        return row.version;
    }
    /** 订阅版本变化；返回取消订阅函数 */
    onChange(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
};
exports.CatalogVersionService = CatalogVersionService;
exports.CatalogVersionService = CatalogVersionService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], CatalogVersionService);
//# sourceMappingURL=catalog-version.service.js.map