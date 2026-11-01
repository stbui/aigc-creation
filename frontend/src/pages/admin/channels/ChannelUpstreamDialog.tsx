import { useEffect, useMemo, useState } from 'react';
import { UploadCloud } from 'lucide-react';
import { Button, CheckBox, ModalDialog, StatusTag, TextInput } from './components';
import type { UpstreamModelPreview } from '../../../types/model';

interface ChannelUpstreamDialogProps {
  open: boolean;
  /** 服务端用已保存凭证拉取的上游目录；打开前已就绪 */
  models: UpstreamModelPreview[];
  /** 本地已有的上游键（大小写不敏感），命中就不会重复写入 */
  existingKeys: Set<string>;
  importing: boolean;
  onClose: () => void;
  onImport: (ids: string[]) => void;
}

/**
 * 上游目录导入弹窗。
 *
 * 一家厂商动辄几十上百个模型，内联列表会把「这条渠道有哪些模型」挤到屏幕外；
 * 弹窗里带搜索与「已存在」计数，默认只预选本地还没有的模型。
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

  useEffect(() => {
    if (!open) return;
    setKeyword('');
    // 默认预选「本地还没有」的模型：已存在的由用户自己决定要不要再导入一次
    setSelected(models.filter((item) => !existingKeys.has(item.id.toLowerCase())).map((item) => item.id));
  }, [open, models, existingKeys]);

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

  return (
    <ModalDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      width={760}
      title="选择要导入的模型"
      description="只写入勾选项；导入后默认停用，需要补能力合同与价格后再启用"
      footer={
        <>
          <Button variant="secondary" size="small" disabled={importing} onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            size="small"
            leadingIcon={UploadCloud}
            disabled={importing || selectedNew.length === 0}
            onClick={() => onImport(selected)}
          >
            {importing ? '导入中…' : `导入 ${selectedNew.length} 个新模型`}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <TextInput
          ariaLabel="搜索上游模型"
          value={keyword}
          onChange={setKeyword}
          placeholder="搜索模型标识或显示名"
          allowClear
        />
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border-table px-3 py-2">
          <span className="text-xs text-text-secondary">
            已选 {selected.length} / {models.length}
            {keyword.trim() ? `，当前匹配 ${visible.length}` : ''}
            {selectedExisting > 0 ? `（其中 ${selectedExisting} 个已存在，不会重复导入）` : ''}
          </span>
          <div className="flex items-center gap-1.5">
            <Button
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
            </Button>
            <Button
              variant="secondary"
              size="xs"
              disabled={importing || selectedVisibleCount === 0}
              onClick={() =>
                setSelected((prev) => prev.filter((id) => !visible.some((item) => item.id === id)))
              }
            >
              {keyword.trim() ? '取消选中匹配的' : '取消全选'}
            </Button>
          </div>
        </div>
        <div className="flex max-h-[360px] flex-col gap-1 overflow-y-auto rounded-lg border border-border-table p-2">
          {visible.length === 0 ? (
            <p className="py-6 text-center text-xs text-text-tertiary">
              {keyword.trim() ? `没有匹配「${keyword.trim()}」的模型` : '上游没有返回可用模型'}
            </p>
          ) : (
            visible.map((item) => {
              const exists = existingKeys.has(item.id.toLowerCase());
              return (
                <label
                  key={item.id}
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-background-secondary-default"
                >
                  <CheckBox
                    size="sm"
                    checked={selected.includes(item.id)}
                    onChange={(checked) =>
                      setSelected((prev) =>
                        checked ? [...prev, item.id] : prev.filter((id) => id !== item.id),
                      )
                    }
                    ariaLabel={`选择上游模型 ${item.id}`}
                  />
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-text-primary">
                    {item.id}
                  </span>
                  {exists && <StatusTag status="upstream-existing" tone="muted" label="已存在" />}
                  <span className="shrink-0 text-[11px] text-text-tertiary">
                    {item.displayName || item.modelType || ''}
                  </span>
                </label>
              );
            })
          )}
        </div>
      </div>
    </ModalDialog>
  );
}
