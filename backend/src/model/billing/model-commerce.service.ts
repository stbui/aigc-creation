/**
 * 商品经营总览（`GET /api/v1/admin/model-commerce/overview`）。
 *
 * 商品台账需要回答的不是「这条线路能不能点开」，而是「它在卖什么、卖了
 * 多少、赚不赚钱、哪里还没准备好」。本服务把同一时间窗内的账单按
 * `channelModelId` 聚合，再与商品、供应商、能力绑定拼成一行。
 *
 * 口径与财务分析严格同源：
 *   · 实收只取 `settled` 的 actualAmount；
 *   · `route_switch` 是内部换线重预留，不计真实退款；
 *   · 成本统一调用 `billingCreditCost()`；只要该商品有一笔已结算账单的
 *     成本不可计算，成本与毛利都返回 null，绝不把未知写成 0。
 */

import { Injectable } from '@nestjs/common';
import { getCapability } from '../../capabilities/capability.registry';
import { badRequest } from '../domain/json';
import { PrismaService } from '../../prisma/prisma.service';
import { billingCreditCost } from './cost-amount';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAYS = 7;
const MAX_DAYS = 366;
const HIGH_REFUND_RATE = 0.1;
const LOW_MARGIN_RATE = 0.2;

export interface ModelCommerceProductView {
  channelModelId: string;
  channelId: string;
  channelName: string;
  modelKey: string;
  displayName: string;
  capability: string;
  protocol: string;
  enabled: boolean;
  channelEnabled: boolean;
  priceConfigured: boolean;
  calls: number;
  settledOrders: number;
  refundedOrders: number;
  netMicrocredits: number;
  refundedMicrocredits: number;
  /** 存在已结算但成本未知的账单时为 null */
  costMicrocredits: number | null;
  /** 净收入 - 成本；成本未知时为 null */
  marginMicrocredits: number | null;
  marginRate: number | null;
  refundRate: number | null;
  unknownCostOrders: number;
  bindingCount: number;
  enabledBindingCount: number;
  invalidBindingCount: number;
  noCalls: boolean;
  lowMargin: boolean;
  highRefund: boolean;
}

export interface ModelCommerceOverviewView {
  days: number;
  range: { from: string; to: string };
  summary: {
    products: number;
    calls: number;
    settledOrders: number;
    refundedOrders: number;
    netMicrocredits: number;
    refundedMicrocredits: number;
    costMicrocredits: number | null;
    marginMicrocredits: number | null;
    refundRate: number | null;
    unknownCostOrders: number;
    pendingPricingProducts: number;
    noCallsProducts: number;
    lowMarginProducts: number;
    highRefundProducts: number;
    invalidBindingCount: number;
    supplierDisabledProducts: number;
  };
  items: ModelCommerceProductView[];
}

interface ProductAggregate {
  calls: number;
  settledOrders: number;
  refundedOrders: number;
  charged: bigint;
  refunded: bigint;
  cost: bigint;
  costUnknown: boolean;
  unknownCostOrders: number;
}

function emptyAggregate(): ProductAggregate {
  return {
    calls: 0,
    settledOrders: 0,
    refundedOrders: 0,
    charged: 0n,
    refunded: 0n,
    cost: 0n,
    costUnknown: false,
    unknownCostOrders: 0,
  };
}

@Injectable()
export class ModelCommerceService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(rawDays?: string | number): Promise<ModelCommerceOverviewView> {
    const days = parseDays(rawDays);
    const to = new Date();
    const from = new Date(to.getTime() - days * DAY_MS);

