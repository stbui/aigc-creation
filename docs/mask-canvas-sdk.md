# 遮罩画布 SDK

状态：现行。代码在 [`frontend/src/mask-sdk/`](../frontend/src/mask-sdk/)。

局部重绘（`pages/local-redraw/MaskPainter.tsx`）与去水印
（`components/WatermarkMaskEditor.tsx`）共用这套内核。SDK 不依赖 React，
也不规定 DOM 结构；两个页面组件只做适配。

## 1. 目录与职责

| 文件 | 内容 |
| --- | --- |
| `types.ts` | 工具 / 标记 / 区域 / 状态 / 会话选项 / 叠层模型 |
| `geometry.ts` | 客户端坐标 → 原图坐标、矩形拖动 / 缩放、白底与透明区域绘制 |
| `marks.ts` | 可见区域识别、橡皮过滤、笔迹点抽稀、区域包围盒 |
| `mask.ts` | `MaskBuffer`：离屏遮罩、整张重放、增量描边、透明像素探测、PNG 导出 |
| `session.ts` | `MaskSession`：标记 / 撤销栈 / 草稿 / 选中 / 手势 / 拖拽 / 通知 |
| `index.ts` | 公共出口 |

适配层负责：客户端坐标换算（`sourcePoint`）、DOM 标注层、指针捕获、平移与缩放。

## 2. 最小用法

```ts
import { MaskSession, sourcePoint } from '@/mask-sdk';

const session = new MaskSession({ maxRegions: 3, onRegionLimit: () => {} });
session.setSourceSize(1024, 768); // 原图 onLoad 后

const offOverlay = session.subscribe(renderOverlay);   // 叠层变化（按帧合并）
const offState = session.onStateChange((state) => {
  // state.painted / canUndo / canRedo / regions
});

session.beginGesture('brush', point, brushWidthInSourcePixels);
session.extendGesture(point);
session.endGesture();

const blob = await session.toBlob(); // 白底 + 透明标注区；无区域时为 null
```

React 适配层的推荐写法：`useSyncExternalStore(session.subscribe, session.getVersion)`
驱动重渲染，再按 version 记忆化 `session.getOverlayModel()`。

## 3. 两条通知通道

| 通道 | 触发 | 用途 |
| --- | --- | --- |
| `subscribe` / `getVersion` | 叠层变化，连续手势按 `requestAnimationFrame` 合并 | DOM 标注层重渲染（编号、圆点、选中柄） |
| `onStateChange` | 离散动作：提交 / 丢弃 / 撤销 / 恢复 / 清空 / 删除 / 拖拽结束 | 页面回传 painted / canUndo / canRedo / regions |

连续手势**不**逐帧回调页面：否则整页外壳会跟着按帧重渲染。

## 4. 不可违背的约束

- 坐标一律是原图像素；客户端坐标只由适配层换算。
- 遮罩协议唯一：白底 = 保留，`destination-out` = 重绘 / 去除（`fillMaskBackground` / `eraseMaskRegion`）。
- 手势期间的增量描边只服务预览；提交、取消、导出都会整张重放，最终遮罩只由标记列表决定。
- 区域用稳定 id 标识；不能按下标删除（完全擦除的隐藏标记会让下标错位）。
- `maxRegions` 只约束可描述区域（形状与画笔），橡皮不占位；越界草稿直接丢弃并回调。

## 5. 测试

- `mask-sdk/__tests__/geometry.test.ts`：坐标换算、夹取、矩形变换、遮罩合成契约。
- `mask-sdk/__tests__/marks.test.ts`：单点笔迹、完全 / 部分擦除、区域 id 稳定性。
- `mask-sdk/__tests__/session.test.ts`：提交 / 丢弃 / 上限 / 撤销恢复 / 删除 / 拖拽缩放 / 通知通道 / 换图。
- 浏览器层：`product-capabilities.spec.ts` 的局部重绘画布用例（含遮罩提交与 402 保留画布）。
