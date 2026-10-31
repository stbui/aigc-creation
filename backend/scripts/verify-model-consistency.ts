/**
 * 渠道 / 渠道模型 / 价格档一致性校验（P1 验收脚本）。
 *
 * 为什么需要它：这些约束分散在「保存路径」「软删除唯一键」「档位摘要回填」三处，
 * 任何一处漏写都不会立刻报错，只会表现为「后台显示的价格与实际扣费不一致」或
 * 「同一个规格能保存出两个档位」。这类问题在上线后极难定位，必须在数据层直接断言。
 *
 * 校验项：
 *   1. 软删除唯一键：存活行 `activeKey` 必须与业务键一致，删除行必须为 null；
 *   2. 同渠道存活模型 / 同模型存活价格档不得重复；
 *   3. 价格档 `selectorKey` 必须是选择器的规范 JSON（键排序），且 `selectorJson` 同值；
 *   4. 价格档必须落在渠道模型的能力合同内（分辨率 / 时长 / 图片参数）；
 *   5. 渠道模型行的摘要字段（计费方式 / 单价 / 是否已定价）必须等于价格档汇总；
 *   6. 渠道兼容清单 `modelsJson` 必须等于启用中的模型键（有模型行时）。
 *
 * 运行：NODE_ENV=test npm run verify:model-consistency
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

import { PrismaClient } from '@prisma/client';
import { NodeSQLiteDriverAdapterFactory } from '../src/prisma/node-sqlite-adapter';
import {
  applyChannelModelPriceTierSummary,
  canonicalSkuSelector,
  decodeSkuSelector,
  validateChannelModelTierCapabilities,
} from '../src/model/domain/selector';
import { decodeCapabilityConfig } from '../src/model/domain/capability-config';

const { resolveDbUrl } = require('./db-url');

const prisma = new PrismaClient({
  adapter: new NodeSQLiteDriverAdapterFactory({ url: resolveDbUrl() }),
});

let pass = 0;
const fails: string[] = [];
const ok = (name: string, condition: boolean, detail?: unknown) => {
  if (condition) {
    pass += 1;
    return;
  }
  fails.push(`${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`);
};

/** 与 `channel.presentation.ts` 的 channelModelActiveKey 逐字一致 */
function activeKeyOf(modelKey: string): string {
  return String(modelKey ?? '')
    .trim()
    .replace(/^models\//, '')
    .toLowerCase();
}

async function main(): Promise<void> {
  const channels = await prisma.modelChannel.findMany({ where: { deletedAt: null } });
  const models = await prisma.channelModel.findMany();
  const tiers = await prisma.channelModelPriceTier.findMany();

  const liveModels = models.filter((row) => row.deletedAt === null);
  const deadModels = models.filter((row) => row.deletedAt !== null);
  const liveTiers = tiers.filter((row) => row.deletedAt === null);
  const deadTiers = tiers.filter((row) => row.deletedAt !== null);

  /* ── 1. 软删除唯一键 ───────────────────────────────────── */
  for (const model of liveModels) {
    ok(
      `模型 activeKey 与业务键一致：${model.modelKey}`,
      model.activeKey === activeKeyOf(model.modelKey),
      { activeKey: model.activeKey, expected: activeKeyOf(model.modelKey) },
    );
  }
  for (const model of deadModels) {
    ok(`已删除模型的 activeKey 已置空：${model.id}`, model.activeKey === null, model.activeKey);
  }
  for (const tier of liveTiers) {
    ok(`价格档 activeKey 与 selectorKey 一致：${tier.id}`, tier.activeKey === tier.selectorKey, {
      activeKey: tier.activeKey,
      selectorKey: tier.selectorKey,
    });
  }
  for (const tier of deadTiers) {
    ok(`已删除价格档的 activeKey 已置空：${tier.id}`, tier.activeKey === null, tier.activeKey);
  }

  /* ── 2. 存活行唯一性 ───────────────────────────────────── */
  const modelKeys = new Map<string, string[]>();
  for (const model of liveModels) {
    const key = `${model.channelId}::${model.activeKey ?? activeKeyOf(model.modelKey)}`;
    modelKeys.set(key, [...(modelKeys.get(key) ?? []), model.id]);
  }
  for (const [key, ids] of modelKeys) {
    ok(`同渠道模型键唯一：${key}`, ids.length === 1, ids);
  }
  const tierKeys = new Map<string, string[]>();
  for (const tier of liveTiers) {
    const key = `${tier.channelModelId}::${tier.selectorKey}`;
    tierKeys.set(key, [...(tierKeys.get(key) ?? []), tier.id]);
  }
  for (const [key, ids] of tierKeys) {
    ok(`同模型价格档选择器唯一：${key}`, ids.length === 1, ids);
  }

  /* ── 3-5. 每个存活模型的档位与摘要 ─────────────────────── */
  for (const model of liveModels) {
    const modelTiers = liveTiers.filter((tier) => tier.channelModelId === model.id);
    const selectorSources: Array<{
      enabled: boolean;
      priceConfigured: boolean;
      billingMode: string;
      unitPriceMicrocredits: number;
      inputTokenPriceMicrocredits: number;
      outputTokenPriceMicrocredits: number;
      cachedTokenPriceMicrocredits: number;
      resolution: string;
      videoSeconds: number;
    }> = [];
    const capabilityChecks: Array<{ selector: Record<string, string>; resolution: string; videoSeconds: number }> = [];

    for (const tier of modelTiers) {
      const parsed = decodeSkuSelector(tier.selectorJson);
      const canonical = canonicalSkuSelector(parsed);
      ok(`价格档选择器规范：${tier.id}`, canonical.key === tier.selectorKey, {
        selectorKey: tier.selectorKey,
        expected: canonical.key,
      });
      ok(`价格档 selectorJson 与 selectorKey 同值：${tier.id}`, canonical.key === tier.selectorJson, {
        selectorJson: tier.selectorJson,
        expected: canonical.key,
      });
      const selectorVideoSeconds = Number(parsed.videoSeconds ?? 0) || 0;
      ok(`价格档时长列与选择器一致：${tier.id}`, selectorVideoSeconds === tier.videoSeconds, {
        column: tier.videoSeconds,
        selector: selectorVideoSeconds,
      });
      const selectorResolution = parsed.vquality ?? '*';
      if (parsed.vquality !== undefined || tier.resolution !== '*') {
        ok(`价格档分辨率列与选择器一致：${tier.id}`, selectorResolution === tier.resolution, {
          column: tier.resolution,
          selector: selectorResolution,
        });
      }
      capabilityChecks.push({ selector: parsed, resolution: tier.resolution, videoSeconds: tier.videoSeconds });
      selectorSources.push({
        enabled: tier.enabled,
        priceConfigured: tier.priceConfigured,
        billingMode: tier.billingMode,
        unitPriceMicrocredits: Number(tier.unitPriceMicrocredits),
        inputTokenPriceMicrocredits: Number(tier.inputTokenPriceMicrocredits),
        outputTokenPriceMicrocredits: Number(tier.outputTokenPriceMicrocredits),
        cachedTokenPriceMicrocredits: Number(tier.cachedTokenPriceMicrocredits),
        resolution: tier.resolution,
        videoSeconds: tier.videoSeconds,
      });
    }

    ok(`渠道模型能力合法：${model.modelKey}`, ['text', 'image', 'video', 'audio'].includes(model.capability), model.capability);
    ok(`渠道模型协议非空：${model.modelKey}`, String(model.protocol ?? '').trim() !== '');
    if (['text', 'image', 'video'].includes(model.capability)) {
      ok(`渠道模型能力配置非空：${model.modelKey}`, String(model.capabilityConfigJson ?? '').trim() !== '');
    }
    try {
      decodeCapabilityConfig(model.capabilityConfigJson);
    } catch (error) {
      fails.push(`能力配置无法解析：${model.modelKey} — ${(error as Error).message}`);
    }

    if (capabilityChecks.length > 0) {
      try {
        validateChannelModelTierCapabilities(
          capabilityChecks,
          model.capabilityConfigJson,
          model.capability,
          model.protocol,
        );
      } catch (error) {
        fails.push(`价格档超出能力合同：${model.modelKey} — ${(error as Error).message}`);
      }
    }

    const summary = applyChannelModelPriceTierSummary(
      {
        priceConfigured: false,
        billingMode: 'fixed_request',
        unitPriceMicrocredits: 0,
        inputTokenPriceMicrocredits: 0,
        outputTokenPriceMicrocredits: 0,
        cachedTokenPriceMicrocredits: 0,
      },
      selectorSources,
    );
    ok(`渠道模型摘要与价格档一致：${model.modelKey}`, summary.billingMode === model.billingMode, {
      row: model.billingMode,
      expected: summary.billingMode,
    });
    ok(`渠道模型单价与价格档一致：${model.modelKey}`, summary.unitPriceMicrocredits === Number(model.unitPriceMicrocredits), {
      row: Number(model.unitPriceMicrocredits),
      expected: summary.unitPriceMicrocredits,
    });
    ok(`渠道模型定价标记与价格档一致：${model.modelKey}`, summary.priceConfigured === model.priceConfigured, {
      row: model.priceConfigured,
      expected: summary.priceConfigured,
    });
  }

  /* ── 6. 渠道兼容清单 ───────────────────────────────────── */
  for (const channel of channels) {
    const channelModels = liveModels
      .filter((model) => model.channelId === channel.id)
      .sort(
        (left, right) =>
          left.sortOrder - right.sortOrder ||
          left.createdAt.getTime() - right.createdAt.getTime() ||
          left.id.localeCompare(right.id),
      );
    if (channelModels.length === 0) continue;
    const expected = JSON.stringify(channelModels.filter((model) => model.enabled).map((model) => model.modelKey));
    ok(`渠道兼容清单与启用模型一致：${channel.name}`, channel.modelsJson === expected, {
      modelsJson: channel.modelsJson,
      expected,
    });
  }

  console.log(`\n渠道/模型一致性校验：通过 ${pass} 项，失败 ${fails.length} 项`);
  if (fails.length > 0) {
    for (const failure of fails) console.log(`  ✗ ${failure}`);
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error('校验脚本异常：', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
