import { useCallback, useEffect, useRef, useState } from 'react';
import { App, Drawer } from 'antd';
import { ChevronRight, ChevronUp, Circle, Eraser, Hand, History, ImagePlus, Maximize2, Minus, Paintbrush, Plus, Redo2, RotateCcw, Square, Undo2, X } from 'lucide-react';
import { useToolTask } from '../hooks/useToolTask';
import { useProject } from '../hooks/useProject';
import { useAuth } from '../context/AuthContext';
import { assetsApi, assetSrc, generateApi } from '../lib/api';
import { ExpandTextModal, ToolShell, type ToolAsset } from '../components/ToolShell';
import { ToolCard } from '../components/ToolWidgets';
import { ToolHistoryGrid } from '../components/ToolHistoryPane';
import { LocalRedrawIllustration } from '../components/illustrations';

/**
 * 局部重绘 —— 1:1 复刻参考站 https://ijihua.cn/local-redraw。
 *
 * ## 画布交互 (2026-10-25 重构)
 *
 * 工具: 抓手 (平移) / 画笔 (涂抹重绘区) / 橡皮 (擦除涂抹) / 框选 / 圈选。
 * 额外能力: 缩放 (按钮 ±) / 撤回 / 恢复 / 清空。
 *
 * 笔迹用**矢量标记**保存 (不是落成不可逆的位图)：
 *   - brush/eraser → 一串采样点
 *   - rect/ellipse → 归一化矩形
 * 渲染时重放整份标记列表 → 生成可见叠层与黑白遮罩。因此撤回/恢复/清空
 * 只是增删数组元素并重放，不需要保存 4K ImageData 快照。
 *
 * ## 遮罩怎么走 (仍沿用 2026-10-22 的协议)
 *
 * 所有标记合成一张 PNG：透明区 = 要重绘的区域 (OpenAI `images/edits` 约定)，
 * 上传成素材后随 `maskAssetId` 提交。后端对不支持遮罩的通道判 `42205` 退款。
 *
 * 诚实披露: local_redraw 必须由真实 inpainting 模型完成, 本地没有实现；
 * 没有可用通道时后端判 failed/42204 并退款，本页据 runtime 提前禁用提交。
 */

type PaintTool = 'hand' | 'brush' | 'eraser' | 'rect' | 'ellipse';

/** 页面只有 3 条描述位，遮罩也必须与之一致，不能多圈区域却没有描述。 */
const MAX_ANNOTATIONS = 3;

const TOOLS: { value: PaintTool; label: string; shortcut: string; icon: typeof Hand }[] = [
  { value: 'hand', label: '抓手', shortcut: 'H', icon: Hand },
  { value: 'eraser', label: '擦除', shortcut: 'E', icon: Eraser },
  { value: 'rect', label: '框选', shortcut: 'R', icon: Square },
  { value: 'ellipse', label: '圈选', shortcut: 'O', icon: Circle },
  { value: 'brush', label: '涂抹', shortcut: 'B', icon: Paintbrush },
];

type StrokeTool = 'brush' | 'eraser';
type ShapeTool = 'rect' | 'ellipse';

/** 矢量标记：一笔涂抹 / 一个框选区域。坐标均为原图像素坐标。 */
interface StrokeMark {
  kind: 'stroke';
  tool: StrokeTool;
  points: { x: number; y: number }[];
  /** 笔刷宽度（原图像素） */
  width: number;
}
interface ShapeMark {
  kind: 'shape';
  tool: ShapeTool;
  x: number;
  y: number;
  width: number;
  height: number;
}
type Mark = StrokeMark | ShapeMark;

/** 一个可描述区域在原图上的包围盒（像素坐标） */
interface RegionBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
}

/** 只有画笔涂抹和框选/圈选算可描述区域，橡皮只是修正遮罩 */
function isRegionMark(mark: Mark): boolean {
  return mark.kind === 'shape' || (mark.kind === 'stroke' && mark.tool === 'brush');
}

/** 画布对外的动作 */
interface MaskPainterHandle {
  toBlob: () => Promise<Blob | null>;
  clear: () => void;
  undo: () => void;
  redo: () => void;
  getRegionCount: () => number;
  getRegionBounds: () => RegionBounds[];
  removeRegion: (index: number) => void;
}

/** 从 CSS 变量取品牌色，避免在画布代码里写死十六进制 */
function brandColor(): string {
  return getComputedStyle(document.documentElement).getPropertyValue('--brand').trim() || '#5b4df5';
}

/**
 * 遮罩画布。
 *
 * 结构是「img 底图 + 叠层画布」，叠层只画品牌色预览，离屏遮罩画布负责导出。
 * 底图不进 canvas —— 画进 canvas 后擦除会把底图一起擦掉，用户会看到白底。
 */
