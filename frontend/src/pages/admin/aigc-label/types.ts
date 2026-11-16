/**
 * aigc-label 的类型出口 —— 目录内文件的唯一类型来源。
 *
 * 外部类型在此统一 re-export，业务文件一律从 `./types` 取。
 */

export type { AdminAigcLabel, AigcLabelPosition, AigcLabelSpec } from '../../../types/api';
