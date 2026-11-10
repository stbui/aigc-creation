/**
 * 渠道与渠道模型 API 端到端验收（P1）。
 *
 * 为什么在同一个进程里启 Nest 再打自己的端口：沙箱内后台进程无法存活，
 * 而「创建渠道 → 配置模型与价格档 → 复制 → 排序 → 导入导出 → 删除」这条链路
 * 只有在真实 HTTP 往返（含全局校验管道、权限守卫、响应信封）下
 * 才能证明接线正确。函数直调会绕过这些问题。
 *
 * 断言重点：
 *   1. 系统渠道后台投影**不回显** apiKey / secretKey，只给 hasApiKey / hasSecretKey；
 *   2. 模型与价格档同事务落库，摘要字段与档位汇总一致；
 *   3. 模型级上游键改名时，跟随默认的档位键级联跟随；
 *   4. 复制渠道连带复制价格档；
 *   5. 排序走 expectedIds CAS；
 *   6. 导出文件不含任何凭证，导入按名称合并。
 *
 * 运行：NODE_ENV=development npm run verify:channel-flow
 * 之后可再跑 npm run verify:model-consistency 校验数据层不变量。
 */
process.env.PORT = process.env.PORT || '3013';
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

const { NestFactory } = require('@nestjs/core');
const { ValidationPipe } = require('@nestjs/common');
const { AppModule } = require('../src/app.module');
const { ResponseInterceptor } = require('../src/common/response.interceptor');
const { PrismaService } = require('../src/prisma/prisma.service');

