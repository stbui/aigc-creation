/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  /** 后台外壳实现：默认 boardui；给 legacy 可整站回滚到旧 antd 外壳 */
  readonly VITE_ADMIN_UI?: 'boardui' | 'legacy';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
