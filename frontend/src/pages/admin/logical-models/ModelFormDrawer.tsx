import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  ActionButton,
  Drawer,
  FormField,
  IconButton,
  Notice,
  NumberField,
  SelectField,
  SwitchField,
  TextAreaField,
  TextField,
} from '~/admin-ui/primitives';
import {
  BILLING_MODE_OPTIONS,
  PRICE_POLICY_OPTIONS,
  type ModelDraft,
  type RouteDraft,
} from './constants';
import type { AdminChannelModelListItem, AdminLogicalModelView } from '../../../types/model';

/** 从能力 id + 商品编号生成一个后端能接受的上架编号 */
function productCode(capability: string, modelKey: string): string {
  const raw = `${capability}-${modelKey}`
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return (raw || 'model').slice(0, 80);
}

/**
 * 新建 / 编辑售卖配置。
 *
 * 全量提交：未填字段按默认值落库，保存即生成新 revision 并重建线路。
 * 因此这里不做字段级脏标记，整张表单共用一个 dirty 判定，关闭前统一确认。
 */
export function ModelFormDrawer({
  open,
  editing,
  draft,
  dirty,
  saving,
  writable,
  capabilityOptions,
  channelModelOptions,
  products,
  capabilityModalityById,
  canReadChannels,
  canReadPlugins,
  onClose,
  onChange,
  onAddRoute,
  onUpdateRoute,
  onRemoveRoute,
  onSave,
}: {
  open: boolean;
  editing: AdminLogicalModelView | null;
  draft: ModelDraft;
  dirty: boolean;
  saving: boolean;
  writable: boolean;
  capabilityOptions: Array<{ value: string; label: string }>;
  channelModelOptions: Array<{ value: string; label: string }>;
  /** 商品台账（可用于新建售卖配置时一键带入） */
  products: AdminChannelModelListItem[];
  /** 能力 id → 产出模态；用于过滤兼容商品 */
  capabilityModalityById: Map<string, string>;
  canReadChannels: boolean;
  canReadPlugins: boolean;
  onClose: () => void;
  onChange: (patch: Partial<ModelDraft>) => void;
  onAddRoute: () => void;
  onUpdateRoute: (key: string, patch: Partial<RouteDraft>) => void;
  onRemoveRoute: (key: string) => void;
  onSave: () => void;
}) {
  const [advancedRoutes, setAdvancedRoutes] = useState(false);
  const [pickedId, setPickedId] = useState('');
  const routeGrid = advancedRoutes
    ? 'grid-cols-[minmax(0,1fr)_72px_72px_96px_32px]'
    : 'grid-cols-[minmax(0,1fr)_96px_32px]';
  const unavailableReasons = editing
    ? [editing.configurationError, editing.availabilityError].filter(Boolean)
    : [];

  const modality = capabilityModalityById.get(draft.capability) ?? '';
  const compatibleProducts = useMemo(
    () =>
      products.filter(
        (product) =>
          (!modality || product.capability === modality) &&
          product.enabled &&
          product.channelEnabled &&
          product.priceConfigured,
      ),
    [modality, products],
  );

  const pickProduct = (id: string) => {
    const product = compatibleProducts.find((item) => item.id === id);
    if (!product) return;
    setPickedId(id);
    onChange({
      code: productCode(draft.capability, product.modelKey),
      name: product.displayName || product.modelKey,
      icon: product.icon,
      description: product.description,
      pricePolicy: 'channel',
      capabilitySpecText: '',
      routes: [
        {
          key: `picked-${product.id}`,
          channelModelId: product.id,
          enabled: true,
          priority: '100',
          weight: '100',
        },
      ],
    });
  };

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      width={760}
      title={editing ? `编辑售卖配置 · ${editing.name}` : '添加模型商品'}
      description={dirty ? '有未保存修改' : undefined}
      footer={
        <>
          <ActionButton variant="secondary" size="sm" onClick={onClose} disabled={saving}>
            取消
          </ActionButton>
          <ActionButton
            variant="default"
            size="sm"
            disabled={saving || !writable}
            onClick={onSave}
          >
            {saving ? '保存中…' : editing ? '保存修改' : '创建模型'}
          </ActionButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {unavailableReasons.length > 0 && (
          <Notice tone="warn" title="商品暂不可售">
            <ul className="mt-1 list-disc pl-4">
              {unavailableReasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </Notice>
        )}

        {!editing && (
          <section className="flex flex-col gap-2 rounded-lg border border-brand/20 bg-brand-bg/40 p-3">
            <div>
              <div className="text-xs font-semibold text-foreground">从商品台账选择</div>
              <div className="text-[12px] text-muted-foreground">
                选择后自动带入名称、上架编号、图标与服务来源；也可继续手动填写。
              </div>
            </div>
            {!draft.capability ? (
              <p className="text-[12px] text-muted-foreground">
                先选择「所属能力」，再挑一个兼容的模型商品。
              </p>
            ) : compatibleProducts.length === 0 ? (
              <p className="text-[12px] text-muted-foreground">
                当前能力没有可售的模型商品；先到「模型商品」接入并定价。
              </p>
            ) : (
              <SelectField
                ariaLabel="选择模型商品"
                value={pickedId || undefined}
                options={compatibleProducts.map((product) => ({
                  value: product.id,
                  label: `${product.channelName || product.channelId} / ${
                    product.displayName || product.modelKey
                  }`,
                }))}
                placeholder="选择模型商品"
                onChange={(value) => value && pickProduct(value)}
              />
            )}
          </section>
        )}

        <section className="flex flex-col gap-3">
          <div className="text-xs font-semibold text-foreground">售卖信息</div>
          <div className="grid grid-cols-3 gap-3">
            <FormField
              label="上架编号"
              required
              hint={editing ? '创建后不可修改' : undefined}
            >
              <TextField
                ariaLabel="上架编号"
                value={draft.code}
                onChange={(value) => onChange({ code: value })}
                placeholder="例如：ecom-image-pro"
                disabled={!!editing}
                maxLength={80}
              />
            </FormField>
            <FormField label="展示名称" required>
              <TextField
                ariaLabel="展示名称"
                value={draft.name}
                onChange={(value) => onChange({ name: value })}
                placeholder="例如：电商主图 Pro"
                maxLength={60}
              />
            </FormField>
            <FormField label="商品图标">
              <TextField
                ariaLabel="商品图标"
                value={draft.icon}
                onChange={(value) => onChange({ icon: value })}
                placeholder="🎨"
                maxLength={8}
              />
            </FormField>
          </div>

          <FormField label="商品描述">
            <TextAreaField
              ariaLabel="商品描述"
              value={draft.description}
              onChange={(value) => onChange({ description: value })}
              rows={2}
              maxLength={200}
              placeholder="例如：高质量商品主图生成，支持多尺寸"
            />
          </FormField>
        </section>

        <section className="flex flex-col gap-3">
          <div className="text-xs font-semibold text-foreground">售卖设置</div>
          <div className="grid grid-cols-3 gap-3">
            <FormField label="所属能力" required>
              <SelectField
                ariaLabel="所属能力"
                value={draft.capability || undefined}
                options={capabilityOptions}
                onChange={(value) => onChange({ capability: value ?? '' })}
                placeholder="选择所属能力"
              />
            </FormField>
            <FormField label="展示排序" hint="数字越小，展示越靠前">
              <NumberField
                ariaLabel="展示排序"
                value={Number(draft.sortOrder) || 0}
                min={0}
                onChange={(value) => onChange({ sortOrder: String(value ?? 0) })}
              />
            </FormField>
            <FormField label="售卖状态">
              <div className="flex h-8 items-center">
                <SwitchField
                  checked={draft.enabled}
                  label={draft.enabled ? '售卖中' : '未售卖'}
                  ariaLabel="上架状态"
                  onChange={(checked) => onChange({ enabled: checked })}
                />
              </div>
            </FormField>
          </div>
        </section>

        <div className="rounded-lg border border-border p-3">
          <div className="mb-2 text-xs font-semibold text-foreground">售价设置</div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="价格来源">
              <SelectField
                ariaLabel="定价方式"
                value={draft.pricePolicy}
                options={PRICE_POLICY_OPTIONS}
                onChange={(value) => onChange({ pricePolicy: value ?? 'channel' })}
              />
            </FormField>
            <FormField label="计费方式">
              <SelectField
                ariaLabel="计费方式"
                value={draft.billingMode}
                options={BILLING_MODE_OPTIONS}
                onChange={(value) => onChange({ billingMode: value ?? 'fixed_request' })}
              />
            </FormField>
          </div>
          {draft.pricePolicy === 'unified' && (
            draft.billingMode === 'token' ? (
              <div className="mt-3 grid grid-cols-3 gap-3">
                <FormField label="输入内容单价">
                  <TextField
                    ariaLabel="输入内容单价"
                    inputMode="decimal"
                    value={draft.inputPrice}
                    onChange={(value) => onChange({ inputPrice: value })}
                  />
                </FormField>
                <FormField label="输出内容单价">
                  <TextField
                    ariaLabel="输出内容单价"
                    inputMode="decimal"
                    value={draft.outputPrice}
                    onChange={(value) => onChange({ outputPrice: value })}
                  />
                </FormField>
                <FormField label="缓存内容单价">
                  <TextField
                    ariaLabel="缓存内容单价"
                    inputMode="decimal"
                    value={draft.cachedPrice}
                    onChange={(value) => onChange({ cachedPrice: value })}
                  />
                </FormField>
              </div>
            ) : (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <FormField
                  label={draft.billingMode === 'per_second' ? '每秒价格' : '每次价格'}
                >
                  <TextField
                    ariaLabel="单价"
                    inputMode="decimal"
                    value={draft.unitPrice}
                    onChange={(value) => onChange({ unitPrice: value })}
                  />
                </FormField>
              </div>
            )
          )}
        </div>

        <div className="rounded-lg border border-border p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold text-foreground">模型商品</div>
              <div className="text-[12px] text-muted-foreground">
                {advancedRoutes
                  ? '优先顺位数值越小，越先使用；同一顺位按比例分流'
                  : '默认一个商品；需要主用 / 备用或分流时再打开高级分流'}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <SwitchField
                checked={advancedRoutes}
                label="高级分流"
                ariaLabel="高级分流"
                onChange={setAdvancedRoutes}
              />
              <ActionButton
                variant="secondary"
                size="xs"
                icon={Plus}
                disabled={!writable}
                onClick={onAddRoute}
              >
                添加商品
              </ActionButton>
            </div>
          </div>
          {channelModelOptions.length === 0 && (
            <Notice tone="warn" title="没有可选的模型商品" className="mb-2">
              模型商品来自供应商的商品清单；若尚未配置，先到
              {canReadChannels ? (
                <Link className="mx-1 text-brand hover:underline" to="/admin/channels">
                  模型商品
                </Link>
              ) : (
                '「模型商品」'
              )}
              添加供应商与商品；接入方式由
              {canReadPlugins ? (
                <Link className="mx-1 text-brand hover:underline" to="/admin/plugins">
                  插件
                </Link>
              ) : (
                '「插件」'
              )}
              提供。
            </Notice>
          )}
          {draft.routes.length === 0 ? (
            <p className="py-3 text-center text-[12px] text-muted-foreground">
              {channelModelOptions.length === 0
                ? '没有可用的模型商品，暂时无法添加。'
                : '尚未添加模型商品，暂不可售。'}
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              <div
                className={`grid ${routeGrid} gap-2 px-1 text-[12px] text-muted-foreground`}
              >
                <span>模型商品</span>
                {advancedRoutes && (
                  <>
                    <span>优先顺位</span>
                    <span>分流比例</span>
                  </>
                )}
                <span>状态</span>
                <span />
              </div>
              {draft.routes.map((route) => (
                <div key={route.key} className={`grid ${routeGrid} items-end gap-2`}>
                  <SelectField
                    ariaLabel="模型商品"
                    value={route.channelModelId || undefined}
                    options={channelModelOptions}
                    onChange={(value) => onUpdateRoute(route.key, { channelModelId: value ?? '' })}
                    placeholder="选择模型商品"
                  />
                  {advancedRoutes && (
                    <>
                      <NumberField
                        ariaLabel="模型商品优先顺位"
                        value={Number(route.priority) || 0}
                        min={0}
                        onChange={(value) =>
                          onUpdateRoute(route.key, { priority: String(value ?? 0) })
                        }
                      />
                      <NumberField
                        ariaLabel="模型商品分流比例"
                        value={Number(route.weight) || 0}
                        min={0}
                        onChange={(value) =>
                          onUpdateRoute(route.key, { weight: String(value ?? 0) })
                        }
                      />
                    </>
                  )}
                  <SwitchField
                    checked={route.enabled}
                    label={route.enabled ? '已启用' : '已停用'}
                    ariaLabel="模型商品状态"
                    onChange={(checked) => onUpdateRoute(route.key, { enabled: checked })}
                  />
                  <IconButton
                    icon={Trash2}
                    label="删除模型商品"
                    size="xs"
                    onClick={() => onRemoveRoute(route.key)}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {editing && (
          <details className="rounded-lg border border-border p-3">
            <summary className="cursor-pointer text-xs font-semibold text-foreground">
              高级（一般无需修改）
            </summary>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <FormField label="能力范围" hint="限制可提供的服务与规格">
                <TextAreaField
                  ariaLabel="能力范围"
                  value={draft.capabilitySpecText}
                  onChange={(value) => onChange({ capabilitySpecText: value })}
                  rows={6}
                />
              </FormField>
              <FormField label="默认选项" hint="用户未选择时自动采用">
                <TextAreaField
                  ariaLabel="默认选项"
                  value={draft.defaultOptionsText}
                  onChange={(value) => onChange({ defaultOptionsText: value })}
                  rows={6}
                />
              </FormField>
            </div>
          </details>
        )}

      </div>
    </Drawer>
  );
}
