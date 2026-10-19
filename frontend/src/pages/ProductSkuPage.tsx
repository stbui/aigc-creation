import { useRef, useState } from 'react';
import { App, Spin } from 'antd';
import { Download, ImagePlus, Plus, X } from 'lucide-react';
import { assetsApi, generateApi, toAbsoluteUrl } from '../lib/api';
import { useProject } from '../hooks/useProject';
import { usePollAbort } from '../hooks/usePollAbort';
import { pollToResult } from '../lib/poll';
import { ToolShell, type ToolAsset, type ToolResult, type ToolSettings } from '../components/ToolShell';
import { BG_COLOR_SWATCHES, ColorSwatchGrid, CustomColorInput } from '../components/ToolWidgets';

/**
 * 商品SKU图 —— 1:1 复刻参考站 https://ijihua.cn/product-sku。
 *
 * 实拍结构 (product-sku-control-column):
 *   SKU模板图卡 (product-sku-template-card):
 *     标题行: 从素材库导入(disabled) / 手机上传
 *     copy: 选一张结构最完整的成品图作为模板，框选要跟随SKU变动的区域，最多支持3个SKU变体区域
 *     dropzone (复用 local-redraw-source-upload): 点击或拖拽图片到此处上传 / 最多 1 张
 *   使用步骤卡 (product-sku-steps-card): 4 步
 *     1 上传模板图 — 导入 SKU 图，作为批量生成的模板图
 *     2 框选要变化的区域 — 框选可变内容区域，精准控制生成范围
 *     3 编辑SKU清单 — 录入商品 SKU 信息，配置每个 SKU 的变化内容
 *     4 批量输出SKU图 — 一键生成多款 SKU 图，高效完成批量出图
 *   高级设置: 比例 1:1 / 画质 1K; 提交: 立即生成 本次消耗0积分
 *   结果面板: 商品SKU图 — 一张图，批量套出版式完全一致的整组 SKU 图。
 *
 * 本地适配: 参考站的画布框选 (最多 3 个区域) 以位置枚举代替; SKU 清单每行提交
 * 一次任务 (sku_image), 结果栏并列展示, 支持一键下载。
 *
 * 诚实披露: sku_image 为 mock 能力 (依赖真实 AI 套版), 本地为模板 + 区域填充的
 * 参数化批量渲染。
 */

const REGION_OPTIONS = [
  { value: 'center', label: '画面中心' },
  { value: 'top', label: '画面上方' },
  { value: 'bottom', label: '画面下方' },
  { value: 'left', label: '画面左侧' },
  { value: 'right', label: '画面右侧' },
];

const COLOR_LABEL: Record<string, string> = {
  '#FFFFFF': '白色',
  '#82CEF3': '浅蓝',
  '#3988E9': '蓝色',
  '#FF0B22': '红色',
  '#A8001B': '深红',
  custom: '自定义',
};

interface SkuRow {
  key: number;
  name: string;
  color: string;
  customColor: string;
  region: string;
}

let rowSeq = 0;
const newRow = (): SkuRow => ({ key: ++rowSeq, name: '', color: '#FFFFFF', customColor: '#8064F6', region: 'center' });

