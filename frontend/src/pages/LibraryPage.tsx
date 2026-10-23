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
import { assetsApi, assetSrc, projectsApi } from '../lib/api';
import { MAX_IMAGE_BYTES, MAX_IMAGE_MB } from '../lib/constants';
import { capabilityName, toolPath } from '../lib/capabilities';
import { useAuth } from '../context/AuthContext';
import { useProject } from '../hooks/useProject';
import { ResultMedia, modalityOfFormat } from '../components/ResultMedia';
import { useCapabilities } from '../hooks/useCapabilities';
import { ToolEmptyIllustration } from '../components/illustrations';
import { StateEmpty, StateError, StateSkeleton } from '../components/StateViews';
import type { Asset, Project } from '../types/api';

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
 * 差异（2026-10-21 B8 收口）:
 *   - 分组改为**客户端真实聚合**（按项目 / 能力 / 日期），不再弹「未实现」提示。
 *     后端没有素材文件夹契约，也不该为此造一个 —— 分组是视图，素材本身没有归属
 *     文件夹的语义；按已有的 projectId / capability / createdAt 聚合，点选即筛选。
 *   - 「来源」筛选用本地真实 kind（全部/原图/生成图）与能力维度
 */

const PAGE_SIZE = 20;
type Kind = 'all' | 'original' | 'generated';
/** 分组依据。'none' = 不分组，只在面板上给切换入口 */
type GroupBy = 'none' | 'project' | 'capability' | 'date';

interface AssetGroup {
  key: string;
  label: string;
  count: number;
  sort: number;
}

/** 日期分组：今天 / 昨天 / 近 7 天 / 更早。按本地时区切日，与作品页的日期筛选同口径 */
function dateBucket(iso: string): { key: string; label: string; sort: number } {
  const ts = new Date(iso).getTime();
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const today = midnight.getTime();
  if (ts >= today) return { key: 'today', label: '今天', sort: 0 };
  if (ts >= today - 86400000) return { key: 'yesterday', label: '昨天', sort: 1 };
  if (ts >= today - 6 * 86400000) return { key: 'week', label: '近 7 天', sort: 2 };
  return { key: 'earlier', label: '更早', sort: 3 };
}

