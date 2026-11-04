"use strict";
/**
 * 渠道并发槽 —— 在进程内限制同一渠道的同时请求数。
 *
 * 移植自 open-ai-canvas `internal/app/channel_concurrency.go` 的
 * `acquireChannelSlot` / `releaseChannelSlot`：渠道声明的 `concurrencyLimit` 是
 * 上游合同的一部分（超限会被厂商直接 429 甚至封号），因此派发前必须先拿槽位。
 *
 * 三条约束：
 *   1. **拿不到槽位等于「请求没发出去」** —— 抛 `ChannelUnavailableError`，
 *      调度器据此切线，不会让一次限流变成用户的失败；
 *   2. 等待采用 200ms 起步的指数退避（上限 2s，加 ±20% 抖动），避免所有实例
 *      在同一毫秒重试；
 *   3. 槽位只在**本次调用**期间持有，请求返回（无论成败）立即释放。
 *
 * 本仓没有 Redis：槽位只做进程内。多实例部署时每个进程各自计数，
 * 极端情况下瞬时可能略超渠道上限 —— 与冷却一样，代价是不精确而非错误。
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
exports.ChannelSlotService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const channel_runtime_service_1 = require("../channels/channel-runtime.service");
/** 等槽位的上限兜底值（`MODEL_SLOT_WAIT_MS` 覆盖）；超过即按「渠道忙」切线，不无限排队 */
const SLOT_WAIT_MS = 60_000;
const BACKOFF_START_MS = 200;
const BACKOFF_MAX_MS = 2_000;
let ChannelSlotService = class ChannelSlotService {
    constructor(config) {
        this.config = config;
        /** channelId → 已占用的槽位数 */
        this.used = new Map();
    }
    /**
     * 等槽位上限。
     *
     * 走配置层而不是写死常量：验收脚本要把「渠道忙」的判定压到百毫秒级，
     * 否则一次断言要等满 60 秒；生产默认值不变。
     */
    get waitMs() {
        const value = this.config.get('model.slotWaitMs');
        return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : SLOT_WAIT_MS;
    }
    /**
     * 占用一个槽位。
     *
     * @param channelId 渠道 id
     * @param limit     渠道并发上限；`0` 表示不限制（直接返回释放函数）
     * @returns 释放函数；必须在 `finally` 中调用
     */
    async acquire(channelId, limit) {
        if (!(limit > 0))
            return () => undefined;
        const deadline = Date.now() + this.waitMs;
        let delay = BACKOFF_START_MS;
        for (;;) {
            const current = this.used.get(channelId) ?? 0;
            if (current < limit) {
                this.used.set(channelId, current + 1);
                let released = false;
                return () => {
                    if (released)
                        return;
                    released = true;
                    const next = (this.used.get(channelId) ?? 1) - 1;
                    if (next <= 0)
                        this.used.delete(channelId);
                    else
                        this.used.set(channelId, next);
                };
            }
            if (Date.now() + delay > deadline) {
                throw new channel_runtime_service_1.ChannelUnavailableError(`渠道并发已满（${current}/${limit}），本次未发出请求`, 'channel_busy');
            }
            await sleep(delay + Math.floor(Math.random() * delay * 0.2));
            delay = Math.min(BACKOFF_MAX_MS, Math.round(delay * 1.5));
        }
    }
    /** 后台观测用：当前各渠道占用数 */
    snapshot() {
        return Object.fromEntries(this.used);
    }
};
exports.ChannelSlotService = ChannelSlotService;
exports.ChannelSlotService = ChannelSlotService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], ChannelSlotService);
function sleep(ms) {
    return new Promise((resolve) => {
        const timer = setTimeout(resolve, ms);
        timer.unref?.();
    });
}
//# sourceMappingURL=channel-slot.service.js.map