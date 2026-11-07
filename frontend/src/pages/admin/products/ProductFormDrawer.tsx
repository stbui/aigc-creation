import {
  ActionButton,
  Drawer,
  FormField,
  SelectField,
  TextAreaField,
  TextField,
} from '~/admin-ui/primitives';
import { GRANT_TYPE_OPTIONS, type ProductDraft } from './constants';
import type { AdminProduct } from '../../../types/api';

interface ProductFormDrawerProps {
  open: boolean;
  editing: AdminProduct | null;
  draft: ProductDraft;
  formDirty: boolean;
  saving: boolean;
  onPatch: (patch: Partial<ProductDraft>) => void;
  onClose: () => void;
  onSubmit: () => void;
}

/**
 * 商品表单：SKU 创建后不可改（历史订单与外部对账靠它认商品）。
 */
export function ProductFormDrawer({
  open,
  editing,
  draft,
  formDirty,
  saving,
  onPatch,
  onClose,
  onSubmit,
}: ProductFormDrawerProps) {
  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      width={520}
      title={editing ? '编辑商品' : '新建商品'}
      description={formDirty ? '有未保存修改' : undefined}
      footer={
        <>
          <ActionButton variant="secondary" onClick={onClose} disabled={saving}>
            取消
          </ActionButton>
          <ActionButton disabled={saving} onClick={onSubmit}>
            {saving ? '保存中…' : editing ? '保存修改' : '创建'}
          </ActionButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <FormField
          label="SKU"
          hint={
            editing
              ? 'SKU 创建后不可修改：历史订单与外部对账都靠它认商品'
              : '只允许字母、数字与连字符，创建后不可修改'
          }
        >
          <TextField
            ariaLabel="SKU"
            value={draft.sku}
            disabled={editing !== null}
            onChange={(value) => onPatch({ sku: value })}
            placeholder="如 credits-100"
            maxLength={40}
          />
        </FormField>

        <FormField label="商品名称">
          <TextField
            ariaLabel="商品名称"
            value={draft.name}
            onChange={(value) => onPatch({ name: value })}
            placeholder="如 100 积分包"
            maxLength={80}
          />
        </FormField>

        <FormField label="商品描述">
          <TextAreaField
            ariaLabel="商品描述"
            value={draft.description}
            onChange={(value) => onPatch({ description: value })}
            rows={2}
            maxLength={500}
            placeholder="展示在结算页的补充说明，可留空"
          />
        </FormField>

        <div className="grid grid-cols-2 gap-4">
          <FormField label="售价（元）" hint="两位小数">
            <TextField
              ariaLabel="售价"
              inputMode="decimal"
              value={draft.priceYuan}
              onChange={(value) => onPatch({ priceYuan: value })}
              placeholder="9.90"
            />
          </FormField>
          <FormField label="划线价（元）" hint="仅用于展示对比，不参与结算">
            <TextField
              ariaLabel="划线价"
              inputMode="decimal"
              value={draft.originalPriceYuan}
              onChange={(value) => onPatch({ originalPriceYuan: value })}
              placeholder="留空表示不展示"
            />
          </FormField>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField label="赠送积分">
            <TextField
              ariaLabel="赠送积分"
              inputMode="numeric"
              value={draft.credits}
              onChange={(value) => onPatch({ credits: value })}
              placeholder="100"
            />
          </FormField>
          <FormField label="积分有效期（天）" hint="0 表示永久有效，不参与到期回收">
            <TextField
              ariaLabel="积分有效期天数"
              inputMode="numeric"
              value={draft.creditsValidDays}
              onChange={(value) => onPatch({ creditsValidDays: value })}
              placeholder="0"
            />
          </FormField>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField
            label="发放方式"
            hint={draft.grantType === 'manual' ? '需运营在积分账本中手动发放' : undefined}
          >
            <SelectField
              ariaLabel="发放方式"
              value={draft.grantType}
              onChange={(value) => onPatch({ grantType: value as 'immediate' | 'manual' })}
              options={GRANT_TYPE_OPTIONS}
            />
          </FormField>
          <FormField label="排序权重" hint="数字越小越靠前">
            <TextField
              ariaLabel="排序权重"
              inputMode="numeric"
              value={draft.sortOrder}
              onChange={(value) => onPatch({ sortOrder: value })}
              placeholder="0"
            />
          </FormField>
        </div>
      </div>
    </Drawer>
  );
}