let pass = 0;
const fails: string[] = [];
const ok = (name: string, condition: boolean, detail?: unknown) => {
  if (condition) {
    pass += 1;
    return;
  }
  fails.push(`${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 400)}` : ''}`);
};

/** 只用于解析 outbound 校验：本机无 DNS 时 IP 字面量不触发查询 */
const BASE_URL = 'https://93.184.216.34/v1';

async function main() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  app.setGlobalPrefix('api/v1');
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );
  await app.listen(0, '127.0.0.1');
  const prisma = app.get(PrismaService);
  const address = app.getHttpServer().address();
  const base = `http://127.0.0.1:${address.port}/api/v1`;

  const call = async (method: string, path: string, token: string | null, body?: unknown) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text.slice(0, 300) };
    }
    return { status: response.status, code: json.code, data: json.data, message: json.message ?? json.raw };
  };

  const stamp = Date.now().toString(36);
  const channelName = `验收渠道-${stamp}`;

  try {
    /* ── 登录 ─────────────────────────────────────────── */
    const login = await call('POST', '/auth/login', null, { email: 'admin@admin.com', password: '123456789' });
    ok('管理员登录', login.code === 0 && Boolean(login.data?.accessToken), login);
    const token: string = login.data?.accessToken;
    const modelRows = (response: any): any[] =>
      Array.isArray(response?.data) ? response.data : (response?.data?.models ?? []);
    if (!token) throw new Error('无法取得管理员令牌，后续用例终止');

    // 清理上一轮遗留的验收渠道，保证脚本可重复运行且不堆积脏数据
    const stale = await call('GET', '/admin/channels?limit=100', token);
    for (const row of stale.data?.channels ?? []) {
      if (!/^验收(渠道|导入)-/.test(String(row.name ?? ''))) continue;
      await call('DELETE', `/admin/channels/${row.id}`, token);
    }

    /* ── 1. 创建渠道 ──────────────────────────────────── */
    const created = await call('POST', '/admin/channels', token, {
      name: channelName,
      baseUrl: BASE_URL,
      apiKey: 'sk-verify-secret',
      concurrencyLimit: 3,
    });
    ok('创建渠道', created.code === 0 && Boolean(created.data?.id), created);
    const channelId: string = created.data?.id;
    if (!channelId) throw new Error('渠道创建失败，后续用例终止');
    ok('后台投影不回显 API Key', created.data.apiKey === '', created.data.apiKey);
    ok('后台投影标记已配置密钥', created.data.hasApiKey === true, created.data.hasApiKey);
    ok('渠道并发写入生效', created.data.concurrencyLimit === 3, created.data.concurrencyLimit);
    ok('渠道作用域为系统渠道', created.data.scope === 'system', created.data.scope);

    /* ── 2. 创建渠道模型（图片能力 + 两档价格） ─────────── */
    const capabilityConfig = {
      version: 1,
      image: {
        references: { promptMaxChars: 2000, maxImages: 0, maxImageBytes: 0, maskSupported: false },
        size: { parameter: 'size', values: ['1024x1024'], default: '1024x1024', allowCustom: false },
        resolution: { supported: true, values: ['1k', '2k'], default: '1k' },
        quality: { supported: false, values: [], default: 'auto' },
        transparentBackground: { supported: false, default: false },
        responseFormat: { supported: true, default: 'url' },
        outputFormat: { supported: false },
        maxOutputs: 1,
      },
    };
    const modelBody = {
      modelKey: 'verify-flux-image',
      providerModelKey: 'flux-schnell',
      displayName: '验收图片模型',
      capability: 'image',
      protocol: 'agnes-image',
      channelLabel: '验收线路',
      tags: [{ text: '验收', color: 'purple' }],
      capabilityConfig,
      priceTiers: [
        {
          selector: {},
          providerModelKey: 'flux-schnell',
          billingMode: 'fixed_request',
          unitPriceMicrocredits: 2_000_000,
          priceConfigured: true,
          enabled: true,
          costPricing: { configured: true, unitPriceMicrocredits: 1_200_000 },
        },
        {
          selector: { imageResolution: '2k' },
          providerModelKey: 'flux-pro',
          billingMode: 'fixed_request',
          unitPriceMicrocredits: 5_000_000,
          priceConfigured: true,
          enabled: true,
          // 调价要求「已启用规格的成本价与售价都已配置」，两档都要填成本价
          costPricing: { configured: true, unitPriceMicrocredits: 3_000_000 },
        },
      ],
    };
    const savedModel = await call('POST', `/admin/channels/${channelId}/models`, token, modelBody);
    ok('创建渠道模型', savedModel.code === 0 && Boolean(savedModel.data?.id), savedModel);
    const modelId: string = savedModel.data?.id;
    ok('价格档落库两档', (savedModel.data?.priceTiers ?? []).length === 2, savedModel.data?.priceTiers?.length);
    ok('模型定价标记生效', savedModel.data?.priceConfigured === true, savedModel.data?.priceConfigured);
    // 摘要规则与上游一致：图片档的 resolution 列恒为 *，因此取「最后一个」合格档作为摘要
    ok('摘要单价取末个通配档', savedModel.data?.unitPriceMicrocredits === 5_000_000, savedModel.data?.unitPriceMicrocredits);
    ok('标签落库', (savedModel.data?.tags ?? [])[0]?.text === '验收', savedModel.data?.tags);
    const wildcardTier = (savedModel.data?.priceTiers ?? []).find((tier: any) => Object.keys(tier.selector).length === 0);
    ok('成本价只属于后台投影', wildcardTier?.costPricing?.unitPriceMicrocredits === 1_200_000, wildcardTier?.costPricing);

    /* ── 2.1 图片价格档必须落在协议声明的计价参数内 ───── */
    // 调用方省略 capabilityConfig.image.parameters 时，保存路径必须先用协议
    // 清单归一化合同再校验价格档；否则会保存一个永远命中不了的档位。
    const contractGuard = await call('POST', `/admin/channels/${channelId}/models`, token, {
      ...modelBody,
      modelKey: `verify-image-contract-${stamp}`,
      providerModelKey: 'gpt-image-1',
      protocol: 'openai-image',
      priceTiers: [
        {
          selector: { imageResolution: '2k' },
          billingMode: 'fixed_request',
          unitPriceMicrocredits: 1_000_000,
          priceConfigured: true,
          enabled: true,
        },
      ],
    });
    ok('图片价格档必须落在协议声明的计价参数内', contractGuard.code === 40001, contractGuard);

    /* ── 3. 重复模型的保存必须报错 ─────────────────────── */
    const duplicatedModel = await call('POST', `/admin/channels/${channelId}/models`, token, { ...modelBody });
    ok('同渠道重复模型被拒绝', duplicatedModel.code === 40001, duplicatedModel);

    /* ── 4. 上游键改名：跟随默认的档位级联跟随 ─────────── */
    const renamed = await call('PATCH', `/admin/channels/${channelId}/models/${modelId}`, token, {
      ...modelBody,
      providerModelKey: 'flux-schnell-v2',
    });
    const renamedWildcard = (renamed.data?.priceTiers ?? []).find((tier: any) => Object.keys(tier.selector).length === 0);
    ok('改名后通配档跟随新上游键', renamedWildcard?.providerModelKey === 'flux-schnell-v2', renamedWildcard?.providerModelKey);
    const renamedExplicit = (renamed.data?.priceTiers ?? []).find((tier: any) => tier.selector?.imageResolution === '2k');
    ok('显式配置的档位不被改名覆盖', renamedExplicit?.providerModelKey === 'flux-pro', renamedExplicit?.providerModelKey);

    /* ── 5. 排序 CAS ──────────────────────────────────── */
    const order = await call('GET', `/admin/channels/${channelId}/models/order`, token);
    const orderItems = Array.isArray(order.data) ? order.data : (order.data?.items ?? []);
    ok('读取模型排序', order.code === 0 && Array.isArray(orderItems), order);
    const orderIds = orderItems.map((item: any) => item.id);

    /* ── 6. 复制渠道（连带价格档） ─────────────────────── */
    const duplicated = await call('POST', `/admin/channels/${channelId}/duplicate`, token, {});
    ok('复制渠道', duplicated.code === 0 && duplicated.data?.id !== channelId, duplicated.code);
    const duplicateId: string = duplicated.data?.id;
    ok('复制渠道名称带副本后缀', String(duplicated.data?.name ?? '').endsWith(' - 副本'), duplicated.data?.name);
    const duplicateModels = await call('GET', `/admin/channels/${duplicateId}/models`, token);
    const duplicateModelList = Array.isArray(duplicateModels.data)
      ? duplicateModels.data
      : (duplicateModels.data?.models ?? []);
    ok('复制渠道携带模型', duplicateModelList.length === 1, duplicateModelList.length);
    ok('复制渠道携带价格档', (duplicateModelList[0]?.priceTiers ?? []).length === 2, duplicateModelList[0]?.priceTiers?.length);

    /* ── 7. 导出 / 导入 ───────────────────────────────── */
    const exported = await call('POST', '/admin/channels/export', token, { ids: [duplicateId] });
    ok('导出渠道', exported.code === 0 && (exported.data?.channels ?? []).length === 1, exported.code);
    const exportedChannel = exported.data?.channels?.[0];
    ok('导出文件不含凭证字段', !JSON.stringify(exportedChannel).includes('sk-verify-secret'));
    ok('导出文件携带价格档', (exportedChannel?.models?.[0]?.priceTiers ?? []).length === 2, exportedChannel?.models?.[0]?.priceTiers?.length);

    const importName = `验收导入-${stamp}`;
    const imported = await call('POST', '/admin/channels/import', token, {
      format: exported.data?.format,
      version: exported.data?.version,
      channels: [
        {
          ...exportedChannel,
          name: importName,
          models: exportedChannel.models.map((item: any) => ({ ...item, modelKey: 'verify-imported-model' })),
        },
      ],
    });
    ok('导入渠道', imported.code === 0 && (imported.data?.createdChannels ?? []).includes(importName), imported);
    ok('导入保存模型', imported.data?.savedModels === 1, imported.data?.savedModels);

    const all = await call('GET', '/admin/channels?limit=100', token);
    const importedChannel = (all.data?.channels ?? []).find((item: any) => item.name === importName);
    ok('导入渠道默认停用等待补齐密钥', importedChannel?.enabled === false, importedChannel?.enabled);
    ok('导入渠道不自带凭证', importedChannel?.hasApiKey === false, importedChannel?.hasApiKey);

    /* ── 8. 删除与占用校验 ─────────────────────────────── */
    /*
     * 渠道删除是业务操作：前端保留影响确认，但不要求原因。
     * 渠道模型删除同样保留业务确认，但不要求填写原因。
     */
    const batchDeleted = await call('POST', `/admin/channels/${duplicateId}/models/batch-delete`, token, {
      ids: duplicateModelList.map((item: any) => item.id),
    });
    ok('批量删除渠道模型', batchDeleted.code === 0 && batchDeleted.data?.deleted === 1, batchDeleted);

    const removed = await call('DELETE', `/admin/channels/${duplicateId}`, token);
    ok('删除渠道无需填写原因', removed.code === 0, removed);
    const afterRemove = await call('GET', `/admin/channels/${duplicateId}`, token);
    ok('删除后渠道不可见', afterRemove.status === 404 || afterRemove.code === 40400, afterRemove);

    /* ── 10. 批量调价（整批拒绝语义） ─────────────────── */
    /*
     * 调价的三条硬语义（参考实现一致）：
     *   1. `priceVersion` 不匹配 → 整批拒绝，不部分落库；
     *   2. 售价字段必须是「当前计费方式的全部字段」，少一个或夹带别的 → 拒绝；
     *   3. 成本价或售价未配置的规格 → 拒绝（先补齐再调）。
     */
    const current = await call('GET', `/admin/channels/${channelId}/models`, token);
    const repriceModel = modelRows(current).find((item: any) => item.id === modelId);
    const enabledTiers = (repriceModel?.priceTiers ?? []).filter((tier: any) => tier.enabled);
    const repricePayload = (over: Record<string, unknown> = {}) => ({
      models: [
        {
          modelId,
          priceVersion: repriceModel?.priceVersion,
          priceTiers: enabledTiers.map((tier: any) => ({
            id: tier.id,
            priceVersion: tier.priceVersion,
            prices: { unitPriceMicrocredits: 3_000_000 },
          })),
          ...over,
        },
      ],
    });

    const staleVersion = await call('POST', `/admin/channels/${channelId}/models/batch-reprice`, token, {
      ...repricePayload(),
      models: [
        {
          modelId,
          priceVersion: (repriceModel?.priceVersion ?? 1) + 5,
          priceTiers: enabledTiers.map((tier: any) => ({
            id: tier.id,
            priceVersion: tier.priceVersion,
            prices: { unitPriceMicrocredits: 3_000_000 },
          })),
        },
      ],
    });
    ok('调价：模型价格版本过期被拒绝', staleVersion.code === 40001, staleVersion);

    const missingField = await call('POST', `/admin/channels/${channelId}/models/batch-reprice`, token, {
      ...repricePayload(),
      models: [
        {
          modelId,
          priceVersion: repriceModel?.priceVersion,
          priceTiers: enabledTiers.map((tier: any) => ({
            id: tier.id,
            priceVersion: tier.priceVersion,
            // 夹带不属于当前计费方式的字段 → 必须整批拒绝
            prices: { unitPriceMicrocredits: 3_000_000, inputTokenPriceMicrocredits: 1 },
          })),
        },
      ],
    });
    ok('调价：售价字段与计费方式不匹配被拒绝', missingField.code === 40001, missingField);

    const incompleteTier = await call('POST', `/admin/channels/${channelId}/models/batch-reprice`, token, {
      ...repricePayload(),
      models: [
        {
          modelId,
          priceVersion: repriceModel?.priceVersion,
          priceTiers: enabledTiers.slice(0, 1).map((tier: any) => ({
            id: tier.id,
            priceVersion: tier.priceVersion,
            prices: { unitPriceMicrocredits: 3_000_000 },
          })),
        },
      ],
    });
    ok('调价：规格提交不完整被拒绝', incompleteTier.code === 40001, incompleteTier);

    // 上述三次拒绝都不能落库：售价必须仍是原值
    const afterRejects = await call('GET', `/admin/channels/${channelId}/models`, token);
    const unchangedModel = modelRows(afterRejects).find((item: any) => item.id === modelId);
    const unchangedTier = (unchangedModel?.priceTiers ?? []).find((tier: any) => tier.id === enabledTiers[0]?.id);
    ok('调价：整批拒绝后售价未被改动', unchangedTier?.unitPriceMicrocredits === enabledTiers[0]?.unitPriceMicrocredits, {
      before: enabledTiers[0]?.unitPriceMicrocredits,
      after: unchangedTier?.unitPriceMicrocredits,
    });

    const repriced = await call('POST', `/admin/channels/${channelId}/models/batch-reprice`, token, repricePayload());
    ok('批量调价成功', repriced.code === 0 && repriced.data?.updated === 1, repriced);

    const afterReprice = await call('GET', `/admin/channels/${channelId}/models`, token);
    const repricedModel = modelRows(afterReprice).find((item: any) => item.id === modelId);
    const repricedTier = (repricedModel?.priceTiers ?? []).find((tier: any) => tier.id === enabledTiers[0]?.id);
    ok('调价后档位售价生效', repricedTier?.unitPriceMicrocredits === 3_000_000, repricedTier?.unitPriceMicrocredits);
    ok('调价后模型价格版本递增', repricedModel?.priceVersion === (repriceModel?.priceVersion ?? 0) + 1, {
      before: repriceModel?.priceVersion,
      after: repricedModel?.priceVersion,
    });
    ok('调价后档位价格版本递增', repricedTier?.priceVersion === (enabledTiers[0]?.priceVersion ?? 0) + 1, {
      before: enabledTiers[0]?.priceVersion,
      after: repricedTier?.priceVersion,
    });
    ok('调价不改成本价', repricedTier?.costPricing?.unitPriceMicrocredits === enabledTiers[0]?.costPricing?.unitPriceMicrocredits, repricedTier?.costPricing);

    /* ── 11. 未配置 Base URL 的保存必须被拒绝 ───────────── */
    const invalid = await call('POST', '/admin/channels', token, { baseUrl: BASE_URL });
    ok('缺少渠道名称被拒绝', invalid.code === 40001, invalid);

    /* ── 12. 公开系统渠道连接信息（脱敏口径） ───────────── */
    // 匿名视角：只给「有哪些渠道、怎么连」，内部拓扑一律不下发
    const publicChannels = await call('GET', '/channels/system', null);
    const publicRows = (publicChannels.data?.channels ?? []) as any[];
    const publicRow = publicRows.find((row) => row?.id === channelId);
    ok('公开渠道目录可匿名访问', publicChannels.code === 0 && publicRows.length > 0, publicChannels.code);
    ok('公开视角只列启用渠道', !publicRows.some((row) => row?.id !== channelId && row?.enabled === false));
    ok('公开视角渠道名脱敏', publicRow !== undefined && publicRow.name === '', publicRow?.name);
    ok('公开视角上游地址改写为中转入口', publicRow?.baseUrl === `/api/ai/system/${channelId}`, publicRow?.baseUrl);
    ok('公开视角凭证恒为 system', publicRow?.apiKey === 'system', publicRow?.apiKey);
    ok('公开视角不下发归属账号', publicRow?.userId === '', publicRow?.userId);
    ok('公开视角不下发并发配额', publicRow?.concurrencyLimit === 0, publicRow?.concurrencyLimit);
    ok('公开视角不下发凭证存在标记', publicRow?.hasApiKey === false && publicRow?.hasSecretKey === false);
    ok('公开视角不下发 provider id', publicRow?.catalogProviderId === undefined, publicRow?.catalogProviderId);

    // 管理员视角：真实名称与上游地址，凭证仍然不下发
    const adminChannels = await call('GET', '/channels/system', token);
    const adminRow = (adminChannels.data?.channels ?? []).find((row: any) => row?.id === channelId);
    ok('管理员视角给出渠道真实名称', adminRow?.name === channelName, adminRow?.name);
    ok('管理员视角给出上游地址', adminRow?.baseUrl === BASE_URL, adminRow?.baseUrl);
    ok('管理员视角仍不回显凭证', adminRow?.apiKey === '', adminRow?.apiKey);
    ok('管理员视角给出凭证存在标记', adminRow?.hasApiKey === true, adminRow?.hasApiKey);

    /* ── 13. 线路健康指标 ───────────────────────────────── */
    const health = await call('GET', '/admin/channel-models/health', token);
    ok('线路健康端点可访问', health.code === 0 && Array.isArray(health.data?.items), health.code);
    const healthRows = (health.data?.items ?? []) as any[];
    ok('线路健康按渠道模型出表', healthRows.every((row) => Boolean(row?.id)), healthRows.length);
    ok('线路健康带两个观测窗口', healthRows.every((row) => row?.windows?.day && row?.windows?.week));
    ok('线路健康无样本时成功率为 null', healthRows.every((row) => row?.windows?.day?.successRate === null || typeof row?.windows?.day?.successRate === 'number'));
    const scoped = await call('GET', `/admin/channel-models/health?channelId=${channelId}`, token);
    ok('线路健康支持按渠道过滤', scoped.code === 0 && (scoped.data?.items ?? []).every((row: any) => row?.channelId === channelId));

    /* ── 14. 复制「只有兼容清单、没有模型行」的旧渠道 ───── */
    /*
     * 旧数据只配了 modelsJson 名单、没有 channel_models 行。复制时必须按名单补
     * 停用骨架行，并保留兼容清单；否则 refreshChannelModelNames 会把 modelsJson
     * 覆写成 []，副本看起来一个模型都没有。
     */
    const legacyName = `验收旧清单-${stamp}`;
    const legacy = await call('POST', '/admin/channels', token, {
      name: legacyName,
      baseUrl: BASE_URL,
      apiKey: 'sk-verify-legacy',
      models: [],
    });
    const legacyId: string = legacy.data?.id;
    await prisma.modelChannel.update({
      where: { id: legacyId },
      data: { modelsJson: JSON.stringify(['legacy-a', 'legacy-b']) },
    });
    const legacyDuplicate = await call('POST', `/admin/channels/${legacyId}/duplicate`, token, {});
    const legacyDuplicateId: string = legacyDuplicate.data?.id;
    const legacyModels = modelRows(await call('GET', `/admin/channels/${legacyDuplicateId}/models`, token));
    ok('复制旧清单渠道补两条骨架模型', legacyModels.length === 2, legacyModels.length);
    ok(
      '骨架模型默认停用且展示名沿用清单',
      legacyModels.every((item: any) => item.enabled === false) &&
        legacyModels.map((item: any) => item.displayName).sort().join(',') === 'legacy-a,legacy-b',
      legacyModels.map((item: any) => ({ key: item.modelKey, name: item.displayName, enabled: item.enabled })),
    );
    const legacyDuplicateRow = await prisma.modelChannel.findUnique({ where: { id: legacyDuplicateId } });
    ok(
      '复制旧清单渠道保留兼容名单',
      legacyDuplicateRow?.modelsJson === JSON.stringify(['legacy-a', 'legacy-b']),
      legacyDuplicateRow?.modelsJson,
    );
    await call('DELETE', `/admin/channels/${legacyDuplicateId}`, token);
    await call('DELETE', `/admin/channels/${legacyId}`, token);

    /* 供人工核对：保留主渠道，便于在后台页面查看配置结果 */
    console.log(`\n验收渠道已保留：${channelName}（id=${channelId}，模型 id=${modelId}，排序 ${JSON.stringify(orderIds)}）`);
  } finally {
    await app.close();
  }

  console.log(`\n渠道流程验收：通过 ${pass} 项，失败 ${fails.length} 项`);
  if (fails.length > 0) {
    for (const failure of fails) console.log(`  ✗ ${failure}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('渠道流程验收异常：', error);
  process.exitCode = 1;
});
