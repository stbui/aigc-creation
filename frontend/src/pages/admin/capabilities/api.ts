/**
 * 能力管理的接口入口 —— 目录内文件的唯一外部接口来源。
 *
 * 约定：`capabilities/` 下的文件不从 `src/lib/api` 直接取接口对象，一律经由
 * 本文件。外部接口对象集中可见，换实现或加拦截只改一处。
 */

export {
  adminCapabilitiesApi,
  adminCapabilityModelsApi,
} from '../../../lib/api';