    const [models, channels, bindings, orders] = await Promise.all([
      this.prisma.channelModel.findMany({
        where: { deletedAt: null },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          channelId: true,
          modelKey: true,
          displayName: true,
          capability: true,
          protocol: true,
          enabled: true,
          priceConfigured: true,
        },
      }),
      this.prisma.modelChannel.findMany({
        select: { id: true, name: true, enabled: true, deletedAt: true },
      }),
      this.prisma.capabilityModelBinding.findMany({
        select: { channelModelId: true, capabilityId: true, enabled: true },
      }),
      this.prisma.billingOrder.findMany({
        where: { createdAt: { gte: from, lte: to }, channelModelId: { not: '' } },
        select: {
          channelModelId: true,
          status: true,
          actualAmountMicrocredits: true,
          refundedAmountMicrocredits: true,
          refundReason: true,
          costConfigured: true,
          costBillingMode: true,
          costUnitPriceMicrocredits: true,
          costInputTokenPriceMicrocredits: true,
          costOutputTokenPriceMicrocredits: true,
          costCachedTokenPriceMicrocredits: true,
          costQuantity: true,
          costVideoFormulaTokens: true,
          inputTokens: true,
          outputTokens: true,
          cachedTokens: true,
          quantity: true,
        },
      }),
    ]);

    const channelById = new Map(channels.map((row) => [row.id, row]));
    const productIds = new Set(models.map((row) => row.id));
    const issueByProduct = new Map<string, { total: number; enabled: number; invalid: number }>();
    for (const binding of bindings) {
      if (!productIds.has(binding.channelModelId)) continue;
      const issue = issueByProduct.get(binding.channelModelId) ?? { total: 0, enabled: 0, invalid: 0 };
      issue.total += 1;
      if (binding.enabled) issue.enabled += 1;
      if (!getCapability(binding.capabilityId)) issue.invalid += 1;
      issueByProduct.set(binding.channelModelId, issue);
    }

    const aggregateByProduct = new Map<string, ProductAggregate>();
    for (const order of orders) {
      if (!productIds.has(order.channelModelId)) continue;
      const aggregate = aggregateByProduct.get(order.channelModelId) ?? emptyAggregate();
      aggregateByProduct.set(order.channelModelId, aggregate);
      aggregate.calls += 1;

      const charged = order.status === 'settled' ? order.actualAmountMicrocredits : 0n;
      const routeSwitch = order.refundReason === 'route_switch';
      const refunded = routeSwitch ? 0n : (order.refundedAmountMicrocredits ?? 0n);
      if (order.status === 'settled') aggregate.settledOrders += 1;
      if (order.status === 'refunded' && !routeSwitch) aggregate.refundedOrders += 1;
      aggregate.charged += charged;
      aggregate.refunded += refunded;

      if (order.status === 'settled') {
        const cost = billingCreditCost({
          ...order,
          costConfigured: Boolean(order.costConfigured),
          costBillingMode: order.costBillingMode ?? 'fixed_request',
          costVideoFormulaTokens: order.costVideoFormulaTokens ?? 0n,
          cachedTokens: order.cachedTokens ?? 0n,
          quantity: order.quantity ?? 0n,
        });
        if (cost === null) {
          aggregate.costUnknown = true;
          aggregate.unknownCostOrders += 1;
        } else {
          aggregate.cost += cost;
        }
      }
    }

    const items = models.map((model): ModelCommerceProductView => {
      const channel = channelById.get(model.channelId);
      const channelEnabled = Boolean(channel?.enabled && !channel.deletedAt);
      const aggregate = aggregateByProduct.get(model.id) ?? emptyAggregate();
      const binding = issueByProduct.get(model.id) ?? { total: 0, enabled: 0, invalid: 0 };
      const net = aggregate.charged - aggregate.refunded;
      const cost = aggregate.costUnknown ? null : aggregate.cost;
      const margin = cost === null ? null : net - cost;
      const decided = aggregate.settledOrders + aggregate.refundedOrders;
      const refundRate = decided === 0 ? null : round4(aggregate.refundedOrders / decided);
      const marginRate = margin === null || net <= 0n ? null : round4(Number(margin) / Number(net));
      return {
        channelModelId: model.id,
        channelId: model.channelId,
        channelName: channel?.name ?? '',
        modelKey: model.modelKey,
        displayName: model.displayName || model.modelKey,
        capability: model.capability,
        protocol: model.protocol,
        enabled: model.enabled,
        channelEnabled,
        priceConfigured: model.priceConfigured,
        calls: aggregate.calls,
        settledOrders: aggregate.settledOrders,
        refundedOrders: aggregate.refundedOrders,
        netMicrocredits: Number(net),
        refundedMicrocredits: Number(aggregate.refunded),
        costMicrocredits: cost === null ? null : Number(cost),
        marginMicrocredits: margin === null ? null : Number(margin),
        marginRate,
        refundRate,
        unknownCostOrders: aggregate.unknownCostOrders,
        bindingCount: binding.total,
        enabledBindingCount: binding.enabled,
        invalidBindingCount: binding.invalid,
        noCalls: aggregate.calls === 0,
        lowMargin:
          aggregate.settledOrders > 0 &&
          margin !== null &&
          (margin < 0n || marginRate === null || marginRate < LOW_MARGIN_RATE),
        highRefund: refundRate !== null && refundRate >= HIGH_REFUND_RATE,
      };
    });
    items.sort(
      (left, right) =>
        left.displayName.localeCompare(right.displayName, 'zh-CN') ||
        left.modelKey.localeCompare(right.modelKey) ||
        left.channelName.localeCompare(right.channelName, 'zh-CN'),
    );

    const invalidBindingIds = bindings.filter(
      (binding) => !productIds.has(binding.channelModelId) || !getCapability(binding.capabilityId),
    ).length;
    const totals = items.reduce(
      (sum, item) => {
        sum.calls += item.calls;
        sum.settledOrders += item.settledOrders;
        sum.refundedOrders += item.refundedOrders;
        sum.netMicrocredits += item.netMicrocredits;
        sum.refundedMicrocredits += item.refundedMicrocredits;
        sum.unknownCostOrders += item.unknownCostOrders;
        if (item.costMicrocredits === null) sum.costUnknown = true;
        else sum.costMicrocredits += item.costMicrocredits;
        if (item.marginMicrocredits === null) sum.marginUnknown = true;
        else sum.marginMicrocredits += item.marginMicrocredits;
        if (!item.priceConfigured) sum.pendingPricingProducts += 1;
        if (item.noCalls) sum.noCallsProducts += 1;
        if (item.lowMargin) sum.lowMarginProducts += 1;
        if (item.highRefund) sum.highRefundProducts += 1;
        if (!item.channelEnabled) sum.supplierDisabledProducts += 1;
        return sum;
      },
      {
        calls: 0,
        settledOrders: 0,
        refundedOrders: 0,
        netMicrocredits: 0,
        refundedMicrocredits: 0,
        costMicrocredits: 0,
        marginMicrocredits: 0,
        costUnknown: false,
        marginUnknown: false,
        unknownCostOrders: 0,
        pendingPricingProducts: 0,
        noCallsProducts: 0,
        lowMarginProducts: 0,
        highRefundProducts: 0,
        supplierDisabledProducts: 0,
      },
    );
    const decided = totals.settledOrders + totals.refundedOrders;
    return {
      days,
      range: { from: from.toISOString(), to: to.toISOString() },
      summary: {
        products: items.length,
        calls: totals.calls,
        settledOrders: totals.settledOrders,
        refundedOrders: totals.refundedOrders,
        netMicrocredits: totals.netMicrocredits,
        refundedMicrocredits: totals.refundedMicrocredits,
        costMicrocredits: totals.costUnknown ? null : totals.costMicrocredits,
        marginMicrocredits: totals.marginUnknown ? null : totals.marginMicrocredits,
        refundRate: decided === 0 ? null : round4(totals.refundedOrders / decided),
        unknownCostOrders: totals.unknownCostOrders,
        pendingPricingProducts: totals.pendingPricingProducts,
        noCallsProducts: totals.noCallsProducts,
        lowMarginProducts: totals.lowMarginProducts,
        highRefundProducts: totals.highRefundProducts,
        invalidBindingCount: invalidBindingIds,
        supplierDisabledProducts: totals.supplierDisabledProducts,
      },
      items,
    };
  }
}

function parseDays(raw: string | number | undefined): number {
  if (raw === undefined || raw === null || String(raw).trim() === '') return DEFAULT_DAYS;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > MAX_DAYS) {
    throw badRequest(`days 必须是 1-${MAX_DAYS} 的整数`);
  }
  return value;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
