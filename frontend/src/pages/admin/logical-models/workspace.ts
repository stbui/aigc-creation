import type { AdminCapabilityControl, CapabilityDef, CapabilityRuntime } from '../../../types/api';
import type { AdminLogicalModelView } from '../../../types/model';

/**
 * 「能力与模型」工作台的聚合模型。
 *
 * 能力是主实体，前台模型是能力下的可售配置。数据允许一个能力对应多个模型，
 * 也允许模型暂时找不到能力定义；后者不能被静默丢掉，否则运营会误以为模型
 * 已经不存在。
 */
export interface CapabilityWorkspaceItem {
  capabilityId: string;
  name: string;
  group: string;
  modality: string;
  mode: string;
  enabled: boolean;
  runtime?: CapabilityRuntime;
  control?: AdminCapabilityControl;
  definition?: CapabilityDef;
  models: AdminLogicalModelView[];
}

export interface CapabilityWorkspace {
  items: CapabilityWorkspaceItem[];
  orphans: AdminLogicalModelView[];
}

export interface CapabilityWorkspaceFilter {
  q: string;
  group: string;
  runtime: 'remote' | 'disabled' | 'unavailable' | undefined;
}

function modelSearchText(model: AdminLogicalModelView): string {
  return [model.name, model.code, model.description, model.capability].join(' ').toLowerCase();
}

/**
 * 将能力定义、能力管控记录和前台模型合并成工作台数据。
 *
 * 能力定义与管控记录可能因权限不同而缺少任一侧：
 * - 只有能力读权限：模型数组为空，但仍展示能力状态；
 * - 只有模型读权限：能力定义仍来自公开能力清单，模型按能力归组；
 * - 两侧都没有对应记录：模型进入「未归属已知能力」区域。
 */
export function buildCapabilityWorkspace({
  controls,
  definitions,
  models,
  groupNames,
}: {
  controls: AdminCapabilityControl[];
  definitions: CapabilityDef[];
  models: AdminLogicalModelView[];
  groupNames: Map<string, string>;
}): CapabilityWorkspace {
  const knownIds = new Set<string>();
  const byId = new Map<string, CapabilityWorkspaceItem>();

  const register = (
    capabilityId: string,
    source: Pick<CapabilityDef, 'name' | 'mode'> & {
      group: string;
      modality?: string;
      runtime?: CapabilityRuntime;
      control?: AdminCapabilityControl;
      definition?: CapabilityDef;
    },
  ) => {
    knownIds.add(capabilityId);
    byId.set(capabilityId, {
      capabilityId,
      name: source.name,
      group: source.group,
      modality: source.modality ?? 'image',
      mode: source.mode,
      enabled: source.control?.enabled ?? source.runtime?.enabled ?? true,
      runtime: source.runtime,
      control: source.control,
      definition: source.definition,
      models: [],
    });
  };

  for (const definition of definitions) {
    register(definition.id, {
      name: definition.name,
      mode: definition.mode,
      modality: definition.modality ?? 'image',
      group: groupNames.get(definition.group) ?? definition.group,
      runtime: definition.runtime,
      definition,
    });
  }

  // 管控记录覆盖同名定义的展示字段，并补齐公开能力清单尚未加载到的能力。
  for (const control of controls) {
    const definition = definitions.find((item) => item.id === control.capabilityId);
    register(control.capabilityId, {
      name: control.name,
      mode: control.mode,
      modality: control.modality,
      group: control.group,
      runtime: control.runtime,
      control,
      definition,
    });
  }

  const orphans: AdminLogicalModelView[] = [];
  for (const model of models) {
    const item = knownIds.has(model.capability) ? byId.get(model.capability) : undefined;
    if (item) item.models.push(model);
    else orphans.push(model);
  }

  for (const item of byId.values()) {
    item.models.sort((a, b) => {
      if (a.archivedAt !== b.archivedAt) return a.archivedAt ? 1 : -1;
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return a.name.localeCompare(b.name, 'zh-CN');
    });
  }

  return {
    items: Array.from(byId.values()).sort((a, b) => {
      const groupOrder = a.group.localeCompare(b.group, 'zh-CN');
      if (groupOrder !== 0) return groupOrder;
      return a.name.localeCompare(b.name, 'zh-CN');
    }),
    orphans: orphans.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
  };
}

/** 能力状态与模型信息的客户端筛选；URL 同步由页面负责。 */
export function filterCapabilityWorkspace(
  workspace: CapabilityWorkspace,
  { q, group, runtime }: CapabilityWorkspaceFilter,
): CapabilityWorkspace {
  const keyword = q.trim().toLowerCase();

  const items = workspace.items.flatMap((item) => {
    if (group && item.group !== group) return [];
    const effective = item.runtime?.effective ?? 'unavailable';
    if (runtime && effective !== runtime) return [];

    const capabilityMatches = [
      item.name,
      item.capabilityId,
      item.group,
      item.modality,
    ]
      .join(' ')
      .toLowerCase()
      .includes(keyword);
    const matchingModels = keyword
      ? item.models.filter((model) => modelSearchText(model).includes(keyword))
      : item.models;

    if (keyword && !capabilityMatches && matchingModels.length === 0) return [];
    return [{ ...item, models: capabilityMatches ? item.models : matchingModels }];
  });

  // 孤儿模型缺少能力分组与运行结论，无法参与这两类筛选。
  const orphans =
    group || runtime
      ? []
      : workspace.orphans.filter(
          (model) => !keyword || modelSearchText(model).includes(keyword),
        );

  return { items, orphans };
}
