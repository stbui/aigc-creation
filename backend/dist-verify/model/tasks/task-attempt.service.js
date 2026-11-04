"use strict";
/**
 * 线路尝试状态机。
 *
 * 移植自 open-ai-canvas `internal/app/model_router_attempts.go` 的
 * `beginTaskRouteAttempt` / `markRouteAttemptDispatching` / `finishTaskRouteAttempt`。
 *
 * 这张表存在的唯一理由：**判断一次失败到底有没有打到上游**。
 * 「请求没发出去」可以安全换线路重试；「请求可能已经发出」再发一次就可能
 * 让同一个请求在两台上游各扣一次费。四态 `dispatchState` 是这条判断的全部依据，
 * 因此每次派发前必须先做一次 CAS 把 `not_sent` 改成 `submission_unknown` ——
 * CAS 失败说明另一个执行者已经带着这个 attempt 出发，本次必须停下。
 *
 * 只有 `rejected_no_job`（上游明确没有建立任务：渠道槽位失败 / 401 / 403 / 404 / 429）
 * 才允许切线；`submission_unknown` 一律停住等人工或恢复流程。
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
exports.TaskAttemptService = exports.DISPATCH_STATES = exports.ATTEMPT_STATUSES = void 0;
exports.safeRouteRejection = safeRouteRejection;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
/** 尝试状态 */
exports.ATTEMPT_STATUSES = ['selected', 'dispatching', 'succeeded', 'failed'];
/** 派发状态 */
exports.DISPATCH_STATES = ['not_sent', 'submission_unknown', 'accepted', 'rejected_no_job'];
/**
 * 失败是否属于「上游明确没有接下这个任务」。
 *
 * 判据只有两类：
 *   · 渠道槽位 / 渠道可用性失败 —— 请求根本没发出去（`channel_unavailable`）；
 *   · 上游以 401 / 403 / 404 / 429 拒绝 —— 请求到了但被拒之门外，没有建立任务。
 *
 * 超时、5xx、连接中断**不在**其中：这些情况下上游可能已经在生成并计费，
 * 换线路重发等于让用户为两次调用付费。宁可停在 `submission_unknown` 等人工。
 */
function safeRouteRejection(failureCode) {
    switch (String(failureCode ?? '').trim()) {
        case 'channel_unavailable':
        case 'upstream_401':
        case 'upstream_403':
        case 'upstream_404':
        case 'upstream_429':
            return true;
        default:
            return false;
    }
}
let TaskAttemptService = class TaskAttemptService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    /** 选路成功即建一条 `selected/not_sent` */
    async create(input) {
        return this.prisma.routeAttempt.create({
            data: {
                taskId: input.taskId,
                routeRun: input.routeRun,
                attemptNumber: input.attemptNumber,
                logicalModelId: input.logicalModelId,
                logicalModelRevisionId: input.logicalModelRevisionId,
                routeId: input.routeId,
                channelModelId: input.channelModelId,
                channelId: input.channelId,
                status: 'selected',
                dispatchState: 'not_sent',
            },
        });
    }
    /** 本轮全部尝试（切换线路时用它们的 routeId 组成排除集） */
    async listRun(taskId, routeRun) {
        return this.prisma.routeAttempt.findMany({
            where: { taskId, routeRun },
            orderBy: { attemptNumber: 'asc' },
        });
    }
    /** 本轮最后一次尝试（执行器恢复时读它） */
    async latest(taskId, routeRun) {
        return this.prisma.routeAttempt.findFirst({
            where: { taskId, routeRun },
            orderBy: { attemptNumber: 'desc' },
        });
    }
    /**
     * 决定本轮要做的事，并（需要派发时）完成 CAS。
     *
     * | 当前态 | 结果 |
     * | --- | --- |
     * | `not_sent` | CAS 成 `submission_unknown` + `dispatching`，返回 dispatch |
     * | `submission_unknown` | 结果不明：返回 uncertain，**禁止重发** |
     * | `accepted` | 已建上游任务：返回 poll（带上游任务 id 续轮询） |
     * | `rejected_no_job` | 上游明确没接：返回 switch |
     * | `succeeded` / `failed` | 已终结：返回 done |
     */
    async begin(attempt) {
        if (attempt.status === 'succeeded' || attempt.status === 'failed') {
            return { action: 'done', attempt };
        }
        if (attempt.dispatchState === 'accepted') {
            return { action: 'poll', attempt };
        }
        if (attempt.dispatchState === 'rejected_no_job') {
            return { action: 'switch', attempt };
        }
        if (attempt.dispatchState === 'submission_unknown') {
            return { action: 'uncertain', attempt };
        }
        // CAS：只有把 not_sent 改成 submission_unknown 的那一次调用可以出发
        const claimed = await this.prisma.routeAttempt.updateMany({
            where: { id: attempt.id, dispatchState: 'not_sent' },
            data: { dispatchState: 'submission_unknown', status: 'dispatching' },
        });
        const current = await this.prisma.routeAttempt.findUnique({ where: { id: attempt.id } });
        if (!current)
            return { action: 'uncertain', attempt };
        if (claimed.count !== 1) {
            // 别人抢先派发了：结果不明，本次不得重发
            return { action: current.dispatchState === 'accepted' ? 'poll' : 'uncertain', attempt: current };
        }
        return { action: 'dispatch', attempt: current };
    }
    /** 上游已接受：记录上游任务 id，此后失败不再切线 */
    async markAccepted(attemptId, providerRequestId) {
        await this.prisma.routeAttempt.updateMany({
            where: { id: attemptId, status: 'dispatching' },
            data: {
                dispatchState: 'accepted',
                ...(String(providerRequestId ?? '').trim() !== ''
                    ? { providerRequestId: String(providerRequestId).trim() }
                    : {}),
            },
        });
    }
    async markSucceeded(attemptId, providerRequestId = '') {
        await this.prisma.routeAttempt.update({
            where: { id: attemptId },
            data: {
                status: 'succeeded',
                dispatchState: 'accepted',
                completedAt: new Date(),
                ...(String(providerRequestId ?? '').trim() !== '' ? { providerRequestId: String(providerRequestId).trim() } : {}),
            },
        });
    }
    /**
     * 记录一次失败。
     *
     * @param failureCode  归一后的失败码（`upstream_401` / `timeout` / …）
     * @param rejectedNoJob 上游是否明确没有接下任务；为真时写入 `rejected_no_job`
     */
    async markFailed(attemptId, input) {
        await this.prisma.routeAttempt.updateMany({
            where: { id: attemptId },
            data: {
                status: 'failed',
                dispatchState: input.rejectedNoJob ? 'rejected_no_job' : 'submission_unknown',
                failureCode: String(input.failureCode ?? '').slice(0, 120),
                failureMessage: String(input.failureMessage ?? '').slice(0, 1000),
                completedAt: new Date(),
                ...(String(input.providerRequestId ?? '').trim() !== ''
                    ? { providerRequestId: String(input.providerRequestId).trim() }
                    : {}),
            },
        });
    }
};
exports.TaskAttemptService = TaskAttemptService;
exports.TaskAttemptService = TaskAttemptService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], TaskAttemptService);
//# sourceMappingURL=task-attempt.service.js.map