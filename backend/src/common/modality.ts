/**
 * 模态 —— 产出介质的枚举（跨层共享的叶子定义）。
 *
 * 语义：模态 = 产出的**介质形态**，与实现程度正交。
 *   image / text / video
 *
 * 只放类型，不放行为：能力层用它选图标与渲染方式，健康检查用它分组汇总，
 * 路由目录用它把前台模型按 `capability` 归类。协议层的 `ManifestCapability`
 * 额外包含 `audio`（插件可能声明），两者不要互相替代。
 */
export type Modality = 'text' | 'image' | 'video';