export function ProductSkuPage() {
  const { message } = App.useApp();
  const { ensureProject } = useProject();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [template, setTemplate] = useState<ToolAsset | null>(null);
  const [uploading, setUploading] = useState(false);
  const [rows, setRows] = useState<SkuRow[]>([newRow(), newRow()]);
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<ToolResult[]>([]);
  const pollSignal = usePollAbort();

  const uploadTemplate = async (files: FileList | File[]) => {
    const file = Array.from(files).find((f) => f.type.startsWith('image/'));
    if (!file) {
      message.warning('请选择图片文件（PNG / JPG / WebP）');
      return;
    }
    setUploading(true);
    try {
      const projectId = await ensureProject();
      const asset = await assetsApi.upload(file, projectId);
      setTemplate({ id: asset.id, url: toAbsoluteUrl(asset.sourceUrl) ?? '', name: file.name });
      message.success('模板图已上传（最多 1 张，新上传将替换原模板）');
    } catch (e) {
      message.error((e as Error).message || '上传失败');
    } finally {
      setUploading(false);
    }
  };

  const pollOne = (taskId: string) => pollToResult(taskId, { signal: pollSignal });

  const submit = async (inputs: ToolAsset[], settings: ToolSettings) => {
    const tpl = template;
    if (!tpl || rows.length === 0) return;
    setSubmitting(true);
    setResults([]);
    try {
      const projectId = await ensureProject();
      const taskIds: string[] = [];
      for (const row of rows) {
        const { taskId } = await generateApi.start({
          projectId,
          capability: 'sku_image',
          inputAssetIds: [tpl.id],
          params: {
            region: row.region,
            skuName: row.name.trim(),
            skuColor: row.color,
            customColor: row.customColor.trim(),
            ratio: settings.ratio,
            size: settings.resolution,
          },
        });
        taskIds.push(taskId);
      }
      const done = await Promise.all(taskIds.map((id) => pollOne(id)));
      setResults(done);
      const failed = done.filter((r) => r.status !== 'succeeded').length;
      if (failed > 0) message.error(`${done.length} 张中 ${failed} 张生成失败`);
      else message.success(`已批量生成 ${done.length} 张 SKU 图`);
    } catch (e) {
      message.error((e as Error).message || '生成失败');
    } finally {
      setSubmitting(false);
    }
  };

  const downloadAll = () => {
    const ok = results.filter((r) => r.status === 'succeeded' && r.url);
    ok.forEach((r, i) => {
      const a = document.createElement('a');
      a.href = r.url!;
      a.download = `sku-${i + 1}.jpg`;
      a.target = '_blank';
      a.rel = 'noreferrer';
      a.click();
    });
  };

  const updateRow = (key: number, patch: Partial<SkuRow>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <ToolShell
      capability="sku_image"
      title="商品SKU图"
      desc="一张图，批量套出版式完全一致的整组 SKU 图。"
      upload={null}
      settings={{ ratio: true, resolution: true }}
      submitLabel="立即生成"
      creditLabel="本次消耗0积分"
      emptyDesc="上传模板图并编辑 SKU 清单后，批量结果会显示在这里"
      formValid={template !== null && rows.length > 0}
      submitting={submitting}
      result={results.length > 0 ? results : null}
      resultTag={`${rows.length} 个 SKU`}
      onSubmit={submit}
      resultActions={
        <button
          type="button"
          className="pk-result-regen"
          disabled={submitting || results.every((r) => r.status !== 'succeeded')}
          onClick={downloadAll}
        >
          <Download size={13} />
          一键下载
        </button>
      }
    >
      {/* SKU模板图 */}
      <section className="product-sku-card product-sku-template-card">
        <div className="product-sku-card-heading">
          <div className="product-sku-card-heading-top">
            <h2>SKU模板图</h2>
            <div className="product-sku-card-heading-actions">
              <button type="button" className="workspace-material-library-trigger" disabled title="本地演示环境暂不支持素材库导入">
                从素材库导入
              </button>
              <button
                type="button"
                className="mobile-upload-trigger mobile-upload-qr-trigger"
                title="本地演示环境暂不支持手机上传"
                onClick={() => message.info('本地演示环境暂不支持手机上传，可直接拖拽上传')}
              >
                <span>手机上传</span>
              </button>
            </div>
          </div>
          <p className="product-sku-card-heading-copy">
            选一张结构最完整的成品图作为模板，框选要跟随SKU变动的区域，最多支持3个SKU变体区域
          </p>
        </div>
        <div className="product-sku-template-upload-wrap">
          <button
            type="button"
            className="local-redraw-source-upload"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void uploadTemplate(e.dataTransfer.files);
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                if (e.target.files) void uploadTemplate(e.target.files);
                e.target.value = '';
              }}
            />
            {uploading && (
              <span className="pk-dropzone-loading">
                <Spin size="small" />
              </span>
            )}
            {template ? (
              <span className="product-sku-template-thumb">
                <img src={template.url} alt={template.name} loading="lazy" decoding="async" />
                <i
                  role="button"
                  tabIndex={0}
                  aria-label="移除模板图"
                  onClick={(e) => {
                    e.stopPropagation();
                    setTemplate(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') setTemplate(null);
                  }}
                >
                  <X size={12} />
                </i>
              </span>
            ) : (
              <>
                <ImagePlus size={22} />
                <strong>点击或拖拽图片到此处上传</strong>
                <small>点击、拖拽或粘贴图片上传，最多 1 张</small>
              </>
            )}
          </button>
        </div>
      </section>

      {/* 使用步骤 */}
      <section className="product-sku-card product-sku-steps-card">
        <div className="card-title-row">
          <h2>使用步骤</h2>
        </div>
        <ol className="product-sku-steps">
          <li className="product-sku-step">
            <strong>上传模板图</strong>
            <span>导入 SKU 图，作为批量生成的模板图</span>
          </li>
          <li className="product-sku-step">
            <strong>框选要变化的区域</strong>
            <span>框选可变内容区域，精准控制生成范围</span>
          </li>
          <li className="product-sku-step">
            <strong>编辑SKU清单</strong>
            <span>录入商品 SKU 信息，配置每个 SKU 的变化内容</span>
          </li>
          <li className="product-sku-step">
            <strong>批量输出SKU图</strong>
            <span>一键生成多款 SKU 图，高效完成批量出图</span>
          </li>
        </ol>
      </section>

      {/* SKU 清单编辑器 */}
      <section className="product-sku-card product-sku-list-card">
        <div className="card-title-row">
          <h2>SKU 清单</h2>
          <button
            type="button"
            className="pk-text-link"
            onClick={() => setRows((prev) => [...prev, newRow()])}
          >
            <Plus size={12} /> 添加 SKU
          </button>
        </div>
        <p className="product-sku-card-heading-copy">每行一个 SKU：名称 + 颜色 + 变体区域，提交后按行批量生成。</p>
        <div className="product-sku-rows">
          {rows.map((row, idx) => (
            <div key={row.key} className="product-sku-row">
              <div className="product-sku-row-head">
                <strong>SKU {idx + 1}</strong>
                <button
                  type="button"
                  className="pk-text-link"
                  onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}
                  disabled={rows.length <= 1}
                >
                  移除
                </button>
              </div>
              <label className="product-sku-row-field">
                <span>SKU 名称</span>
                <input
                  value={row.name}
                  maxLength={60}
                  placeholder="例如：CLASSIC BLACK / M"
                  onChange={(e) => updateRow(row.key, { name: e.target.value })}
                />
              </label>
              <div className="product-sku-row-field">
                <span>SKU 颜色（{COLOR_LABEL[row.color] ?? row.color}）</span>
                <ColorSwatchGrid
                  options={BG_COLOR_SWATCHES.slice(1)}
                  value={row.color}
                  onChange={(v) => updateRow(row.key, { color: v })}
                  onCustom={() => updateRow(row.key, { color: 'custom' })}
                  customActive={row.color === 'custom'}
                  ariaLabel={`SKU ${idx + 1} 颜色`}
                />
                {row.color === 'custom' && (
                  <CustomColorInput
                    value={row.customColor}
                    onChange={(v) => updateRow(row.key, { customColor: v })}
                    label="自定义颜色（HEX）"
                  />
                )}
              </div>
              <label className="product-sku-row-field">
                <span>变体区域</span>
                <select value={row.region} onChange={(e) => updateRow(row.key, { region: e.target.value })}>
                  {REGION_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ))}
        </div>
      </section>
    </ToolShell>
  );
}
