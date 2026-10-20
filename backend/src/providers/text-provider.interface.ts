// 文本生成 Provider 抽象层 —— **转发层** (2026-10-20 架构重构后)。
//
// 定义已迁至 `unified/unified.provider.ts` (统一模型能力层), 本文件只做
// re-export 转发。
//
// ⚠️ 本文件**不得再定义任何类型** —— 保留两套「文本接口」定义就等于
// 回到本项目反复出现的那类重复 (两个真相源, 改一处另一处静默漂移)。
//
// 为什么与 ImageProvider 平级而非合并成一个泛型接口 (保留作对照):
//
// 三种模态的产物形状根本不同 —— 图像是 Buffer + mime, 文本是一段字符串,
// 视频是 Buffer + 时长。若强行塞进同一个 `produce(): Buffer` 的接口,
// 文本就必须被编码成 UTF-8 字节再解回来, 视频则要额外挂时长字段,
// 结果是三处 `if (modality === ...)` 分支横跨所有 provider 实现。
// 平级接口让每个 provider 只关心自己的形状, 路由层负责选谁。

import type { TextOutcome, TextProvider } from './unified/unified.provider';

export type { TextOutcome, TextProvider };

/**
 * 消息角色与形状 —— 与统一能力层同源。
 *
 * ⚠️ 用 `Parameters<TextProvider['generate']>[1]` 提取会得到**嵌套数组**
 * (generate 的第二参本身是数组), 故此处显式声明形状, 由统一能力层
 * 的同名类型派生 —— 保证两边不会漂移, 又不引入数组套数组。
 */
export type TextMessage = import('./unified/unified.provider').TextMessage;

/**
 * @deprecated 改用 TextOutcome (统一模型能力层的正式命名)。
 *
 * 保留别名是为不打断既有引用; 新代码一律用 TextOutcome。
 */
export type TextProviderResult = TextOutcome;
