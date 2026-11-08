import {
  Archive,
  FlaskConical,
  Image as ImageIcon,
  Pencil,
  Plus,
  Power,
  PowerOff,
  Route,
  Type,
  Video,
} from 'lucide-react';

import {
  ActionButton,
  Card,
  HelpTip,
  StatusTag,
  ToneBadge,
} from '~/admin-ui/primitives';
import { cn } from '../../../admin-ui/lib/cn';
import type { AdminLogicalModelView } from '../../../types/model';
import { MODE_LABELS } from '../../../lib/constants';
import { BILLING_MODE_LABELS, PRICE_POLICY_LABELS } from './constants';
import type { CapabilityWorkspaceItem } from './workspace';

const MODALITY_META: Record<string, { label: string; icon: typeof ImageIcon }> = {
  image: { label: '图像', icon: ImageIcon },
  video: { label: '视频', icon: Video },
  text: { label: '文本', icon: Type },
};

type CapabilityState = 'available' | 'disabled' | 'unavailable' | 'unconfigured' | 'unknown';

const STATE_META: Record<
  CapabilityState,
  { label: string; tone: 'success' | 'danger' | 'warn' | 'muted' }
> = {
  available: { label: '可用', tone: 'success' },
  disabled: { label: '已下线', tone: 'danger' },
  unavailable: { label: '无可用线路', tone: 'danger' },
  unconfigured: { label: '未配置模型', tone: 'warn' },
  unknown: { label: '状态未知', tone: 'muted' },
};

function capabilityStateOf(item: CapabilityWorkspaceItem, modelsReadable: boolean): CapabilityState {
  if (!item.enabled || item.runtime?.effective === 'disabled') return 'disabled';
  if (!modelsReadable && !item.runtime) return 'unknown';
  if (!modelsReadable) {
    return item.runtime?.effective === 'remote' ? 'available' : 'unavailable';
  }

  const activeModels = item.models.filter((model) => !model.archivedAt);
  if (activeModels.length === 0) return 'unconfigured';
  if (
    item.runtime?.remoteAvailable === false ||
    !activeModels.some((model) => model.enabled && model.available)
  ) {
    return 'unavailable';
  }
  return 'available';
}

