import { createContext } from 'react';
import type { ReactNode } from 'react';
import type { Modality, Task, TaskStatus } from '../types/api';

/**
 * ToolShell 的对外契约。
 *
 * 2026-11-04 从 `ToolShell.tsx` 抽出：该文件此前把类型契约、结果卡片、主壳、
 * 任务轮询 hook 与放大编辑弹窗塞在同一个 1131 行文件里。类型单独成文件后，
 * 9 个工具页只依赖契约、不依赖主壳实现，改壳不会牵动类型消费方。
 *
 * 所有符号仍经 `ToolShell.tsx` 再导出，既有 `from '../components/ToolShell'`
 * 导入无需改动。
 */

export interface ToolAsset {
  id: string;
  url: string;
  name: string;
}

export interface ToolResult {
  status: TaskStatus;
  url?: string;
  width?: number;
  height?: number;
  errorCode?: string | null;
  /**
   * 本次实际通道: gateway=真实模型；local 仅用于历史任务。
   *
   * 由 `lib/poll.ts` 的 pollToResult 透出。结果卡按它显示徽标 ——
   * 新任务只会是 gateway；历史 local 记录必须如实区分，不能按静态 mode 猜。
   */
  provider?: string | null;
  /**
   * 产出模态 (2026-10-20 视频通道落地)。
   *
   * ⚠️ 可选: 后端在视频通道落地前只返回图像产出, 没有该字段。
   * 故渲染时按「有值且为 video」判定, 缺省按图片处理 ——
   * 不能反过来 (缺省当视频会让存量产出全变白屏)。
   */
  modality?: Modality;
  /** 视频时长 (毫秒); 仅 video 模态有值 */
  durationMs?: number | null;
}

export interface ToolSettings {
  ratio: string;
  resolution: string;
}

/** 结果卡里的原图/结果图分割对比；不传时仍显示普通结果预览。 */
export interface ToolResultCompare {
  beforeUrl: string;
  beforeLabel?: string;
  afterLabel?: string;
}

/** 自定义已上传图片位的操作入口 (局部重绘的预览 / 重新编辑 / 重新上传)。 */
export interface UploadPreviewControls {
  open: () => void;
  remove: (id: string) => void;
  preview: (image: ToolAsset) => void;
  uploading: boolean;
}

/** 修图页共用历史栏的收起状态；由 ToolShell 持有，ToolHistoryPane 消费。 */
export interface ToolTrailingControl {
  collapsed: boolean;
  toggle: () => void;
  /**
   * 把一条历史结果重新放回上传位，供用户基于它继续改图。
   *
   * 参考站历史卡的「再次使用」不是重放旧任务，而是把当时的结果作为新输入。
   * 返回值表示是否已加入输入位；跨项目素材会先复制到当前项目再返回。
   */
  reuseTask: (task: Task) => Promise<boolean>;
}

export const ToolTrailingContext = createContext<ToolTrailingControl | null>(null);

export interface UploadSpec {
  title: string;
  required?: boolean;
  max: number;
  /** dropzone 内的小字说明 */
  hint: string;
  /** 主提示语 (默认: 点击或拖拽图片到此处上传) */
  prompt?: string;
  /** 主提示图标 (局部重绘/去水印参考站使用简单加号) */
  promptIcon?: ReactNode;
  accept?: string;
}

export interface SettingsSpec {
  /** 比例组 (含"原比例"首项; 参考站修图系默认原比例) */
  ratio?: boolean;
  /** 分辨率组 (1K/2K/4K; 4K 在该能力无云端通道时禁用, 见 lib/optionSets) */
  resolution?: boolean;
  defaultRatio?: string;
  /** 参考站历史恢复时回填画质档位；缺省 1K。 */
  defaultResolution?: string;
}

