/** 后台存储域：后端配置字段、配置视图与状态。 */
import type { StorageBackendId } from "./admin-assets";

/* ────────────────────────────────────────────────────────────────
   存储后端 (admin-prd.md §3.11 B-62/63)
   ──────────────────────────────────────────────────────────────── */

/** GET /api/v1/admin/storage/status */
/** 存储后端可编辑字段定义（与后端 StorageConfigField 同构，驱动表单）。 */
export interface StorageConfigField {
  name: string;
  label: string;
  /** select 需要 options，number 需要 min/max；后端已做同名归一校验 */
  type: 'text' | 'password' | 'switch' | 'select' | 'number';
  required: boolean;
  secret?: boolean;
  default?: string;
  placeholder?: string;
  /** 字段用途说明，展示为表单 hint */
  hint?: string;
  options?: Array<{ value: string; label: string }>;
  /** 抽屉内的分区标题 */
  group?: string;
  min?: number;
  max?: number;
}

/** 存储后端配置视图：非密钥明文 + 密钥是否已配置/脱敏。明文密钥永不下发。 */
export interface StorageConfigView {
  fields: StorageConfigField[];
  values: Record<string, string>;
  secretConfigured: Record<string, boolean>;
  secretMasked: Record<string, string>;
  source: 'db' | 'none';
  /** 最后保存人与时间（页面展示审计信息） */
  updatedBy?: string;
  updatedAt?: string;
}

export interface AdminStorageStatus {
  active: StorageBackendId;
  backends: Array<{
    backend: StorageBackendId;
    available: boolean;
    configured: boolean;
    active: boolean;
    /** 脱敏凭据, 永不返回明文 (B-63) */
    masked?: string;
    endpoint?: string;
    probeMessage?: string;
    probeLatencyMs?: number;
    /** 可编辑配置视图（local 也带公开访问域名配置） */
    config: StorageConfigView;
  }>;
  credentialSource: string;
  /** 2026-11 起凭据支持页面编辑（加密落库），不再是只读环境变量 */
  editable: boolean;
}

/** PUT /admin/storage/config/:backend 响应 */
export interface AdminStorageSaveConfigResult {
  backend: StorageBackendId;
  config: StorageConfigView;
  note: string;
}

/** POST /admin/storage/probe 响应（带 values 时是草稿测试） */
export interface AdminStorageProbeResult {
  backend: string;
  ok: boolean;
  message: string;
  latencyMs?: number;
}
