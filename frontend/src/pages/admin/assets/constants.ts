/**
 * 素材管理的选项表与默认值。
 *
 * `BACKEND_LABEL` 同时是存储后端的白名单来源：URL 里的 `backend` 值不在表内
 * 即忽略，避免手工改地址栏把列表打到后端不认识的筛选值。
 */

import type { AdminAssetListResult } from '../../../types/api';

export type AssetRow = AdminAssetListResult['items'][number];

export const BACKEND_LABEL: Record<string, string> = {
  local: '本地',
  oss: '阿里云 OSS',
  minio: 'MinIO',
};

export const BACKEND_OPTIONS = Object.entries(BACKEND_LABEL).map(([value, label]) => ({
  value,
  label,
}));

export const KIND_OPTIONS = [
  { value: 'original', label: '原始上传' },
  { value: 'generated', label: '生成图' },
];

export const STATUS_OPTIONS = [
  { value: 'visible', label: '已上架' },
  { value: 'hidden', label: '已下架' },
];

/** 网格适合扫图，一页 60 张 */
export const GRID_PAGE_SIZE = 60;

/** 表格适合查属性，一页 20 行 */
export const TABLE_PAGE_SIZE = 20;

/** 需要删除确认的目标：单张或当前选中集 */
export type AssetDeleteTarget =
  | { kind: 'single'; row: AssetRow }
  | { kind: 'batch'; count: number };