function MaskPainter({
  url,
  tool,
  brush,
  zoom,
  pan,
  maxRegions,
  onPanChange,
  onRegionLimit,
  onChange,
  handleRef,
}: {
  url: string;
  tool: PaintTool;
  brush: number;
  zoom: number;
  pan: { x: number; y: number };
  maxRegions: number;
  onPanChange: (pan: { x: number; y: number }) => void;
  onRegionLimit: () => void;
  /** 有可提交的涂抹 / 可撤回 / 可恢复 / 当前标注区域数 */
  onChange: (painted: boolean, canUndo: boolean, canRedo: boolean, regionCount: number) => void;
  handleRef: { current: MaskPainterHandle | null };
}) {
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const maskRef = useRef<HTMLCanvasElement | null>(null);
  const transformRef = useRef<HTMLDivElement | null>(null);

  const marksRef = useRef<Mark[]>([]);
  const redoRef = useRef<Mark[]>([]);
  const draftRef = useRef<Mark | null>(null);
  const shapeStartRef = useRef<{ x: number; y: number } | null>(null);
  const panStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const naturalRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });

  /**
   * 当前笔刷在原图像素下的线宽。
   *
   * 画布内部是原图尺寸、外部再乘 zoom，所以这里要先除以 zoom：
   * 否则 140% 时同一档笔刷会变得比 100% 粗 40%，用户看到的大小与滑块数字脱节。
   */
  const lineWidth = useCallback(() => {
    const w = naturalRef.current.w;
    const displayWidth = transformRef.current?.offsetWidth || 1;
    const scale = Math.max(zoom / 100, 0.01);
    return Math.max(2, (brush * (w / Math.max(displayWidth, 1))) / scale);
  }, [brush, zoom]);

  const pointOf = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = e.currentTarget;
    const rect = c.getBoundingClientRect();
    // 画布内部分辨率是原图尺寸，显示尺寸带缩放 —— 必须换算，否则笔迹错位
    return {
      x: (e.clientX - rect.left) * (c.width / Math.max(rect.width, 1)),
      y: (e.clientY - rect.top) * (c.height / Math.max(rect.height, 1)),
    };
  };

  const drawMark = useCallback((octx: CanvasRenderingContext2D, mctx: CanvasRenderingContext2D, mark: Mark) => {
    const brand = brandColor();
    if (mark.kind === 'stroke') {
      const points = mark.points;
      if (points.length === 0) return;
      const stroke = (ctx: CanvasRenderingContext2D) => {
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
        ctx.stroke();
      };
      // 叠层：画笔画半透明品牌色，橡皮擦掉颜色（底图仍在下面）
      octx.save();
      octx.lineCap = 'round';
      octx.lineJoin = 'round';
      octx.lineWidth = mark.width;
      if (mark.tool === 'brush') {
        octx.globalCompositeOperation = 'source-over';
        octx.globalAlpha = 0.45;
        octx.strokeStyle = brand;
      } else {
        octx.globalCompositeOperation = 'destination-out';
        octx.globalAlpha = 1;
        octx.strokeStyle = 'black';
      }
      stroke(octx);
      octx.restore();

      // 遮罩：画笔擦成透明（重绘区），橡皮涂回白色
      mctx.save();
      mctx.lineCap = 'round';
      mctx.lineJoin = 'round';
      mctx.lineWidth = mark.width;
      mctx.globalAlpha = 1;
      if (mark.tool === 'brush') {
        mctx.globalCompositeOperation = 'destination-out';
        mctx.strokeStyle = 'black';
      } else {
        mctx.globalCompositeOperation = 'source-over';
        mctx.strokeStyle = 'white';
      }
      stroke(mctx);
      mctx.restore();
      return;
    }

    // 形状：叠层画品牌色填充 + 描边，遮罩 destination-out 填充
    octx.save();
    octx.fillStyle = brand;
    octx.globalAlpha = 0.4;
    if (mark.tool === 'rect') octx.fillRect(mark.x, mark.y, mark.width, mark.height);
    else {
      octx.beginPath();
      octx.ellipse(mark.x + mark.width / 2, mark.y + mark.height / 2, Math.abs(mark.width) / 2, Math.abs(mark.height) / 2, 0, 0, Math.PI * 2);
      octx.fill();
    }
    octx.globalAlpha = 0.9;
    octx.lineWidth = 2;
    if (mark.tool === 'rect') octx.strokeRect(mark.x, mark.y, mark.width, mark.height);
    else {
      octx.beginPath();
      octx.ellipse(mark.x + mark.width / 2, mark.y + mark.height / 2, Math.abs(mark.width) / 2, Math.abs(mark.height) / 2, 0, 0, Math.PI * 2);
      octx.stroke();
    }
    octx.restore();

    mctx.save();
    mctx.globalCompositeOperation = 'destination-out';
    mctx.fillStyle = 'black';
    if (mark.tool === 'rect') mctx.fillRect(mark.x, mark.y, mark.width, mark.height);
    else {
      mctx.beginPath();
      mctx.ellipse(mark.x + mark.width / 2, mark.y + mark.height / 2, Math.abs(mark.width) / 2, Math.abs(mark.height) / 2, 0, 0, Math.PI * 2);
      mctx.fill();
    }
    mctx.restore();
  }, []);

  const render = useCallback(
    (draft?: Mark | null) => {
      const overlay = overlayRef.current;
      const mask = maskRef.current;
      if (!overlay || !mask) return;
      const octx = overlay.getContext('2d');
      const mctx = mask.getContext('2d');
      if (!octx || !mctx) return;

      octx.clearRect(0, 0, overlay.width, overlay.height);
      mctx.globalCompositeOperation = 'source-over';
      mctx.globalAlpha = 1;
      mctx.fillStyle = 'white';
      mctx.fillRect(0, 0, mask.width, mask.height);

      for (const mark of marksRef.current) drawMark(octx, mctx, mark);
      if (draft) drawMark(octx, mctx, draft);
    },
    [drawMark],
  );

  /** 在 64×64 缩略图上数透明像素，避免为 4K 遮罩逐像素扫描 */
  const hasPaint = useCallback((): boolean => {
    const mask = maskRef.current;
    if (!mask || mask.width === 0) return false;
    const probe = document.createElement('canvas');
    probe.width = 64;
    probe.height = 64;
    const pctx = probe.getContext('2d');
    if (!pctx) return false;
    pctx.drawImage(mask, 0, 0, 64, 64);
    const data = pctx.getImageData(0, 0, 64, 64).data;
    let transparent = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] < 128) transparent += 1;
    return transparent >= 4;
  }, []);

  /**
   * 可独立描述的重绘区域数。橡皮只是修正遮罩, 不创建新区域;
   * 框选/圈选与每一段涂抹都算一个区域。
   */
  const getRegionCount = useCallback((): number => {
    return marksRef.current.filter(isRegionMark).length;
  }, []);

  /** 每个可描述区域在原图上的包围盒，供标注卡显示区域缩略图 */
  const getRegionBounds = useCallback((): RegionBounds[] => {
    return marksRef.current.filter(isRegionMark).map((mark) => {
      if (mark.kind === 'shape') {
        return {
          x: mark.x,
          y: mark.y,
          width: mark.width,
          height: mark.height,
          sourceWidth: naturalRef.current.w,
          sourceHeight: naturalRef.current.h,
        };
      }
      const points = mark.points;
      const minX = Math.min(...points.map((p) => p.x));
      const maxX = Math.max(...points.map((p) => p.x));
      const minY = Math.min(...points.map((p) => p.y));
      const maxY = Math.max(...points.map((p) => p.y));
      const pad = mark.width / 2;
      return {
        x: Math.max(0, minX - pad),
        y: Math.max(0, minY - pad),
        width: maxX - minX + mark.width,
        height: maxY - minY + mark.width,
        sourceWidth: naturalRef.current.w,
        sourceHeight: naturalRef.current.h,
      };
    });
  }, []);

  const notify = useCallback(() => {
    onChange(hasPaint(), marksRef.current.length > 0, redoRef.current.length > 0, getRegionCount());
  }, [getRegionCount, hasPaint, onChange]);

  /** 删除第 index 个可描述区域（同时让标注卡少一条） */
  const removeRegion = useCallback((index: number) => {
    const regionMarks = marksRef.current.filter(isRegionMark);
    const target = regionMarks[index];
    if (!target) return;
    marksRef.current = marksRef.current.filter((mark) => mark !== target);
    redoRef.current = [];
    draftRef.current = null;
    shapeStartRef.current = null;
    render();
    notify();
  }, [notify, render]);

  const setup = useCallback(
    (w: number, h: number) => {
      const overlay = overlayRef.current;
      const mask = maskRef.current;
      if (!overlay || !mask || w <= 0 || h <= 0) return;
      naturalRef.current = { w, h };
      overlay.width = w;
      overlay.height = h;
      mask.width = w;
      mask.height = h;
      marksRef.current = [];
      redoRef.current = [];
      draftRef.current = null;
      shapeStartRef.current = null;
      render();
      notify();
    },
    [notify, render],
  );

  const commit = useCallback(
    (mark: Mark) => {
      if (isRegionMark(mark) && getRegionCount() >= maxRegions) {
        draftRef.current = null;
        shapeStartRef.current = null;
        render();
        notify();
        onRegionLimit();
        return;
      }
      marksRef.current = [...marksRef.current, mark];
      redoRef.current = [];
      draftRef.current = null;
      shapeStartRef.current = null;
      render();
      notify();
    },
    [getRegionCount, maxRegions, notify, onRegionLimit, render],
  );

  const undo = useCallback(() => {
    const last = marksRef.current[marksRef.current.length - 1];
    if (!last) return;
    marksRef.current = marksRef.current.slice(0, -1);
    redoRef.current = [...redoRef.current, last];
    render();
    notify();
  }, [notify, render]);

  const redo = useCallback(() => {
    const next = redoRef.current[redoRef.current.length - 1];
    if (!next) return;
    redoRef.current = redoRef.current.slice(0, -1);
    marksRef.current = [...marksRef.current, next];
    render();
    notify();
  }, [notify, render]);

  const clear = useCallback(() => {
    marksRef.current = [];
    redoRef.current = [];
    draftRef.current = null;
    shapeStartRef.current = null;
    render();
    notify();
  }, [notify, render]);

  const toBlob = useCallback((): Promise<Blob | null> => {
    const mask = maskRef.current;
    if (!mask || mask.width === 0 || !hasPaint()) return Promise.resolve(null);
    return new Promise<Blob | null>((resolve) => mask.toBlob((b) => resolve(b), 'image/png'));
  }, [hasPaint]);

  useEffect(() => {
    handleRef.current = { toBlob, clear, undo, redo, getRegionCount, getRegionBounds, removeRegion };
    return () => {
      handleRef.current = null;
    };
  }, [clear, getRegionCount, getRegionBounds, handleRef, redo, removeRegion, toBlob, undo]);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    if (tool === 'hand') {
      panStartRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
      return;
    }
    const p = pointOf(e);
    if (tool === 'brush' || tool === 'eraser') {
      draftRef.current = { kind: 'stroke', tool, points: [p], width: lineWidth() };
      render(draftRef.current);
      return;
    }
    shapeStartRef.current = p;
    draftRef.current = { kind: 'shape', tool, x: p.x, y: p.y, width: 0, height: 0 };
    render(draftRef.current);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (tool === 'hand' && panStartRef.current) {
      onPanChange({
        x: panStartRef.current.panX + e.clientX - panStartRef.current.x,
        y: panStartRef.current.panY + e.clientY - panStartRef.current.y,
      });
      return;
    }
    const draft = draftRef.current;
    if (!draft) return;
    const p = pointOf(e);
    if (draft.kind === 'stroke') {
      draft.points = [...draft.points, p];
    } else if (shapeStartRef.current) {
      draft.x = Math.min(shapeStartRef.current.x, p.x);
      draft.y = Math.min(shapeStartRef.current.y, p.y);
      draft.width = Math.abs(p.x - shapeStartRef.current.x);
      draft.height = Math.abs(p.y - shapeStartRef.current.y);
    }
    render(draft);
  };

  const onPointerUp = () => {
    panStartRef.current = null;
    const draft = draftRef.current;
    if (!draft) return;
    if (draft.kind === 'stroke') {
      if (draft.points.length > 0) commit(draft);
      else {
        draftRef.current = null;
        render();
        notify();
      }
      return;
    }
    // 过小的框选视为误触，不提交
    if (draft.width >= 4 || draft.height >= 4) commit(draft);
    else {
      draftRef.current = null;
      shapeStartRef.current = null;
      render();
      notify();
    }
  };

  const onPointerCancel = () => {
    panStartRef.current = null;
    draftRef.current = null;
    shapeStartRef.current = null;
    render();
    notify();
  };

  return (
    <div className="redraw-mask-stage">
      <div
        ref={transformRef}
        className="redraw-mask-transform"
        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom / 100})` }}
      >
        <img
          className="redraw-mask-bg"
          src={url}
          alt="待重绘的原图"
          onLoad={(e) => setup(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
        />
        <canvas
          ref={overlayRef}
          className={`redraw-mask-overlay tool-${tool}`}
          aria-label="在图上涂抹、框选或圈选要重绘的区域"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
        />
      </div>
      {/* 离屏遮罩：只用于导出，不显示 */}
      <canvas ref={maskRef} className="redraw-mask-hidden" aria-hidden="true" />
    </div>
  );
}

export function LocalRedrawPage() {
  const { message } = App.useApp();
  const { ensureProject } = useProject();
  const { submitting, result, setResult, run } = useToolTask({ capability: 'local_redraw', successMessage: '重绘结果已生成' });

  const [tool, setTool] = useState<PaintTool>('brush');
  const [brush, setBrush] = useState(30);
  const [zoom, setZoom] = useState(100);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [painted, setPainted] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [regionCount, setRegionCount] = useState(0);
  const [regionBounds, setRegionBounds] = useState<RegionBounds[]>([]);
  /** 最多 3 条标注描述，与参考站一致 */
  const [prompts, setPrompts] = useState<string[]>(['', '', '']);
  const [expandIndex, setExpandIndex] = useState<number | null>(null);
  /** 遮罩上传期间也要禁用按钮 —— 否则连点会传两份遮罩 */
  const [preparing, setPreparing] = useState(false);
  /** 每条标注可选上传的参考图 */
  const [references, setReferences] = useState<Array<ToolAsset | null>>([null, null, null]);
  /**
   * 正在上传参考图的下标集合。
   *
   * 用集合而不是单个下标: 用户可能连着触发两条标注的上传，若只存一个值，
   * 先完成的请求会把状态提前清空，后一条还在上传时按钮又变成可提交。
   */
  const [referenceUploading, setReferenceUploading] = useState<Set<number>>(() => new Set());
  const uploadBusy = referenceUploading.size > 0;
  /** 历史抽屉 */
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<Awaited<ReturnType<typeof generateApi.list>>>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyReload, setHistoryReload] = useState(0);
  /** 桌面右栏折叠; 窄屏本来就不显示右栏, 改用浮动按钮打开抽屉 */
  const [historyCollapsed, setHistoryCollapsed] = useState(false);
  const [sourceImage, setSourceImage] = useState<ToolAsset | null>(null);
  const painter = useRef<MaskPainterHandle | null>(null);
  const referenceInputs = useRef<Record<number, HTMLInputElement | null>>({});
  /*
   * 提交后结果态会卸载标注画布，painter 也随之清空。「重新生成」必须复用
   * 上一次的遮罩快照，否则会误报「请先标注」；同一张源图且遮罩未改时也
   * 复用已上传的素材，避免每次重试都新传一份 PNG。
   */
  const maskBlobRef = useRef<Blob | null>(null);
  const maskAssetIdRef = useRef<string | null>(null);
  const maskSourceIdRef = useRef<string | null>(null);
  const { token } = useAuth();

  const setPromptAt = (index: number, value: string) =>
    setPrompts((prev) => prev.map((p, i) => (i === index ? value : p)));

  const uploadReference = async (index: number, file: File | undefined) => {
    if (!file) return;
    try {
      setReferenceUploading((prev) => new Set(prev).add(index));
      const projectId = await ensureProject();
      const asset = await assetsApi.upload(file, projectId);
      setReferences((prev) => prev.map((item, i) => (i === index ? { id: asset.id, url: assetSrc(asset) ?? '', name: file.name } : item)));
    } catch (e) {
      message.error((e as Error).message || '参考图上传失败，请重试');
    } finally {
      setReferenceUploading((prev) => {
        const next = new Set(prev);
        next.delete(index);
        return next;
      });
    }
  };

  // 历史记录以任务为准；生成完成后刷新一次，首次挂载若有登录态也拉一次。
  useEffect(() => {
    if (!token) {
      setHistory([]);
      setHistoryLoading(false);
      return;
    }
    let cancelled = false;
    setHistoryLoading(true);
    setHistoryError(null);
    void generateApi
      .list()
      .then((items) => {
        if (cancelled) return;
        setHistory(
          items
            .filter((task) => task.capability === 'local_redraw' && task.status === 'succeeded' && task.outputAsset)
            .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
            .slice(0, 20),
        );
      })
      .catch((e) => {
        if (!cancelled) {
          setHistory([]);
          setHistoryError((e as Error).message || '历史记录加载失败');
        }
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, result, historyReload]);

  /** 清掉当前图的遮罩、笔迹状态与结果；源图本身由上传位管理。 */
  const clearMaskSession = () => {
    maskBlobRef.current = null;
    maskAssetIdRef.current = null;
    maskSourceIdRef.current = null;
    setPainted(false);
    setCanUndo(false);
    setCanRedo(false);
    setRegionCount(0);
    setRegionBounds([]);
    setZoom(100);
    setPan({ x: 0, y: 0 });
    setResult(null);
  };

  /**
   * 结果态会卸载标注画布，因此失败后也必须给用户一个回到画布的入口；
   * 只保留「重新生成」会让一次失败变成无法调整标注的死路。
   */
  const handleReannotation = () => {
    clearMaskSession();
  };

  /**
   * 历史结果回填后清掉上一轮结果态、遮罩缓存与旧标注。
   *
   * ToolShell 会先把历史产出复制成当前项目的新素材；MaskPainter 因 URL
   * 变化自动重置笔迹。这里把页面级引用和描述一起清掉，避免把上一张图的
   * 区域描述与参考图带到新素材上。
   */
  const handleHistoryReuse = () => {
    clearMaskSession();
    setPrompts(['', '', '']);
    setReferences([null, null, null]);
    setSourceImage(null);
    setHistoryOpen(false);
  };

  const historyPane = (
    <>
      <aside className="redraw-history-pane" aria-label="局部重绘历史记录">
        <div className="redraw-history-head">
          <h2>历史记录</h2>
          <button
            type="button"
            className="redraw-history-collapse"
            aria-label={historyCollapsed ? '展开历史记录' : '收起历史记录'}
            aria-expanded={!historyCollapsed}
            title={historyCollapsed ? '展开历史记录' : '收起历史记录'}
            onClick={() => setHistoryCollapsed((value) => !value)}
          >
            {historyCollapsed ? <ChevronRight size={16} /> : <ChevronUp size={16} />}
          </button>
        </div>
        <div className="redraw-history-scroll">
          <ToolHistoryGrid
            tasks={history}
            loading={historyLoading}
            error={historyError}
            emptyText="暂无局部重绘记录"
            onRetry={() => setHistoryReload((value) => value + 1)}
          />
        </div>
      </aside>

      <button
        type="button"
        className="redraw-history-float-toggle"
        aria-label="历史记录"
        title="历史记录"
        onClick={() => {
          // 桌面端右栏收起后，浮动按钮把右栏展开；窄屏没有右栏，改用抽屉。
          if (window.matchMedia('(max-width: 1180px)').matches) setHistoryOpen(true);
          else setHistoryCollapsed(false);
        }}
      >
        <History size={16} />
      </button>

      <Drawer
        title="历史记录"
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        size={320}
        styles={{ body: { padding: 12 } }}
      >
        <ToolHistoryGrid
          tasks={history}
          loading={historyLoading}
          error={historyError}
          emptyText="暂无局部重绘记录"
          onRetry={() => setHistoryReload((value) => value + 1)}
        />
      </Drawer>
    </>
  );

  const handlePaintState = useCallback(
    (isPainted: boolean, undoable: boolean, redoable: boolean, regions: number) => {
      setPainted(isPainted);
      setCanUndo(undoable);
      setCanRedo(redoable);
      setRegionCount(regions);
      setRegionBounds(painter.current?.getRegionBounds() ?? []);
    },
    [],
  );

  const removeAnnotationAt = (index: number) => {
    if (uploadBusy) {
      message.warning('参考图上传中，请稍候再删除标注');
      return;
    }
    painter.current?.removeRegion(index);
    setPrompts((prev) => [...prev.filter((_, i) => i !== index), '']);
    setReferences((prev) => [...prev.filter((_, i) => i !== index), null]);
  };

  const markPreviewStyle = (bounds: RegionBounds, box = 64): React.CSSProperties => {
    const scale = Math.max(bounds.width / box, bounds.height / box);
    return {
      position: 'absolute',
      left: `${(-bounds.x / scale / box) * 100}%`,
      top: `${(-bounds.y / scale / box) * 100}%`,
      width: `${(bounds.sourceWidth / scale / box) * 100}%`,
      height: `${(bounds.sourceHeight / scale / box) * 100}%`,
    };
  };

  // 快捷键：H/B/E/R/O 切工具，Ctrl+Z 撤回，Ctrl+Shift+Z 恢复，+/- 缩放
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) painter.current?.redo();
        else painter.current?.undo();
        return;
      }
      if (e.key === '+' || e.key === '=') {
        setZoom((z) => Math.min(140, z + 10));
        return;
      }
      if (e.key === '-') {
        setZoom((z) => Math.max(70, z - 10));
        return;
      }
      const toolKey = TOOLS.find((t) => t.shortcut.toLowerCase() === e.key.toLowerCase());
      if (toolKey) setTool(toolKey.value);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const submit = async (inputs: ToolAsset[], settings: { ratio: string; resolution: string }) => {
    if (uploadBusy) {
      message.warning('参考图上传中，请稍候再提交');
      return;
    }
    setSourceImage(inputs[0] ?? null);
    const sourceId = inputs[0]?.id ?? null;
    if (maskSourceIdRef.current !== sourceId) {
      maskBlobRef.current = null;
      maskAssetIdRef.current = null;
      maskSourceIdRef.current = sourceId;
    }
    let maskAssetId: string | undefined;
    try {
      setPreparing(true);
      const freshBlob = await painter.current?.toBlob();
      const blob = freshBlob ?? maskBlobRef.current;
      if (!blob) {
        message.warning('请先在图片上标注需要重绘的区域');
        return;
      }
      if (freshBlob) {
        maskBlobRef.current = freshBlob;
        maskAssetIdRef.current = null;
      }
      if (!maskAssetIdRef.current) {
        const projectId = await ensureProject();
        const file = new File([blob], `mask-${Date.now()}.png`, { type: 'image/png' });
        const asset = await assetsApi.upload(file, projectId);
        maskAssetIdRef.current = asset.id;
      }
      maskAssetId = maskAssetIdRef.current;
    } catch (e) {
      message.error((e as Error).message || '遮罩上传失败，请重试');
      return;
    } finally {
      setPreparing(false);
    }

    const annotationCount = Math.max(1, Math.min(MAX_ANNOTATIONS, regionCount));
    const annotations = prompts
      .slice(0, annotationCount)
      .map((p, i) => ({
        annotationId: String(i + 1),
        label: `标注${i + 1}`,
        instruction: p.trim(),
        referenceAssetId: references[i]?.id ?? null,
      }))
      .filter((item) => item.instruction);
    const parts = annotations.map((item) => `${item.label}：${item.instruction}`);
    await run(inputs, {
      prompt: parts.join('；'),
      annotations: JSON.stringify(annotations),
      modelGuideAssetId: maskAssetId,
      strength: Math.min(1, Math.max(0, brush / 60)),
      ratio: settings.ratio,
      size: settings.resolution,
      ...(settings.ratio !== 'original' ? { imageRatio: settings.ratio } : {}),
      ...(maskAssetId ? { maskAssetId } : {}),
      outputCount: 1,
    });
  };

  const currentResult = Array.isArray(result) ? result[0] : result;
  const resultUrl = currentResult?.status === 'succeeded' ? currentResult.url : undefined;
  /** 与参考站一致: 未标注时只给一条描述位; 标注后按区域数展开, 最多 3 条 */
  const visiblePromptCount = Math.max(1, Math.min(MAX_ANNOTATIONS, regionCount));
  const filledCount = prompts.slice(0, visiblePromptCount).filter((p) => p.trim()).length;

  return (
    <>
    <ToolShell
      capability="local_redraw"
      pageClass={`local-redraw-page${historyCollapsed ? ' history-collapsed' : ''}`}
      title="局部重绘"
      desc="只想修改局部？圈出来写描述就行，适合去掉瑕疵、更换图案、修改画面中的元素"
      upload={{ title: '上传图片', required: true, max: 1, hint: '点击、拖拽或粘贴图片上传，最多 1 张' }}
      settings={{ ratio: true, resolution: true }}
      submitLabel="开始重绘"
      emptyDesc="上传图片并标注区域、写下描述后，重绘结果将在此处展示"
      formValid={painted && filledCount > 0 && !uploadBusy && !preparing}
      /*
       * uploadBusy 只通过 formValid 禁用提交，不能并入 submitting：ToolShell 在
       * submitting 时会用生成态替换 sourcePane，画布会被卸载，参考图上传完成
       * 后重建并清空刚画好的遮罩。遮罩上传也只通过 formValid 阻止重复提交，
       * 不切换生成态 —— 上传失败时用户仍保留画布上的笔迹，可直接重试。
       */
      submitting={submitting}
      result={result}
      resultTag={painted ? '已标注区域' : undefined}
      resultCompare={resultUrl && sourceImage ? { beforeUrl: sourceImage.url, beforeLabel: '原图', afterLabel: '重绘后' } : undefined}
      onHistoryReuse={handleHistoryReuse}
      onSubmit={(inputs, settings) => submit(inputs, settings)}
      resultActions={
        result ? (
          <button type="button" className="tool-result-action" onClick={handleReannotation}>
            重新标注
          </button>
        ) : null
      }
      trailingPane={historyPane}
      sourcePane={(images) => {
        const image = images[0];
        if (!image) {
          return (
            <div className="redraw-intro">
              <div className="redraw-intro-art" aria-hidden="true">
                <LocalRedrawIllustration />
              </div>
              <div className="redraw-intro-copy">
                <strong>局部重绘</strong>
                <p>只想修改局部？圈出来写描述就行，适合去掉瑕疵、更换图案、修改画面中的元素</p>
              </div>
            </div>
          );
        }
        const renderToolButton = (value: PaintTool) => {
          const item = TOOLS.find((t) => t.value === value);
          if (!item) return null;
          const Icon = item.icon;
          return (
            <button
              key={item.value}
              type="button"
              className={`redraw-tool-btn${tool === item.value ? ' active' : ''}`}
              aria-pressed={tool === item.value}
              title={`${item.label} (${item.shortcut})`}
              onClick={() => setTool(item.value)}
            >
              <Icon size={16} />
              {item.label}
            </button>
          );
        };
        return (
          <div className="pk-source-pane redraw-stage">
            <div className="redraw-stage-topbar">
              <div className="redraw-toolbar" role="toolbar" aria-label="重绘工具">
                {renderToolButton('hand')}
                {renderToolButton('eraser')}
                <span className="redraw-tool-divider" />
                {renderToolButton('rect')}
                {renderToolButton('ellipse')}
                {renderToolButton('brush')}
                {(tool === 'brush' || tool === 'eraser') && (
                  <label className="redraw-toolbar-brush">
                    <span className="sr-only">画笔大小</span>
                    <input
                      aria-label="画笔大小"
                      type="range"
                      min={10}
                      max={60}
                      step={2}
                      value={brush}
                      onChange={(e) => setBrush(Number(e.target.value))}
                    />
                    <output>{brush}</output>
                  </label>
                )}
              </div>
            </div>
            <div className="redraw-canvas-wrap">
              <MaskPainter
                url={image.url}
                tool={tool}
                brush={brush}
                zoom={zoom}
                pan={pan}
                maxRegions={MAX_ANNOTATIONS}
                onPanChange={setPan}
                onRegionLimit={() => message.warning(`最多支持 ${MAX_ANNOTATIONS} 个标注区域，请先撤回或删除一个`) }
                onChange={handlePaintState}
                handleRef={painter}
              />
            </div>
            <p className="redraw-mask-hint">
              {painted
                ? '标注区域将按描述重绘，其余像素保持不变。'
                : '还没标注。涂抹、框选或圈选要修改的区域后再提交。'}
            </p>
            <div className="redraw-canvas-footer">
              <button
                type="button"
                className="redraw-footer-btn"
                disabled={!canUndo || uploadBusy}
                title="撤回 (Ctrl+Z)"
                onClick={() => painter.current?.undo()}
              >
                <Undo2 size={13} />
                撤回
              </button>
              <button
                type="button"
                className="redraw-footer-btn"
                disabled={!canRedo || uploadBusy}
                title="恢复 (Ctrl+Shift+Z)"
                onClick={() => painter.current?.redo()}
              >
                <Redo2 size={13} />
                恢复
              </button>
              <button type="button" className="redraw-footer-btn" disabled={uploadBusy} onClick={() => painter.current?.clear()}>
                <RotateCcw size={13} />
                清空
              </button>
              <span className="redraw-tool-divider" />
              <button type="button" className="redraw-footer-btn redraw-zoom-btn" aria-label="缩小" title="缩小 (-)" onClick={() => setZoom((z) => Math.max(70, z - 10))}>
                <Minus size={16} />
              </button>
              <span className="redraw-zoom-value">{zoom}%</span>
              <button type="button" className="redraw-footer-btn redraw-zoom-btn" aria-label="放大" title="放大 (+)" onClick={() => setZoom((z) => Math.min(140, z + 10))}>
                <Plus size={16} />
              </button>
            </div>
            <p className="redraw-shortcut-hint">
              快捷键：H 抓手 · B 涂抹 · E 擦除 · R 框选 · O 圈选 · Ctrl+Z 撤回 · Ctrl+Shift+Z 恢复 · +/- 缩放
            </p>
          </div>
        );
      }}
    >
      {(images) => {
        if (images.length === 0) return null;
        const image = images[0];
        return (
          <>
            <ToolCard title={`重绘描述（${filledCount}/${MAX_ANNOTATIONS}）`}>
              {prompts.slice(0, visiblePromptCount).map((prompt, index) => (
                <div key={index} className={`redraw-prompt${index < regionCount ? '' : ' is-pending'}`}>
                  {index < regionCount && (
                    <button
                      type="button"
                      className="remove-annotation"
                      aria-label={`删除标注${index + 1}`}
                      title={`删除标注${index + 1}`}
                      disabled={uploadBusy}
                      onClick={() => removeAnnotationAt(index)}
                    >
                      <X size={13} />
                    </button>
                  )}
                  <div className="redraw-prompt-head">
                    <label
                      className={`redraw-prompt-label${index < regionCount ? ' is-marked' : ' is-pending'}`}
                    >
                      <i />
                      标注{index + 1}
                    </label>
                    <button
                      type="button"
                      className="pk-desc-expand"
                      aria-label={`放大编辑标注${index + 1}`}
                      title="放大编辑"
                      onClick={() => setExpandIndex(index)}
                    >
                      <Maximize2 size={14} />
                    </button>
                  </div>
                  <div className="redraw-prompt-body">
                    <textarea
                      rows={2}
                      maxLength={200}
                      value={prompt}
                      placeholder="请输入您要重绘的内容，例如：更换颜色..."
                      onChange={(e) => setPromptAt(index, e.target.value)}
                    />
                    {index < regionCount && regionBounds[index] && image && (
                      <div className="annotation-mark-preview" title={`标注${index + 1}区域`}>
                        <img src={image.url} alt={`标注${index + 1}区域`} style={markPreviewStyle(regionBounds[index])} />
                      </div>
                    )}
                  </div>
                  <div className="redraw-prompt-tools">
                    <button
                      type="button"
                      className="redraw-prompt-ref"
                      disabled={uploadBusy}
                      onClick={() => referenceInputs.current[index]?.click()}
                    >
                      <ImagePlus size={13} />
                      {referenceUploading.has(index) ? '上传中…' : references[index] ? '更换参考图' : '上传参考图'}
                    </button>
                    {references[index] && (
                      <span className="redraw-prompt-ref-preview">
                        <img src={references[index]!.url} alt={`标注${index + 1}参考图`} />
                        <button
                          type="button"
                          aria-label={`移除标注${index + 1}参考图`}
                          onClick={() =>
                            setReferences((prev) => prev.map((item, i) => (i === index ? null : item)))
                          }
                        >
                          <X size={11} />
                        </button>
                      </span>
                    )}
                    <input
                      ref={(el) => {
                        referenceInputs.current[index] = el;
                      }}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      hidden
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        void uploadReference(index, file);
                        e.target.value = '';
                      }}
                    />
                  </div>
                </div>
              ))}
              <p className="tool-card-copy">
                多条描述会按标注顺序合并到同一条提示词中；遮罩为当前所有标注合成的一张 PNG。
              </p>
            </ToolCard>

            <ExpandTextModal
              open={expandIndex !== null}
              title={`编辑标注${(expandIndex ?? 0) + 1}`}
              value={prompts[expandIndex ?? 0] ?? ''}
              maxLength={1000}
              placeholder="例如：把包装盒改成哑光材质"
              onChange={(v) => setPromptAt(expandIndex ?? 0, v)}
              onClose={() => setExpandIndex(null)}
            />
          </>
        );
      }}
    </ToolShell>

    </>
  );
}
