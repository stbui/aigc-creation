import { useCallback, useEffect, useMemo, useState } from 'react';
import { App, Popconfirm } from 'antd';
import {
  Check,
  Download,
  FolderPlus,
  Loader2,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { assetsApi, toAbsoluteUrl } from '../lib/api';
import { capabilityName, toolPath } from '../lib/capabilities';
import { useProject } from '../hooks/useProject';
import { ResultMedia, modalityOfFormat } from '../components/ResultMedia';
import { useCapabilities } from '../hooks/useCapabilities';
import { ToolEmptyIllustration } from '../components/illustrations';
import { StateError, StateSkeleton } from '../components/StateViews';
import type { Asset } from '../types/api';

/**
 * 素材库 —— 1:1 复刻参考站 `asset-library-*` 版式。
 *
 * 规格来源：参考站**样式产物** `/assets/index-*.css`（未混淆，86 个 `.asset-library-*` 类，
 * 2026-10-17 提取），登录墙不影响读取：
 *   .asset-library-page        padding `24px 24px 56px`, #171A2B, min-height calc(100vh - 64px)
 *   .asset-library-header      flex / space-between / align-items flex-end / gap 24 / mb 22
 *   .asset-library-grid        repeat(5, minmax(0,1fr)) gap 16
 *   .asset-library-card        #fff / border 1px #E4E7EF / radius 14 /
 *                              shadow `0 5px 16px #2A315709` / transition .18s
 *   .asset-library-cover       aspect-ratio 1, #F1F3F8, overflow hidden
 *   .asset-library-card-content padding `12px 13px 13px`
 *   .asset-library-card-title  13px/600 #30364A, ellipsis nowrap, lh 20
 *   .asset-library-card-meta   11px/17 #A0A7B6, flex space-between gap 8, mt 4
 *   .asset-library-card-overlay absolute inset 0 / z3 / opacity 0→1 (.18s) / pointer-events none
 *   .asset-library-check       22x22 / absolute top10 left10 / bg #262B413D / border 2px #FFF /
 *                              radius 7 / shadow `0 1px 4px #1B1F3329`
 *   .asset-library-hover-actions absolute bottom10 left10 right10 / flex gap 7
 *   .asset-library-groups-panel #FFF / border #E5E8F0 / radius 16 / padding `18px 20px` /
 *                              shadow `0 8px 24px #282F5408`
 *   .asset-library-button      h42 / 13px #4F5970 / #FFF / border #DFE3ED / radius 11 / pad `0 15px`
 *   .asset-library-date-filter h42 / 13px #7B8499 / #FFF / border #E1E4ED / radius 11 / pad `0 11px`
 *   .asset-library-load-more   min-height 52 / 12px #8B94A8 / flex center gap 8
 *   .asset-library-empty > strong 14px/16 #333
 *   .asset-library-notice      fixed bottom 28 居中 / #272B48EB / radius 10 / pad `10px 17px`
 *
 * 诚实差异:
 *   - 分组（素材文件夹）本地无对应后端契约 → 保留面板版式并如实提示未接入，不做假分组
 *   - 「来源」筛选用本地真实 kind（全部/原图/生成图）与能力维度
 */

const PAGE_SIZE = 20;
type Kind = 'all' | 'original' | 'generated';

export function LibraryPage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const { ensureProject } = useProject();
  const { data: caps } = useCapabilities();
  const fileRef = useMemo(() => ({ current: null as HTMLInputElement | null }), []);

  const [items, setItems] = useState<Asset[]>([]);
  const [total, setTotal] = useState(0);
  const [kind, setKind] = useState<Kind>('all');
  const [capability, setCapability] = useState('all');
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  /**
   * 加载失败与「素材库为空」必须分开 (2026-10-20 修)。
   * 此前失败只弹 message.error, 随后照样渲染「素材库还是空的」——
   * 用户以为没上传过素材, 真相是接口没连上。
   */
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await assetsApi.list({
        kind: kind === 'all' ? undefined : kind,
        capability: capability === 'all' ? undefined : capability,
        limit: 200,
      });
      setItems(res.items);
      setTotal(res.total);
      setVisible(PAGE_SIZE);
    } catch (e) {
      // 保留上一次数据: 刷新失败不该把已看到的素材清空
      setError((e as Error).message || '素材加载失败');
    } finally {
      setLoading(false);
    }
  }, [kind, capability]);

  useEffect(() => {
    void load();
  }, [load]);

  const upload = async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (list.length === 0) {
      message.warning('请选择图片文件');
      return;
    }
    setUploading(true);
    try {
      const projectId = await ensureProject();
      for (const f of list) await assetsApi.upload(f, projectId);
      message.success(`已上传 ${list.length} 张素材`);
      await load();
    } catch (e) {
      message.error((e as Error).message || '上传失败');
    } finally {
      setUploading(false);
    }
  };

  const remove = async (id: string) => {
    try {
      const res = await assetsApi.remove(id);
      setItems((prev) => prev.filter((a) => a.id !== id));
      setTotal((t) => Math.max(0, t - 1));
      setSelected((prev) => prev.filter((x) => x !== id));
      message.success(res.removedTasks > 0 ? '已删除素材及其作品记录' : '已删除素材');
    } catch (e) {
      message.error((e as Error).message || '删除失败');
    }
  };

  const downloadSelected = () => {
    const list = items.filter((a) => selected.includes(a.id));
    list.forEach((a, i) => {
      const url = toAbsoluteUrl(a.sourceUrl);
      if (!url) return;
      window.setTimeout(() => {
        const el = document.createElement('a');
        el.href = url;
        el.download = `asset-${a.id.slice(-6)}.${a.format === 'png' ? 'png' : 'jpg'}`;
        el.click();
      }, i * 200);
    });
    message.success(`已下载 ${list.length} 张素材`);
  };

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <div className="asset-library-page">
      <header className="asset-library-header">
        <div>
          <h1 className="asset-library-title">素材库</h1>
          <p className="asset-library-sub">
            共 {total} 个素材 · 上传的原图与生成的图片都在这里统一管理
          </p>
        </div>
        <div className="asset-library-header-actions">
          <select
            className="asset-library-date-filter"
            value={kind}
            onChange={(e) => setKind(e.target.value as Kind)}
            aria-label="来源筛选"
          >
            <option value="all">全部来源</option>
            <option value="original">原图</option>
            <option value="generated">生成图</option>
          </select>
          <select
            className="asset-library-button"
            value={capability}
            onChange={(e) => setCapability(e.target.value)}
            aria-label="能力筛选"
          >
            <option value="all">全部能力</option>
            {(caps?.items ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button type="button" className="asset-library-button" onClick={() => void load()}>
            <RefreshCw size={13} /> 刷新
          </button>
          <button
            type="button"
            className="asset-library-button asset-library-button-primary"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? <Loader2 size={13} /> : <Upload size={13} />} 上传素材
          </button>
        </div>
      </header>

      {/* 分组面板: 参考站有素材文件夹分组, 本地后端无该契约 → 保留版式并如实说明 */}
      <section className="asset-library-groups-panel">
        <div className="asset-library-group-head">
          <strong>素材分组</strong>
          <span>按文件夹批量整理素材</span>
        </div>
        <div className="asset-library-group-list">
          <span className="asset-library-group-item">全部素材</span>
          <button
            type="button"
            className="asset-library-new-group"
            onClick={() => message.info('本地演示未实现素材分组（后端无分组契约），可先按来源与能力筛选')}
          >
            <FolderPlus size={14} /> 新建分组
          </button>
        </div>
      </section>

      {/* 批量操作条（选中后出现） */}
      {selected.length > 0 && (
        <div className="asset-library-batch-bar">
          <span>已选 {selected.length} 个素材</span>
          <button type="button" onClick={downloadSelected}>
            <Download size={12} /> 下载所选
          </button>
          <button
            type="button"
            className="asset-library-batch-cancel"
            onClick={() => setSelected([])}
          >
            取消选择
          </button>
        </div>
      )}

      <input
        ref={(el) => {
          fileRef.current = el;
        }}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) void upload(e.target.files);
          e.target.value = '';
        }}
      />

      {loading ? (
        /* 骨架屏占住 5 列卡片网格的形状, 内容到达时零位移 */
        <StateSkeleton variant="card" count={10} columns={5} />
      ) : error ? (
        /* 「没连上」不是「没素材」 */
        <StateError
          title="素材加载失败"
          desc="没能取回素材列表。可能是后端未启动或网络异常，重试一次即可。"
          detail={error}
          onRetry={() => void load()}
        />
      ) : items.length === 0 ? (
        <div className="asset-library-empty">
          {/* 参考站空态 = 160×160 插画 + strong + span（实测 160px yqempty-*.svg）。
              本地不引参考站图片资源, 复用工具页同一张内联 SVG (ToolEmptyIllustration,
              与 pk/vc/fc 同款), 文案保留本地产品语义。2026-10-19 */}
          <ToolEmptyIllustration />
          <strong>素材库还是空的</strong>
          <span>上传商品图或完成一次生成后，素材会出现在这里</span>
          <button type="button" className="asset-library-button" onClick={() => fileRef.current?.click()}>
            <Upload size={13} /> 上传第一张
          </button>
        </div>
      ) : (
        <>
          <div className="asset-library-grid">
            {items.slice(0, visible).map((a) => {
              const url = toAbsoluteUrl(a.sourceUrl);
              const isSel = selected.includes(a.id);
              return (
                <article
                  key={a.id}
                  className={`asset-library-card${isSel ? ' is-selected' : ''}${
                    selected.length > 0 ? ' is-selection-mode' : ''
                  }`}
                >
                  <div className="asset-library-cover">
                    {url && (
                      <ResultMedia
                        url={url}
                        modality={modalityOfFormat(a.format)}
                        alt={a.sourceUrl}
                      />
                    )}
                    <span className="asset-library-card-overlay" />
                    <button
                      type="button"
                      className={`asset-library-check${isSel ? ' on' : ''}`}
                      aria-label={isSel ? '取消选择' : '选择该素材'}
                      onClick={() => toggle(a.id)}
                    >
                      {isSel && <Check size={13} />}
                    </button>
                    <div className="asset-library-hover-actions">
                      <button type="button" onClick={() => url && window.open(url, '_blank', 'noopener')}>
                        <Download size={12} /> 查看
                      </button>
                      {a.kind === 'generated' && a.capability && (
                        <button
                          type="button"
                          onClick={() => navigate(toolPath(a.capability as string))}
                        >
                          再做一张
                        </button>
                      )}
                      <Popconfirm
                        title="删除该素材？"
                        description={
                          a.kind === 'generated' ? '会连带删除产出它的作品记录' : '历史作品与结果会保留'
                        }
                        okText="删除"
                        cancelText="取消"
                        okButtonProps={{ danger: true }}
                        onConfirm={() => void remove(a.id)}
                      >
                        <button type="button" className="asset-library-hover-delete">
                          <Trash2 size={12} />
                        </button>
                      </Popconfirm>
                    </div>
                  </div>
                  <div className="asset-library-card-content">
                    <span className="asset-library-card-title">
                      {a.kind === 'generated' ? capabilityName(a.capability) : '原图素材'}
                    </span>
                    <span className="asset-library-card-meta">
                      <span>
                        {a.width ?? '—'}×{a.height ?? '—'} · {(a.sizeBytes / 1024).toFixed(0)}KB
                      </span>
                      <span>{a.kind === 'generated' ? '生成图' : '原图'}</span>
                    </span>
                  </div>
                </article>
              );
            })}
          </div>

          {visible < items.length && (
            <button
              type="button"
              className="asset-library-load-more"
              onClick={() => setVisible((v) => v + PAGE_SIZE)}
            >
              加载更多（剩余 {items.length - visible} 个）
            </button>
          )}
        </>
      )}
    </div>
  );
}
