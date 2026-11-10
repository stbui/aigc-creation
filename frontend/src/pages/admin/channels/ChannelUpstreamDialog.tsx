import { useEffect, useMemo, useState } from 'react';
import { UploadCloud } from 'lucide-react';
import {
  ActionButton,
  CheckboxField,
  ClearableField,
  ModalDialog,
  SelectField,
  StatusTag,
  TextField,
} from '~/admin-ui/primitives';
import { useProtocolCatalog } from './useChannelModels';
import { parseCredits } from './utils';
import {
  BILLING_MODE_OPTIONS,
  CAPABILITY_OPTIONS,
  type BatchImportConfig,
} from './constants';
import type { UpstreamModelPreview } from '../../../types/model';

interface ChannelUpstreamDialogProps {
  open: boolean;
  /** 服务端用已保存凭证拉取的上游目录；打开前已就绪 */
  models: UpstreamModelPreview[];
  /** 本地已有的上游键（大小写不敏感），命中就不会重复写入 */
  existingKeys: Set<string>;
  importing: boolean;
  onClose: () => void;
  onImport: (ids: string[], config?: BatchImportConfig) => void;
}

/** 可批量写默认合同的能力；video 的参数组合差异太大，留给逐条配置 */
const BATCH_CAPABILITIES = CAPABILITY_OPTIONS.filter(
  (item) => item.value === 'image' || item.value === 'text',
);

/**
 * 上游目录导入弹窗。
 *
 * 一家厂商动辄几十上百个模型，内联列表会把「这条渠道有哪些模型」挤到屏幕外；
 * 弹窗里带搜索与「已存在」计数，默认只预选本地还没有的模型。
 *
 * 新增「导入后统一配置」：填一次类型、接入方式与售价，导入后由调用方逐条
 * 写入默认合同。不填则保持原行为，只建骨架行。
 */