function ModelRow({
  model,
  writable,
  onEdit,
  onSimulate,
  onArchive,
}: {
  model: AdminLogicalModelView;
  writable: boolean;
  onEdit: (model: AdminLogicalModelView) => void;
  onSimulate: (model: AdminLogicalModelView) => void;
  onArchive: (model: AdminLogicalModelView) => void;
}) {
  const availableRoutes = model.routes.filter((route) => route.available).length;
  const archived = !!model.archivedAt;

  return (
    <div
      data-testid="admin-table-row"
      data-model-id={model.id}
      className="rounded-lg border border-border bg-background px-3 py-2.5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            {model.icon && <span aria-hidden>{model.icon}</span>}
            <span className="truncate text-[13px] font-medium text-foreground">{model.name}</span>
            {archived && <StatusTag status="archived" tone="muted" label="已归档" />}
          </div>
          <div className="mt-0.5 truncate font-mono text-[12px] text-muted-foreground">
            {model.code}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          {archived ? (
            <StatusTag status="archived" tone="muted" label="不可售" />
          ) : model.enabled ? (
            <StatusTag status="enabled" tone="success" label="已上架" />
          ) : (
            <StatusTag status="disabled" tone="muted" label="未上架" />
          )}
          {/* 线路正常时不重复打标：价格行右侧的「可用 / 总数」已经说明问题 */}
          {!archived && !model.available && (
            <StatusTag status="unavailable" tone="danger" label="线路不可用" />
          )}
        </div>
      </div>

      <div className="mt-2 grid grid-cols-[1fr_auto] items-end gap-3">
        <div className="grid min-w-0 grid-cols-3 gap-2 text-[12px]">
          <div className="min-w-0">
            <div className="text-muted-foreground">价格</div>
            {/* 有数字时只报金额与计费方式；没有数字时用后端给的 priceLabel（按渠道规格计费 / 按 Token / 未配置） */}
            <div
              className="truncate text-foreground"
              title={`${PRICE_POLICY_LABELS[model.pricePolicy] ?? model.pricePolicy} · ${
                BILLING_MODE_LABELS[model.billingMode] ?? model.billingMode
              }`}
            >
              {model.displayPrice !== null
                ? `${model.displayPrice} 积分 · ${
                    BILLING_MODE_LABELS[model.billingMode] ?? model.billingMode
                  }`
                : model.priceLabel || '未配置'}
            </div>
          </div>
          <div className="min-w-0">
            <div className="text-muted-foreground">线路</div>
            <div className="truncate text-foreground" title={model.routes.map((route) => `${route.channelName} / ${route.channelModelName}`).join('、')}>
              <span className="tabular-nums">
                {availableRoutes} / {model.routes.length}
              </span>
              {model.routes[0] ? ` · ${model.routes[0].channelName}` : ''}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Revision</div>
            <div className="tabular-nums text-foreground">v{model.revisionVersion}</div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <ActionButton
            variant="ghost"
            size="xs"
            icon={Pencil}
            disabled={!writable || archived}
            onClick={() => onEdit(model)}
          >
            编辑
          </ActionButton>
          <ActionButton
            variant="ghost"
            size="xs"
            icon={FlaskConical}
            onClick={() => onSimulate(model)}
          >
            模拟
          </ActionButton>
          <ActionButton
            variant="ghost"
            size="xs"
            icon={Archive}
            disabled={!writable || archived}
            onClick={() => onArchive(model)}
          >
            归档
          </ActionButton>
        </div>
      </div>

      {!archived && !model.available && (model.configurationError || model.availabilityError) && (
        <div className="mt-1.5 truncate text-[12px] text-danger-text" title={model.configurationError || model.availabilityError}>
          {model.configurationError || model.availabilityError}
        </div>
      )}
    </div>
  );
}

/**
 * 单个能力的组合卡片：上半部分是能力开关与运行结论，下半部分是所属模型。
 *
 * 能力状态始终展示，不能只藏在筛选器里；模型不可用时相对地标出线路问题，
 * 避免运营看到「已上架」就误以为能够收单。
 */
