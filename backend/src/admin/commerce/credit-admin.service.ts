import { Injectable } from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import {
  CREDIT_BUSINESS_TYPES,
  CreditService,
  emptyBalanceSummary,
  microcreditsToCredits,
  projectEntry,
} from "../../credits/credit.service";
import { AppError } from "../../common/app.exception";
import { buildPage, paginate } from "../dto/page-query.dto";
import { parseCsv, toCsv, type CsvColumn } from "../../common/csv";
import {
  EXPORT_LIMIT,
  IMPORT_LIMIT,
  LEDGER_TYPES,
  type CreditLedgerQuery,
} from "./commerce-admin.types";
import { dateRange } from "./commerce-admin.util";

/**
 * 后台积分账本：总览 / 批次 / 流水 / 批量调整 / CSV 导入 / 导出。
 *
 * 所有金额在库里是 BigInt 微积分，出参统一投影成积分口径 ——
 * 直接返回 Prisma 行会让 `JSON.stringify` 在 BigInt 上抛错。
 */
@Injectable()
export class AdminCommerceCreditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credit: CreditService,
  ) {}

  async listCredits(query: {
    userId?: string;
    email?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = buildPage(query, ["createdAt"], "createdAt:desc");
    const where: Prisma.UserWhereInput = {};
    if (query.userId) where.id = query.userId;
    if (query.email) where.email = { contains: query.email };

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip: page.skip,
        take: page.take,
        orderBy: { createdAt: "desc" },
        select: { id: true, email: true, name: true, status: true, createdAt: true },
      }),
      this.prisma.user.count({ where }),
    ]);

    // 当前页用户一次分组聚合；逐用户调用 balanceOf 会放大成 4×N 次查询
    const summaries = await this.credit.balancesOf(users.map((user) => user.id));
    const items = users.map((user) => {
      const summary = summaries.get(user.id);
      return {
        userId: user.id,
        email: user.email,
        name: user.name,
        // 列表口径不筛状态（注销账号的历史仍可查），前端据此禁掉「再次删除」
        status: user.status,
        balance: summary?.balance ?? 0,
        expiringSoon: summary?.expiringSoon ?? 0,
        totalEarned: summary?.totalEarned ?? 0,
        totalConsumed: summary?.totalConsumed ?? 0,
        activeLots: summary?.activeLots ?? 0,
        nearestExpiry: summary?.nearestExpiry ?? null,
      };
    });
    return paginate(items, total, page);
  }

  /**
   * 积分批次（后台只读）。
   *
   * 库里的金额是 BigInt 微积分，必须投影成积分口径再出参 —— 直接返回 Prisma 行
   * 会让 `JSON.stringify` 在 BigInt 上抛错。`status` 与 C 端口径保持一致。
   */
  async creditLots(userId: string, query: { from?: string; to?: string } = {}) {
    const range = dateRange(query.from, query.to);
    const rows = await this.prisma.creditLot.findMany({
      where: { userId, ...(range ? { createdAt: range } : {}) },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    const now = Date.now();
    return rows.map((row) => {
      const remaining = microcreditsToCredits(row.remainingMicrocredits);
      return {
        id: row.id,
        userId: row.userId,
        source: row.source,
        orderId: row.orderId,
        totalCredits: microcreditsToCredits(row.totalMicrocredits),
        remainingCredits: remaining,
        expireAt: row.expireAt,
        createdAt: row.createdAt,
        status:
          remaining <= 0
            ? "exhausted"
            : row.expireAt && row.expireAt.getTime() <= now
              ? "expired"
              : "active",
      };
    });
  }

  async creditLedger(userId: string, query: CreditLedgerQuery = {}) {
    const where: Prisma.CreditLedgerEntryWhereInput = { userId };
    if (query.type) {
      if (!(LEDGER_TYPES as readonly string[]).includes(query.type)) {
        throw new AppError(40001, `流水类型非法: ${query.type}`, 400);
      }
      where.type = query.type;
    }
    if (query.businessType) {
      if (!(CREDIT_BUSINESS_TYPES as readonly string[]).includes(query.businessType)) {
        throw new AppError(40001, `业务类型非法: ${query.businessType}`, 400);
      }
      where.businessType = query.businessType;
    }
    const range = dateRange(query.from, query.to);
    if (range) where.createdAt = range;

    const limit = Math.min(query.limit ?? 50, 500);
    const rows = await this.prisma.creditLedgerEntry.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return rows.map(projectEntry);
  }

  /**
   * 批量调整积分。
   *
   * 逐条独立执行并回传每条结果: 批量操作里一条失败不该让其余 99 条不生效,
   * 但失败必须逐条列出来 —— 否则运营看到"已完成"却少了一条, 只能靠对账发现。
   * 失败原因不改写成通用文案, 保留 service 抛出的原始提示 (如"余额不足")。
   *
   * ## 幂等
   *
   * 每条按 `batch:{operatorId}:{batchKey}:{rowNo}` 落幂等键。同一批重试时
   * 已成功的行直接命中已有流水、不再二次发放；`batchKey` 由调用方传入
   * （前端在打开抽屉时生成一次），缺省则按本次请求生成随机值 —— 那种情况下
   * 重试**没有**防重保护，属于调用方主动放弃。
   *
   * 行号参与键：同一批里同一用户可能出现两次（如「先补 100 再扣 20」），
   * 只用 userId 做键会把第二行误判成重试。
   */
  async batchAdjust(
    items: Array<{ userId: string; delta?: number; reason?: string }>,
    shared: {
      operatorId: string;
      validDays?: number;
      reason?: string;
      idempotencyKey?: string;
    },
  ) {
    const results: Array<{
      userId: string;
      success: boolean;
      balance?: number;
      message?: string;
      idempotentHit?: boolean;
    }> = [];

    const reason = String(shared.reason ?? "").trim();
    const batchKey =
      String(shared.idempotencyKey ?? "").trim() ||
      `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    // 先批量取一次存在的用户: 逐条撞外键的话, 返回给运营的是 Prisma 的
    // 英文外键报错 (带 SQL 上下文), 既不可读也把实现细节泄进了界面
    const ids = Array.from(new Set(items.map((item) => item.userId)));
    const known = new Set(
      (
        await this.prisma.user.findMany({
          where: { id: { in: ids } },
          select: { id: true },
        })
      ).map((user) => user.id),
    );

    for (const [index, item] of items.entries()) {
      const delta = item.delta ?? 0;
      if (!known.has(item.userId)) {
        results.push({
          userId: item.userId,
          success: false,
          message: "用户不存在",
        });
        continue;
      }
      try {
        const result = await this.credit.adminAdjust({
          userId: item.userId,
          delta,
          // 单条可覆盖整批原因（批量里常有「个别特殊补偿」）
          reason: String(item.reason ?? "").trim() || reason || undefined,
          operatorId: shared.operatorId,
          validDays: shared.validDays,
          idempotencyKey: `batch:${shared.operatorId}:${batchKey}:${index}`,
        });
        results.push({
          userId: item.userId,
          success: true,
          balance: result.balance,
          ...(result.idempotentHit ? { idempotentHit: true } : {}),
        });
      } catch (error) {
        results.push({
          userId: item.userId,
          success: false,
          message: (error as Error).message || "调整失败",
        });
      }
    }
    return {
      total: results.length,
      succeeded: results.filter((result) => result.success).length,
      failed: results.filter((result) => !result.success).length,
      // 重试时命中的行数，便于运营判断「这次是不是重复提交」
      idempotentHits: results.filter((result) => result.idempotentHit).length,
      results,
    };
  }

  /**
   * 积分 CSV 导入（B7）。
   *
   * 表格列：`email,delta[,reason]`，首行可选表头（`email` / `邮箱`）。
   * 用邮箱而不是用户 id 定位 —— 运营手里的表格从来只有邮箱。
   *
   * 三条边界，缺一条都会在真实运营场景里出事：
   *   · **整批上限 500 行**。再多就不是"补发"而是"结算"，应当拆批留痕；
   *     同时在 2MB 文件上限内保证一次请求不会跑太久。
   *   · **逐行独立成败**。某行邮箱写错不该让另外 499 行不生效；但失败必须
   *     逐行列出，否则运营看到"完成"却少发了几个人，只能等用户来投诉。
   *   · **说明稳定**。逐行 `reason` 列优先，缺省用固定说明；
   *     积分账本必须能解释每一笔变动。
   *
   * 权限口径见 controller：走 `credit.adjust` 而非通用导入权限，这是给钱。
   */
  async importCreditsCsv(
    text: string,
    opts: { validDays?: number; operatorId: string; importKey?: string },
  ) {
    const rows = parseCsv(text);
    if (rows.length === 0) {
      throw new AppError(40001, "CSV 内容为空", 400);
    }

    // 表头可选：运营自己用 Excel 导出的文件通常带表头，程序生成的往往不带
    const first = rows[0].map((cell) => cell.trim().toLowerCase());
    const hasHeader = ["email", "邮箱", "e-mail"].includes(first[0] ?? "");
    const body = hasHeader ? rows.slice(1) : rows;

    if (body.length === 0) {
      throw new AppError(40001, "CSV 只有表头，没有数据行", 400);
    }
    if (body.length > IMPORT_LIMIT) {
      throw new AppError(
        40001,
        `单次最多导入 ${IMPORT_LIMIT} 行，当前 ${body.length} 行，请拆分后重试`,
        400,
      );
    }

    type Parsed = {
      row: number;
      email: string;
      delta?: number;
      reason?: string;
      error?: string;
    };
    const parsed: Parsed[] = body.map((cells, index) => {
      // 行号按用户在 Excel 里看到的算：带表头时数据首行是第 2 行
      const row = index + (hasHeader ? 2 : 1);
      const email = (cells[0] ?? "").trim();
      const rawDelta = (cells[1] ?? "").trim();
      const reason = (cells[2] ?? "").trim();
      const delta = /^[+-]?\d+$/.test(rawDelta) ? Number(rawDelta) : Number.NaN;
      let error: string | undefined;
      if (!email) error = "缺少邮箱";
      else if (!rawDelta) error = "缺少调整值";
      else if (Number.isNaN(delta)) error = `调整值必须是整数：${rawDelta}`;
      else if (delta === 0) error = "调整值不能为 0";
      return {
        row,
        email,
        delta: Number.isNaN(delta) ? undefined : delta,
        reason: reason || undefined,
        error,
      };
    });

    // 邮箱一律小写比对：库内是注册时 toLowerCase 存的，表格里常有大写
    const wanted = Array.from(
      new Set(parsed.filter((item) => item.email).map((item) => item.email.toLowerCase())),
    );
    const users = await this.prisma.user.findMany({
      where: { email: { in: wanted } },
      select: { id: true, email: true },
    });
    const idByEmail = new Map(
      users.map((user) => [user.email.toLowerCase(), user.id]),
    );

    /*
     * 缺省说明不再是「CSV 导入用户积分」这种等于没写的固定文案：
     * 带上文件名以外的可辨识信息（行号由幂等键体现），并明确要求
     * 运营在第三列写清原因 —— 积分账本要能回答「为什么给他加」。
     */
    const sharedReason = "CSV 导入用户积分（未填写逐行原因）";
    /* 导入批次的幂等前缀：同一份文件重复提交时，已成功的行不再二次发放 */
    const importKey =
      String(opts.importKey ?? "").trim() ||
      `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const results: Array<{
      row: number;
      email: string;
      delta: number;
      success: boolean;
      balance?: number;
      message?: string;
      idempotentHit?: boolean;
    }> = [];

    for (const item of parsed) {
      if (item.error || !item.delta) {
        results.push({
          row: item.row,
          email: item.email,
          delta: item.delta ?? 0,
          success: false,
          message: item.error ?? "数据非法",
        });
        continue;
      }
      const userId = idByEmail.get(item.email.toLowerCase());
      if (!userId) {
        results.push({
          row: item.row,
          email: item.email,
          delta: item.delta,
          success: false,
          message: "用户不存在",
        });
        continue;
      }
      try {
        const result = await this.credit.adminAdjust({
          userId,
          delta: item.delta,
          reason: item.reason ?? sharedReason,
          operatorId: opts.operatorId,
          validDays: opts.validDays,
          // 行号而非邮箱做键：同一文件里同一邮箱可能出现多行（补发 + 扣减）
          idempotencyKey: `import:${opts.operatorId}:${importKey}:${item.row}`,
        });
        results.push({
          row: item.row,
          email: item.email,
          delta: item.delta,
          success: true,
          balance: result.balance,
          ...(result.idempotentHit ? { idempotentHit: true } : {}),
        });
      } catch (error) {
        results.push({
          row: item.row,
          email: item.email,
          delta: item.delta,
          success: false,
          message: (error as Error).message || "调整失败",
        });
      }
    }

    return {
      total: results.length,
      succeeded: results.filter((result) => result.success).length,
      failed: results.filter((result) => !result.success).length,
      idempotentHits: results.filter((result) => result.idempotentHit).length,
      results,
    };
  }

  async exportCredits(query: { userId?: string; email?: string }): Promise<string> {
    const where: Prisma.UserWhereInput = {};
    if (query.userId) where.id = query.userId;
    if (query.email) where.email = { contains: query.email };

    // 与订单 / 支付导出同一口径：超限失败，不静默截断
    const total = await this.prisma.user.count({ where });
    if (total > EXPORT_LIMIT) {
      throw new AppError(
        40001,
        `筛选结果共 ${total} 人，超过单次导出上限 ${EXPORT_LIMIT} 人，请缩小筛选范围后分批导出`,
        400,
      );
    }

    const users = await this.prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: EXPORT_LIMIT,
      select: { id: true, email: true, name: true },
    });

    const summaries = await this.credit.balancesOf(users.map((user) => user.id));
    const rows = users.map((user) => ({
      ...user,
      summary: summaries.get(user.id) ?? emptyBalanceSummary(),
    }));
    const columns: CsvColumn<(typeof rows)[number]>[] = [
      { label: "用户ID", value: (row) => row.id },
      { label: "邮箱", value: (row) => row.email },
      { label: "昵称", value: (row) => row.name },
      { label: "当前余额", value: (row) => row.summary.balance },
      { label: "30天内到期", value: (row) => row.summary.expiringSoon },
      { label: "累计获得", value: (row) => row.summary.totalEarned },
      { label: "累计消耗", value: (row) => row.summary.totalConsumed },
      { label: "有效批次", value: (row) => row.summary.activeLots },
      { label: "最近到期", value: (row) => row.summary.nearestExpiry ?? "" },
    ];
    return toCsv(columns, rows);
  }
}
