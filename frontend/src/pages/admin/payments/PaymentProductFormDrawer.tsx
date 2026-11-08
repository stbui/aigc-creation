import {
  ActionButton,
  Drawer,
  FormField,
  Notice,
  NumberField,
  SelectField,
  SwitchField,
  TextAreaField,
  TextField,
} from '~/admin-ui/primitives';
import type { AdminPaymentProductView, PaymentCurrency, PaymentSaleStrategy } from '../../../types/payment';
import { PAYMENT_CURRENCY_OPTIONS, PAYMENT_PRODUCT_STRATEGY_OPTIONS, type PaymentProductDraft } from './constants';

interface PaymentProductFormDrawerProps {
  open: boolean;
  editing: AdminPaymentProductView | null;
  draft: PaymentProductDraft;
  writable: boolean;
  usdAvailable: boolean;
  saving: boolean;
  onPatch: (patch: Partial<PaymentProductDraft>) => void;
  onClose: () => void;
  onSubmit: () => void;
}

/** 充值商品新增 / 编辑抽屉。父组件只负责打开状态与保存后的列表刷新。 */
export function PaymentProductFormDrawer({
  open,
  editing,
  draft,
  writable,
  usdAvailable,
  saving,
  onPatch,
  onClose,
  onSubmit,
}: PaymentProductFormDrawerProps) {
  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={editing ? `编辑商品 · ${editing.name}` : '新增商品'}
      description="售价按元 / 美元填写，提交时换算为整数分"
      width={520}
      footer={
        <div className="flex items-center justify-end gap-2">
          <ActionButton onClick={onClose} disabled={saving}>
            取消
          </ActionButton>
          <ActionButton onClick={onSubmit} disabled={saving || !draft.name.trim()}>
            {saving ? '保存中…' : '保存'}
          </ActionButton>
        </div>
      }
    >
      <div className="flex flex-col gap-3.5">
        <FormField label="商品名称" required>
          <TextField
            value={draft.name}
            onChange={(value) => onPatch({ name: value })}
            placeholder="例如：2,000 积分高能包"
            maxLength={80}
            disabled={!writable}
          />
        </FormField>

        <FormField label="商品说明">
          <TextAreaField
            value={draft.description}
            onChange={(value) => onPatch({ description: value })}
            maxLength={200}
            disabled={!writable}
          />
        </FormField>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="售价币种" required>
            <SelectField
              value={draft.currency}
              onChange={(value) => onPatch({ currency: (value as PaymentCurrency) ?? 'CNY' })}
              options={PAYMENT_CURRENCY_OPTIONS}
              disabled={!writable}
            />
          </FormField>

          <FormField label="售价" required hint="大于 0，最多两位小数">
            <TextField
              value={draft.price}
              onChange={(value) => onPatch({ price: value })}
              placeholder="9.90"
              inputMode="decimal"
              disabled={!writable}
            />
          </FormField>
        </div>

        {!usdAvailable && draft.currency === 'USD' && (
          <Notice tone="warn" title="暂无美元支付渠道">
            当前没有已配置的美元渠道，美元商品可以保存为下架状态，但不能上架。
          </Notice>
        )}

        <FormField label="划线价" hint="留空表示没有划线价">
          <TextField
            value={draft.originalPrice}
            onChange={(value) => onPatch({ originalPrice: value })}
            placeholder="19.90"
            inputMode="decimal"
            disabled={!writable}
          />
        </FormField>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="到账积分" required>
            <TextField
              value={draft.credits}
              onChange={(value) => onPatch({ credits: value })}
              inputMode="numeric"
              placeholder="2000"
              disabled={!writable}
            />
          </FormField>

          <FormField label="积分有效期（天）" hint="0 = 永久有效">
            <TextField
              value={draft.creditsValidDays}
              onChange={(value) => onPatch({ creditsValidDays: value })}
              inputMode="numeric"
              disabled={!writable}
            />
          </FormField>
        </div>

        <FormField label="上架策略" required>
          <SelectField
            value={draft.saleStrategy}
            onChange={(value) =>
              onPatch({
                saleStrategy: (value as PaymentSaleStrategy) ?? 'unlimited',
              })
            }
            options={PAYMENT_PRODUCT_STRATEGY_OPTIONS}
            disabled={!writable}
          />
        </FormField>

        {draft.saleStrategy === 'periodic' && (
          <div className="grid grid-cols-2 gap-3">
            <FormField label="周期天数" required>
              <NumberField
                value={Number(draft.periodDays) || 30}
                onChange={(value) => onPatch({ periodDays: String(value ?? 30) })}
                min={1}
                max={365}
                disabled={!writable}
                ariaLabel="周期天数"
              />
            </FormField>
            <FormField label="周期限购次数" required>
              <NumberField
                value={Number(draft.periodPurchaseLimit) || 1}
                onChange={(value) => onPatch({ periodPurchaseLimit: String(value ?? 1) })}
                min={1}
                max={999}
                disabled={!writable}
                ariaLabel="周期限购次数"
              />
            </FormField>
          </div>
        )}

        {draft.saleStrategy === 'inventory' && (
          <FormField label="库存总量" required hint="必须大于 0；售罄后不可购买">
            <NumberField
              value={Number(draft.stockTotal) || 0}
              onChange={(value) => onPatch({ stockTotal: String(value ?? 0) })}
              min={1}
              max={1_000_000}
              disabled={!writable}
              ariaLabel="库存总量"
            />
          </FormField>
        )}

        {draft.saleStrategy === 'timed' && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="开售时间" required>
                <TextField
                  type="datetime-local"
                  value={draft.saleStartAt}
                  onChange={(value) => onPatch({ saleStartAt: value })}
                  disabled={!writable}
                />
              </FormField>
              <FormField label="结束时间" required>
                <TextField
                  type="datetime-local"
                  value={draft.saleEndAt}
                  onChange={(value) => onPatch({ saleEndAt: value })}
                  disabled={!writable}
                />
              </FormField>
            </div>
            <p className="text-[12px] text-muted-foreground">
              时间按浏览器本地时区显示，保存为绝对时间（中国区即北京时间）。
            </p>
          </>
        )}

        <FormField label="排序" hint="数字越小越靠前">
          <NumberField
            value={Number(draft.sortOrder) || 0}
            onChange={(value) => onPatch({ sortOrder: String(value ?? 0) })}
            min={0}
            max={9999}
            disabled={!writable}
            ariaLabel="排序"
          />
        </FormField>

        <FormField label="上架" hint="下架的商品用户看不到也买不了">
          <SwitchField
            checked={draft.enabled}
            onChange={(checked) => onPatch({ enabled: checked })}
            label={draft.enabled ? '已上架' : '已下架'}
            disabled={!writable}
            ariaLabel="上架开关"
          />
        </FormField>
      </div>
    </Drawer>
  );
}