export interface Props {
  /** 能力 id (提交任务与历史过滤) */
  capability: string;
  /**
   * 参考站页面级 class (如 local-redraw-page / product-retouch-page)。
   *
   * 放在共享骨架上而不是再包一层 div: 参考站的页面 class 本身就承担
   * grid/padding/height，再套一层会让负 margin 逃逸后的宽度与内层栅格错位。
   */
  pageClass?: string;
  /** 输入栏附加 class (如参考站 rotate-angle-controls) */
  inputPaneClassName?: string;
  /**
   * 上传辅助操作的位置。
   *
   * 旋转角度页把「从素材库导入 / 手机上传」渲染为上传卡上方的独立 13px 行；
   * 其余页面仍在卡片标题行内。两种结构都由同一份按钮节点渲染。
   */
  uploadActionsPlacement?: 'inside' | 'above';
  /** 页标题 (空态 h3 与结果栏标题) */
  title: string;
  /** 提交按钮下方的一句话描述 (参考站各页固定文案) */
  desc: string;
  /** 上传卡规格; 传 null 表示页面自带上传区 (如 SKU 模板卡 / 多图融合双上传区) */
  upload: UploadSpec | null;
  /** 本次请求必然提交的模型输入槽位（如遮罩页面的 `mask`） */
  requiredInputs?: readonly string[];
  settings?: SettingsSpec;
  /** 提交按钮主文案 */
  submitLabel: string;
  /**
   * 按钮内积分/免费角标 (**留空即由 ToolShell 按能力自动解析**)。
   *
   * 2026-10-20 起不再要求各页硬编码 —— 硬编码那份是纯文案, 与实际扣费无关,
   * 后台改价后 8 个页面会集体说谎。自动解析读的是后端下发的 creditCost。
   * 仍保留此 prop 只为个别页覆写 (如 SKU 图需显示与 registry 不同的口径)。
   */
  creditLabel?: string;
  /** 提交按钮上方的提示行 (参考站部分页有 '* 确认素材和参数后提交…') */
  hint?: string;
  /** 空态描述 */
  emptyDesc: string;
  /**
   * 业务卡 (上传卡与提交区之间)。
   *
   * 传函数时**每次渲染都会拿到当前已上传的图片** —— 局部重绘要用它当画布底图
   * （涂抹出的遮罩必须与原图同尺寸）。传普通节点则与改造前一致。
   */
  children?: ReactNode | ((images: ToolAsset[]) => ReactNode);
  /**
   * 自定义已上传图片位。
   *
   * 默认使用 pk-thumb-grid；局部重绘参考站是「160×160 预览 + 重新编辑/重新上传」，
   * 由页面渲染这组操作，但仍复用 ToolShell 的图片状态、素材库与手机上传。
   */
  renderUploadPreview?: (images: ToolAsset[], controls: UploadPreviewControls) => ReactNode;
  /** 单图工具重新上传时替换当前图，而不是被「最多 1 张」拒绝。 */
  replaceUpload?: boolean;
  /** 图片位变化 (上传 / 替换 / 移除 / 历史回填)。 */
  onImagesChange?: (images: ToolAsset[]) => void;
  /** 提交条件 */
  formValid: boolean;
  submitting: boolean;
  result: ToolResult | ToolResult[] | null;
  /** 结果标签 (如复刻程度/SKU 名, 显示在结果卡上) */
  resultTag?: string;
  /** 提交: 输入按上传顺序给出, 设置含比例/画质 */
  onSubmit: (inputs: ToolAsset[], settings: ToolSettings) => Promise<void>;
  /** 高级设置变化 (结果编辑器需要与比例保持同步时使用) */
  onSettingsChange?: (settings: ToolSettings) => void;
  /** 结果操作区附加按钮 (如批量下载) */
  resultActions?: ReactNode;
  /** 结果卡内嵌原图/结果对比 (局部重绘、去水印)；多图结果不启用 */
  resultCompare?: ToolResultCompare;
  /**
   * 单图工具的结果呈现方式。
   *
   * `product-card` 复刻参考站产品系工具（商品换色等）的右栏：不再套通用
   * 「生成结果 / 重新生成 / 尺寸 / 下载原图」网格，而是在可用区域中央放
   * 一张带角标和下载按钮的大图卡。生成中同样沿用该卡片的宽高比例。
   *
   * `canvas` 供局部重绘使用：成功结果直接复用标注画布的舞台和定位规则，
   * 结果图保持在原画布位置，不再渲染结果名称、标签、来源与尺寸元信息。
   */
  resultView?: 'default' | 'product-card' | 'canvas';
  /** 生成中卡片的宽高比；通常取已上传原图的比例，未知时按 3:4。 */
  generatingAspect?: number;
  /** 产品卡右上角/左上角的状态角标；默认「结果」。 */
  resultBadge?: string;
  /** 历史结果已回填到上传位；页面可据此清掉上一轮结果态 */
  onHistoryReuse?: () => void;
  /**
   * 替换默认结果栏。商品 SKU 图需要与商品主图共用「全部生成图」网格，
   * 但左栏仍复用这里的上传/提交骨架，故由页面注入自己的结果面板。
   */
  resultPane?: ReactNode;
  /**
   * 结果栏空态的业务面板 (无结果时替换通用空态插画)。
   *
   * 局部重绘把涂抹画布放在右栏宽区 —— 左栏 432px 对着一张大图涂抹太挤;
   * 传入函数形态时可读到当前已上传的图片 (与 children 同约定)。
   * 返回 null 时回落默认空态, 页面可以只在「有图」时才接管这块。
   */
  sourcePane?: ReactNode | ((images: ToolAsset[]) => ReactNode);
  /**
   * 提交期间保留 sourcePane 不卸载。
   *
   * 局部重绘的画布状态（笔迹 / 标注）只存在于 MaskPainter 内部；若提交时
   * 用生成态替换 sourcePane，一次确定性拒绝（如 402 积分不足）返回后画布
   * 会以空态重建，用户刚画好的遮罩与描述位一起丢失，提交按钮也会因
   * painted=false 永久禁用。该页改为保留画布，生成反馈由提交按钮承担。
   */
  keepSourceWhileSubmitting?: boolean;
  /**
   * 结果栏空态的演示视频 (1:1 复刻参考站 image-tool-empty-state-media)。
   *
   * 智能扩图 / 图片翻译 / 产品精修 / 商品换色 / 旋转角度在无图时播放各自的
   * 演示视频 (素材自托管于 /static/mp4/, 与参考站同名同源)；传了才替换通用
   * 空态插画, 结构与参考站一致: video 480×480 + strong 标题 + p 描述。
   */
  emptyVideo?: string;
  /**
   * 右侧附加栏 (局部重绘的常驻历史记录)。
   *
   * 只有传了这个 prop 的页面才切成三栏 —— 其余工具页继续沿用
   * 「输入 + 结果」两栏，不受参考站历史侧栏改版影响。
   */
  trailingPane?: ReactNode;
}
