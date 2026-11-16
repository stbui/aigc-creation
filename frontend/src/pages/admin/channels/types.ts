/**
 * 渠道工作台的类型出口 —— 目录内文件的唯一类型来源。
 *
 * 外部类型（`types/model`、`types/imageCapability`）在此统一 re-export，业务
 * 文件一律从 `./types` 取。本目录的表单草稿、筛选态等**本地结构类型**留在
 * `constants.ts`（规范 §2 允许 constants 放草稿/结构类型），与同文件的
 * `EMPTY_*` 默认值绑定在一起，搬到此处反而割裂。
 */

export type {
  AdminChannelDefaultModelView,
  AdminChannelModelListItem,
  AdminChannelModelView,
  AdminChannelView,
  ChannelModelHealthRowView,
  ChannelModelPriceTierView,
  ChannelModelRepriceInput,
  ChannelOrderItemView,
  ModelCommerceOverviewView,
  ModelCommerceProductView,
  ProtocolCatalogEntryView,
  ProtocolTestResultView,
  SystemChannelExportView,
  UpstreamModelPreview,
} from '../../../types/model';

export type { ImageParameterDefinitionView } from '../../../types/imageCapability';