export function ChannelUpstreamDialog({
  open,
  models,
  existingKeys,
  importing,
  onClose,
  onImport,
}: ChannelUpstreamDialogProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [keyword, setKeyword] = useState('');
  const [capability, setCapability] = useState<'' | 'image' | 'text'>('');
  const [protocol, setProtocol] = useState('');
  const [billingMode, setBillingMode] = useState('fixed_request');
  const [unitPrice, setUnitPrice] = useState('');
  const [inputPrice, setInputPrice] = useState('');
  const [outputPrice, setOutputPrice] = useState('');
  const [cachedPrice, setCachedPrice] = useState('');
  const [configError, setConfigError] = useState('');

  const { protocols, options: protocolOptions, loading: protocolLoading } =
    useProtocolCatalog(capability);
  const selectedProtocol = useMemo(
    () => protocols.find((item) => item.id === protocol),
    [protocols, protocol],
  );

  useEffect(() => {
    if (!open) return;
    setKeyword('');
    // 默认预选「本地还没有」的模型：已存在的由用户自己决定要不要再导入一次
    setSelected(models.filter((item) => !existingKeys.has(item.id.toLowerCase())).map((item) => item.id));
  }, [open, models, existingKeys]);

  useEffect(() => {
    setProtocol('');
    setBillingMode('fixed_request');
    setConfigError('');
  }, [capability]);

  const visible = useMemo(() => {
    const query = keyword.trim().toLowerCase();
    return models.filter(
      (item) => !query || `${item.id} ${item.displayName ?? ''}`.toLowerCase().includes(query),
    );
  }, [models, keyword]);

  const selectedNew = selected.filter((id) => !existingKeys.has(id.toLowerCase()));
  const selectedExisting = selected.length - selectedNew.length;
  const allVisibleSelected =
    visible.length > 0 && visible.every((item) => selected.includes(item.id));
  const selectedVisibleCount = visible.filter((item) => selected.includes(item.id)).length;

  const billingOptions = BILLING_MODE_OPTIONS.filter(
    (item) => item.value === 'fixed_request' || (item.value === 'token' && capability === 'text'),
  );
  const priceReady =
    billingMode === 'token'
      ? outputPrice.trim() !== ''
      : unitPrice.trim() !== '';
  const batchReady = Boolean(capability && protocol && priceReady);

  const buildConfig = (): BatchImportConfig | null | undefined => {
    if (!capability) return undefined;
    if (!protocol) {
      setConfigError('请选择接入方式，或清空模型类型改用骨架导入');
      return null;
    }
    if (!priceReady) {
      setConfigError(billingMode === 'token' ? '请填写输出用量价格' : '请填写售价');
      return null;
    }
    const unit = parseCredits(unitPrice);
    const input = parseCredits(inputPrice);
    const output = parseCredits(outputPrice);
    const cached = parseCredits(cachedPrice);
    if ([unit, input, output, cached].some((value) => value === null)) {
      setConfigError('售价必须是数字，最多 6 位小数');
      return null;
    }
    setConfigError('');
    return {
      capability,
      protocol,
      billingMode,
      unitPriceMicrocredits: unit ?? 0,
      inputTokenPriceMicrocredits: input ?? 0,
      outputTokenPriceMicrocredits: output ?? 0,
      cachedTokenPriceMicrocredits: cached ?? 0,
      imageParameters: selectedProtocol?.imageParameters ?? [],
    };
  };

  const submit = () => {
    const config = buildConfig();
    if (config === null) return;
    onImport(selected, config);
  };

  return (
    <ModalDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      width={760}
      title="导入供应商商品"
      description="仅添加勾选的商品；默认停用。可统一填类型、接入方式与售价，省去逐条编辑。"
      footer={
        <>
          <ActionButton variant="secondary" size="sm" disabled={importing} onClick={onClose}>
            取消
          </ActionButton>
          <ActionButton
            variant="default"
            size="sm"
            icon={UploadCloud}
            disabled={importing || selectedNew.length === 0}
            onClick={submit}
          >
            {importing
              ? '导入中…'
              : batchReady
                ? `导入并配置 ${selectedNew.length} 个新商品`
                : `导入 ${selectedNew.length} 个新商品`}
          </ActionButton>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <ClearableField
          ariaLabel="搜索供应商商品"
          value={keyword}
          onChange={setKeyword}
          placeholder="搜索商品编号或展示名称"
        />
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
          <span className="text-xs text-muted-foreground">
            已选 {selected.length} / {models.length}
            {keyword.trim() ? `，当前匹配 ${visible.length}` : ''}
            {selectedExisting > 0 ? `（其中 ${selectedExisting} 个已存在，不会重复导入）` : ''}
          </span>
          <div className="flex items-center gap-1.5">
            <ActionButton
              variant="secondary"
              size="xs"
              disabled={importing || allVisibleSelected || visible.length === 0}
              onClick={() =>
                setSelected((prev) => [
                  ...prev,
                  ...visible.map((item) => item.id).filter((id) => !prev.includes(id)),
                ])
              }
            >
              {keyword.trim() ? `全选匹配的 ${visible.length} 个` : '全选'}
            </ActionButton>
            <ActionButton
              variant="secondary"
              size="xs"
              disabled={importing || selectedVisibleCount === 0}
              onClick={() =>
                setSelected((prev) => prev.filter((id) => !visible.some((item) => item.id === id)))
              }
            >
              {keyword.trim() ? '取消选中匹配的' : '取消全选'}
            </ActionButton>
          </div>
        </div>

        <section className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <div>
            <div className="text-xs font-semibold text-foreground">导入后统一配置（可选）</div>
            <div className="text-[12px] text-muted-foreground">
              只支持图像与文本；视频 / 音频请导入后逐条配置。不填则只建骨架行。
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <SelectField
              ariaLabel="统一模型类型"
              value={capability || undefined}
              options={BATCH_CAPABILITIES}
              placeholder="不统一配置"
              allowClear
              clearLabel="不统一配置"
              onChange={(value) => setCapability((value as 'image' | 'text') ?? '')}
            />
            <SelectField
              ariaLabel="统一接入方式"
              value={protocol || undefined}
              options={protocolOptions}
              placeholder={protocolLoading ? '读取中…' : '选择接入方式'}
              disabled={!capability || protocolLoading}
              onChange={(value) => setProtocol(value ?? '')}
            />
            <SelectField
              ariaLabel="统一计费方式"
              value={billingMode}
              options={billingOptions}
              onChange={(value) => setBillingMode(value ?? 'fixed_request')}
            />
          </div>

          <div className="grid grid-cols-3 gap-2">
            {billingMode === 'token' ? (
              <>
                <TextField
                  ariaLabel="统一输入用量价格"
                  inputMode="decimal"
                  value={inputPrice}
                  onChange={setInputPrice}
                  placeholder="输入用量价格"
                />
                <TextField
                  ariaLabel="统一输出用量价格"
                  inputMode="decimal"
                  value={outputPrice}
                  onChange={setOutputPrice}
                  placeholder="输出用量价格（必填）"
                />
                <TextField
                  ariaLabel="统一缓存内容价格"
                  inputMode="decimal"
                  value={cachedPrice}
                  onChange={setCachedPrice}
                  placeholder="缓存内容价格"
                />
              </>
            ) : (
              <TextField
                ariaLabel="统一售价"
                inputMode="decimal"
                value={unitPrice}
                onChange={setUnitPrice}
                placeholder="售价（积分，0 表示免费）"
              />
            )}
          </div>
          {configError && <p className="text-[12px] text-danger-text">{configError}</p>}
        </section>

        <div className="flex max-h-[360px] flex-col gap-1 overflow-y-auto rounded-lg border border-border p-2">
          {visible.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              {keyword.trim() ? `没有匹配「${keyword.trim()}」的商品` : '供应商没有返回可用商品'}
            </p>
          ) : (
            visible.map((item) => {
              const exists = existingKeys.has(item.id.toLowerCase());
              return (
                <CheckboxField
                  key={item.id}
                  size="sm"
                  checked={selected.includes(item.id)}
                  onChange={(checked) =>
                    setSelected((prev) =>
                      checked ? [...prev, item.id] : prev.filter((id) => id !== item.id),
                    )
                  }
                  ariaLabel={`选择供应商商品 ${item.id}`}
                  className="w-full rounded-lg px-2 py-1.5 hover:bg-muted"
                  label={
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground">
                        {item.id}
                      </span>
                      {exists && (
                        <StatusTag status="upstream-existing" tone="muted" label="已存在" />
                      )}
                      <span className="shrink-0 text-[12px] text-muted-foreground">
                        {item.displayName || item.modelType || ''}
                      </span>
                    </span>
                  }
                />
              );
            })
          )}
        </div>
      </div>
    </ModalDialog>
  );
}