export function LibraryPage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const { token, openLogin } = useAuth();
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
  /** 分组依据与当前选中的分组（null = 全部分组） */
  const [groupBy, setGroupBy] = useState<GroupBy>('none');
  const [groupKey, setGroupKey] = useState<string | null>(null);
  /** 项目名映射：按项目分组时要显示名字，只有 id 的分组没人看得懂 */
  const [projects, setProjects] = useState<Project[]>([]);

  // 项目列表只在真的要按项目分组时拉: 素材页的主路径是看图，不为一个辅助视图多发一次请求
  useEffect(() => {
    if (!token) return;
    if (groupBy !== 'project' || projects.length > 0) return;
    let alive = true;
    projectsApi
      .list()
      .then((list) => {
        if (alive) setProjects(list);
      })
      .catch(() => {
        /* 拉不到项目名就用 id 兜底，不阻断素材浏览 */
      });
    return () => {
      alive = false;
    };
  }, [groupBy, projects.length, token]);

  const load = useCallback(async () => {
    // guest 不发请求: 素材接口要鉴权, 401 会被渲染成「素材加载失败」。
    // 不动 loading: 登录后直接进骨架屏, 不会先闪一下「素材库还是空的」
    if (!token) {
      setItems([]);
      setTotal(0);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = {
        kind: kind === 'all' ? undefined : kind,
        capability: capability === 'all' ? undefined : capability,
        limit: 200,
      };
      const first = await assetsApi.list(params);
      let all = first.items;
      /*
       * 后端单页上限 200, 素材更多时必须继续翻页。
       * 此前只拉一页就结束: 标题按 `total` 显示「共 N 个素材」, 网格与分组统计
       * 却只有前 200 张, 剩下的在界面上永远够不到 —— 三个数各说各话。
       */
      while (all.length < first.total) {
        const next = await assetsApi.list({ ...params, offset: all.length });
        if (next.items.length === 0) break; // 翻页期间素材被删时避免死循环
        all = all.concat(next.items);
      }
      setItems(all);
      setTotal(first.total);
      setVisible(PAGE_SIZE);
    } catch (e) {
      // 保留上一次数据: 刷新失败不该把已看到的素材清空
      setError((e as Error).message || '素材加载失败');
    } finally {
      setLoading(false);
    }
  }, [kind, capability, token]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 单个素材的所属分组（键 / 显示名 / 排序位） */
  const groupOf = useCallback(
    (a: Asset): { key: string; label: string; sort: number } => {
      if (groupBy === 'project') {
        const name = projects.find((p) => p.id === a.projectId)?.name;
        // 项目名还没拉回来时用 id 尾号兜底, 不留空标签
        return { key: a.projectId, label: name ?? `项目 ${a.projectId.slice(-6)}`, sort: 0 };
      }
      if (groupBy === 'capability') {
        if (!a.capability) return { key: '__none', label: '未关联能力', sort: 999 };
        return { key: a.capability, label: capabilityName(a.capability), sort: 0 };
      }
      return dateBucket(a.createdAt);
    },
    [groupBy, projects],
  );

  const groups = useMemo(() => {
    if (groupBy === 'none') return [] as AssetGroup[];
    const map = new Map<string, AssetGroup>();
    for (const a of items) {
      const { key, label, sort } = groupOf(a);
      const hit = map.get(key);
      if (hit) hit.count += 1;
      else map.set(key, { key, label, count: 1, sort });
    }
    return [...map.values()].sort(
      (x, y) => x.sort - y.sort || x.label.localeCompare(y.label, 'zh-CN'),
    );
  }, [items, groupBy, groupOf]);

  // 分组不存在（换了分组依据 / 素材被删）时自动回到「全部」, 不留一个筛不出东西的选中态
  const activeGroup = groups.some((g) => g.key === groupKey) ? groupKey : null;
  const shown = useMemo(
    () => (activeGroup ? items.filter((a) => groupOf(a).key === activeGroup) : items),
    [items, activeGroup, groupOf],
  );

  /*
   * 上传前先自检。此前素材库只按 MIME 过滤, 于是把任意文件改名为 .png 就能
   * "上传成功" —— 卡片是破图、尺寸显示 —×—、体积 12288KB, 还提示
   * 「已上传 1 张素材」。坏图随后会进入生成链路, 而且运营不知道该信哪里的限制。
   *
   * 三道检查: 类型 / 体积 / **能否真正解码**(决定它是不是一张图片)。
   * 体积上限与工具页共用同一个常量, 不再各写一套。
   */
  const upload = async (files: FileList | File[]) => {
    const picked = Array.from(files);
    const list = picked.filter((f) => f.type.startsWith('image/'));
    if (list.length === 0) {
      message.warning('请选择图片文件（PNG / JPG / WebP / GIF）');
      return;
    }
    if (list.length < picked.length) {
      message.warning(`已忽略 ${picked.length - list.length} 个非图片文件`);
    }
    const oversize = list.filter((f) => f.size > MAX_IMAGE_BYTES);
    if (oversize.length > 0) {
      message.error(`单张不超过 ${MAX_IMAGE_MB}MB：${oversize.map((f) => f.name).join('、')}`);
      return;
    }
    const undecodable: string[] = [];
    for (const f of list) {
      try {
        const bitmap = await createImageBitmap(f);
        bitmap.close();
      } catch {
        undecodable.push(f.name);
      }
    }
    if (undecodable.length > 0) {
      message.error(`这些文件不是有效图片：${undecodable.join('、')}`);
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
      const url = assetSrc(a);
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

  /*
   * guest 态: 素材库路由对外开放, 未登录进来时此前会把 401 渲染成
   * 「素材加载失败」, 而且上方还有一个点了没反应的上传按钮。
   */
  if (!token) {
    return (
      <div className="asset-library-page">
        <header className="asset-library-header">
          <div>
            <h1 className="asset-library-title">素材库</h1>
            <p className="asset-library-sub">上传的原图与生成的图片都会在这里统一管理</p>
          </div>
        </header>
        <div className="state-page">
          <StateEmpty
            title="登录后管理你的素材"
            desc="素材与账号绑定，登录后可以上传商品图、查看生成图并批量下载。"
            action={
              <button type="button" className="state-btn is-primary" onClick={openLogin}>
                登录/注册
              </button>
            }
          />
        </div>
      </div>
    );
  }

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

      {/* 分组面板: 客户端按项目 / 能力 / 日期真实聚合, 点选分组即筛选 */}
      <section className="asset-library-groups-panel">
        <div className="asset-library-group-head">
          <strong>素材分组</strong>
          <span>按项目 / 能力 / 日期聚合当前素材，点选即可只看该组</span>
        </div>
        <div className="asset-library-group-list">
          {(
            [
              ['none', '不分组'],
              ['project', '按项目'],
              ['capability', '按能力'],
              ['date', '按日期'],
            ] as [GroupBy, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`asset-library-new-group${groupBy === value ? ' is-active' : ''}`}
              onClick={() => {
                setGroupBy(value);
                setGroupKey(null);
              }}
            >
              {value === 'none' ? <FolderPlus size={14} /> : null}
              {label}
            </button>
          ))}
        </div>
        {groups.length > 0 && (
          <div className="asset-library-group-list">
            <button
              type="button"
              className={`asset-library-group-item${activeGroup === null ? ' is-active' : ''}`}
              onClick={() => setGroupKey(null)}
            >
              全部素材
              <em className="asset-library-group-count">{items.length}</em>
            </button>
            {groups.map((g) => (
              <button
                key={g.key}
                type="button"
                className={`asset-library-group-item${activeGroup === g.key ? ' is-active' : ''}`}
                title={g.label}
                onClick={() => setGroupKey(g.key === activeGroup ? null : g.key)}
              >
                {g.label}
                <em className="asset-library-group-count">{g.count}</em>
              </button>
            ))}
          </div>
        )}
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
      ) : shown.length === 0 ? (
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
            {shown.slice(0, visible).map((a) => {
              const url = assetSrc(a);
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
                      <button
                        type="button"
                        aria-label="在新标签页查看原图"
                        onClick={() => url && window.open(url, '_blank', 'noopener')}
                      >
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
                        <button
                          type="button"
                          className="asset-library-hover-delete"
                          aria-label={`删除素材${a.kind === 'generated' ? '及其作品记录' : ''}`}
                          title="删除素材"
                        >
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

          {visible < shown.length && (
            <button
              type="button"
              className="asset-library-load-more"
              onClick={() => setVisible((v) => v + PAGE_SIZE)}
            >
              加载更多（剩余 {shown.length - visible} 个）
            </button>
          )}
        </>
      )}
    </div>
  );
}
