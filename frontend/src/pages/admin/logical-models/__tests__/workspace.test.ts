import { describe, expect, it } from 'vitest';
import type {
  AdminCapabilityControl,
  CapabilityDef,
  CapabilityRuntime,
} from '../../../../types/api';
import type { AdminLogicalModelView } from '../../../../types/model';
import { buildCapabilityWorkspace, filterCapabilityWorkspace } from '../workspace';

const remoteRuntime: CapabilityRuntime = {
  enabled: true,
  remoteAvailable: true,
  effective: 'remote',
  reason: '线路可用',
};

const disabledRuntime: CapabilityRuntime = {
  enabled: false,
  remoteAvailable: false,
  effective: 'disabled',
  reason: '运营已下线',
};

function definition(
  input: Pick<CapabilityDef, 'id' | 'name' | 'group'> & Partial<CapabilityDef>,
): CapabilityDef {
  return {
    summary: '',
    mode: 'real',
    modality: 'image',
    inputs: 0,
    inWorkbench: true,
    params: [],
    defaultParams: {},
    creditCost: 0,
    runtime: remoteRuntime,
    ...input,
  };
}

function control(
  input: Pick<AdminCapabilityControl, 'capabilityId' | 'name' | 'group'> &
    Partial<AdminCapabilityControl>,
): AdminCapabilityControl {
  return {
    modality: 'image',
    mode: 'real',
    enabled: true,
    reason: null,
    updatedBy: null,
    updatedAt: null,
    runtime: remoteRuntime,
    ...input,
  };
}

function model(
  input: Pick<AdminLogicalModelView, 'id' | 'name' | 'code' | 'capability'> &
    Partial<AdminLogicalModelView>,
): AdminLogicalModelView {
  return {
    icon: '',
    description: '',
    sortOrder: 0,
    pricePolicy: 'fixed',
    pricingMode: 'fixed',
    displayPrice: null,
    priceLabel: '',
    billingMode: 'per_call',
    unitPriceMicrocredits: 0,
    inputPriceMicrocredits: 0,
    outputPriceMicrocredits: 0,
    cachedPriceMicrocredits: 0,
    priceTiers: [],
    legacyModelIds: [],
    capabilitySpec: {} as AdminLogicalModelView['capabilitySpec'],
    capabilityProfiles: [],
    defaultOptions: {},
    available: true,
    enabled: true,
    activeRevisionId: '',
    revisionVersion: 1,
    configurationError: '',
    availabilityError: '',
    archivedAt: null,
    routes: [],
    ...input,
  };
}

describe('能力与模型工作台数据', () => {
  it('按能力归组模型，翻译分组名，并保留未归属模型', () => {
    const workspace = buildCapabilityWorkspace({
      definitions: [
        definition({ id: 'main_image', name: '商品主图', group: 'ai_retouch' }),
      ],
      controls: [],
      models: [
        model({ id: 'later', name: '后置模型', code: 'later', capability: 'main_image', sortOrder: 2 }),
        model({ id: 'first', name: '前置模型', code: 'first', capability: 'main_image', sortOrder: 1 }),
        model({
          id: 'archived',
          name: '归档模型',
          code: 'archived',
          capability: 'main_image',
          archivedAt: '2026-11-01T00:00:00.000Z',
        }),
        model({ id: 'orphan', name: '孤儿模型', code: 'orphan', capability: 'legacy' }),
      ],
      groupNames: new Map([['ai_retouch', '图像工具']]),
    });

    expect(workspace.items).toHaveLength(1);
    expect(workspace.items[0]).toMatchObject({
      capabilityId: 'main_image',
      group: '图像工具',
    });
    expect(workspace.items[0].models.map((item) => item.id)).toEqual([
      'first',
      'later',
      'archived',
    ]);
    expect(workspace.orphans.map((item) => item.id)).toEqual(['orphan']);
  });

  it('管控记录覆盖能力定义，并补齐公开清单尚未加载到的能力', () => {
    const workspace = buildCapabilityWorkspace({
      definitions: [
        definition({ id: 'main_image', name: '商品主图', group: 'ai_retouch' }),
      ],
      controls: [
        control({
          capabilityId: 'main_image',
          name: '商品主图（已下线）',
          group: '图片生成',
          enabled: false,
          runtime: disabledRuntime,
        }),
        control({
          capabilityId: 'extra',
          name: '补充能力',
          group: '视频生成',
          modality: 'video',
        }),
      ],
      models: [
        model({ id: 'main', name: '主图模型', code: 'main', capability: 'main_image' }),
        model({ id: 'extra', name: '视频模型', code: 'extra', capability: 'extra' }),
      ],
      groupNames: new Map(),
    });

    expect(workspace.items).toHaveLength(2);
    expect(workspace.items.find((item) => item.capabilityId === 'main_image')).toMatchObject({
      name: '商品主图（已下线）',
      group: '图片生成',
      enabled: false,
    });
    expect(workspace.items.find((item) => item.capabilityId === 'extra')).toMatchObject({
      name: '补充能力',
      group: '视频生成',
      modality: 'video',
      models: [expect.objectContaining({ id: 'extra' })],
    });
  });

  it('关键词命中能力时保留其全部模型，命中模型时只保留匹配模型', () => {
    const workspace = buildCapabilityWorkspace({
      definitions: [
        definition({ id: 'main_image', name: '商品主图', group: 'ai_retouch' }),
      ],
      controls: [],
      models: [
        model({ id: 'seedream', name: 'Seedream', code: 'seedream', capability: 'main_image' }),
        model({ id: 'nano', name: 'Nano Banana', code: 'nano', capability: 'main_image' }),
      ],
      groupNames: new Map([['ai_retouch', '图像工具']]),
    });

    const byCapability = filterCapabilityWorkspace(workspace, {
      q: '商品',
      group: '',
      runtime: undefined,
    });
    expect(byCapability.items[0].models.map((item) => item.id)).toEqual(['nano', 'seedream']);

    const byModel = filterCapabilityWorkspace(workspace, {
      q: 'seed',
      group: '',
      runtime: undefined,
    });
    expect(byModel.items[0].models.map((item) => item.id)).toEqual(['seedream']);
  });

  it('孤儿模型只参与关键词筛选，不参与分组与运行结论筛选', () => {
    const workspace = buildCapabilityWorkspace({
      definitions: [
        definition({ id: 'main_image', name: '商品主图', group: 'ai_retouch' }),
      ],
      controls: [],
      models: [
        model({ id: 'main', name: '主图模型', code: 'main', capability: 'main_image' }),
        model({ id: 'legacy', name: '旧版模型', code: 'legacy', capability: 'legacy' }),
      ],
      groupNames: new Map([['ai_retouch', '图像工具']]),
    });

    const keywordOnly = filterCapabilityWorkspace(workspace, {
      q: '旧版',
      group: '',
      runtime: undefined,
    });
    expect(keywordOnly.items).toHaveLength(0);
    expect(keywordOnly.orphans.map((item) => item.id)).toEqual(['legacy']);

    const grouped = filterCapabilityWorkspace(workspace, {
      q: '',
      group: '图像工具',
      runtime: undefined,
    });
    expect(grouped.orphans).toHaveLength(0);

    const runtimeFiltered = filterCapabilityWorkspace(workspace, {
      q: '',
      group: '',
      runtime: 'unavailable',
    });
    expect(runtimeFiltered.items).toHaveLength(0);
    expect(runtimeFiltered.orphans).toHaveLength(0);
  });
});
