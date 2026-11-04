"use strict";
/**
 * 路由目录快照与解析结果的数据形状。
 *
 * 快照是**只读**的内存投影：装载时把 BigInt 金额转成 number，后续匹配、
 * 计价、展示都读同一份。任何写路径都不能改快照对象 —— 改价后应当递增
 * 目录版本并重新装载，否则两个并发请求会看到不同的价格（且其中一个永远是旧的）。
 */
Object.defineProperty(exports, "__esModule", { value: true });
//# sourceMappingURL=routing.types.js.map