export function CapabilityModelCard({
  item,
  modelsReadable,
  modelsUnavailableReason,
  capabilityWritable,
  modelWritable,
  capabilitySaving,
  onToggleCapability,
  onCreateModel,
  onEditModel,
  onSimulateModel,
  onArchiveModel,
}: {
  item: CapabilityWorkspaceItem;
  modelsReadable: boolean;
  modelsUnavailableReason: string;
  capabilityWritable: boolean;
  modelWritable: boolean;
  capabilitySaving: boolean;
  onToggleCapability: (item: CapabilityWorkspaceItem) => void;
  onCreateModel: (capabilityId: string) => void;
  onEditModel: (model: AdminLogicalModelView) => void;
  onSimulateModel: (model: AdminLogicalModelView) => void;
  onArchiveModel: (model: AdminLogicalModelView) => void;
}) {
  const modality = MODALITY_META[item.modality] ?? {
    label: item.modality,
    icon: ImageIcon,
  };
  const ModalityIcon = modality.icon;
  const state = capabilityStateOf(item, modelsReadable);
  const stateMeta = STATE_META[state];
  const activeModels = item.models.filter((model) => !model.archivedAt);
  const archivedModels = item.models.filter((model) => model.archivedAt);
  const availableRoutes = activeModels.reduce(
    (count, model) => count + model.routes.filter((route) => route.available).length,
    0,
  );
  const totalRoutes = activeModels.reduce((count, model) => count + model.routes.length, 0);

  const toggleButton = (
    <ActionButton
      size="sm"
      variant={item.enabled ? 'ghost' : 'default'}
      icon={item.enabled ? PowerOff : Power}
      className={item.enabled ? 'text-danger-text hover:text-danger-text' : undefined}
      disabled={!capabilityWritable || capabilitySaving}
      onClick={() => onToggleCapability(item)}
    >
      {capabilitySaving ? '处理中…' : item.enabled ? '下线能力' : '上线能力'}
    </ActionButton>
  );

  return (
    <Card
      data-testid="admin-capability-card"
      data-capability-id={item.capabilityId}
      data-enabled={item.enabled ? 'true' : 'false'}
      data-runtime={state}
      className={cn(
        'gap-0 overflow-hidden rounded-xl border-border bg-card p-0 shadow-card',
        !item.enabled && 'bg-muted/20',
      )}
    >
      <div className="border-b border-border bg-muted/20 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span
              className={cn(
                'flex size-9 shrink-0 items-center justify-center rounded-lg border',
                item.enabled
                  ? 'border-brand/20 bg-brand-bg text-brand'
                  : 'border-border bg-muted text-muted-foreground',
              )}
              title={modality.label}
              role="img"
              aria-label={modality.label}
            >
              <ModalityIcon className="size-[18px]" aria-hidden />
            </span>
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <h3 className="truncate text-sm font-semibold leading-5 text-foreground">
                  {item.name}
                </h3>
                <HelpTip tip={item.runtime?.reason || '尚无运行结论'}>
                  <StatusTag
                    status={`capability-${state}`}
                    tone={stateMeta.tone}
                    label={stateMeta.label}
                    showDot
                  />
                </HelpTip>
              </div>
              <code className="mt-1 block truncate font-mono text-[12px] text-muted-foreground">
                {item.capabilityId}
              </code>
            </div>
          </div>
          {capabilityWritable ? (
            toggleButton
          ) : (
            <HelpTip tip="当前账号无 capability.write 权限">{toggleButton}</HelpTip>
          )}
        </div>

        {/* 分组是外层分组标题、模态是左侧图标、实现程度 17 项全为 real —— 都不在卡上重复 */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {item.mode !== 'real' && (
            <ToneBadge tone="warn">{MODE_LABELS[item.mode] ?? item.mode}</ToneBadge>
          )}
          {modelsReadable && (
            <ToneBadge tone={totalRoutes > 0 && availableRoutes > 0 ? 'success' : 'warn'}>
              <Route className="mr-1 size-3" aria-hidden />
              <span className="tabular-nums">
                {availableRoutes} / {totalRoutes}
              </span>
              条线路
            </ToneBadge>
          )}
        </div>

        {/* 只在「为什么不可用」时铺开原因；可用状态的结论已由状态标签与线路计数表达 */}
        {item.runtime?.reason && state !== 'available' && (
          <p className="mt-2 line-clamp-2 text-[12px] leading-5 text-muted-foreground">
            {item.runtime.reason}
          </p>
        )}
      </div>

      <div className="space-y-2 p-3">
        <div className="flex items-center justify-between gap-2 px-0.5">
          <div className="text-[12px] font-medium text-foreground">
            所属前台模型
            {modelsReadable && (activeModels.length > 1 || archivedModels.length > 0) && (
              <span className="ml-1.5 font-normal text-muted-foreground">
                {activeModels.length} 个
                {archivedModels.length > 0 ? ` · ${archivedModels.length} 个已归档` : ''}
              </span>
            )}
          </div>
          {modelWritable && (
            <ActionButton
              variant="ghost"
              size="xs"
              icon={Plus}
              onClick={() => onCreateModel(item.capabilityId)}
            >
              新建模型
            </ActionButton>
          )}
        </div>

        {!modelsReadable ? (
          <div className="rounded-lg border border-dashed border-border px-3 py-5 text-center text-[12px] text-muted-foreground">
            {modelsUnavailableReason}
          </div>
        ) : item.models.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-3 py-5 text-center text-[12px] text-muted-foreground">
            尚未为该能力配置前台模型，C 端无法生成。
          </div>
        ) : (
          item.models.map((model) => (
            <ModelRow
              key={model.id}
              model={model}
              writable={modelWritable}
              onEdit={onEditModel}
              onSimulate={onSimulateModel}
              onArchive={onArchiveModel}
            />
          ))
        )}
      </div>
    </Card>
  );
}
