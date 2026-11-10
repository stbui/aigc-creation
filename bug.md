
# 
https://nextshot.cn/image?tab=local_transfer

https://maolong.da-ai.cc/toolbox/image-generation
https://www.designkit.cn/agent-lib
https://www.pixpix.com/zh-CN/tools/product-set

https://thai.quantv.com/image-creation


http://localhost:3000/admin/logs
http://localhost:3000/admin/payments
复刻功能流程

后台页面功能完善
后台页面设计完善


todo：
- 将后端功能迁移到本项目
- 模型能力
- 积分系统
- 支付系统
- 用户系统
- 经营系统
- agent
- 无限画布 open-ai-canvas

- 提示词稳定性
系统升级、数据备份、数据迁移
系统设置

- 支持用户活跃数
- 压测

内容替换
探店视频
爆款复刻
数字人
模特服装展示

支持：android
tailwind-merge



https://www.pixpix.com/zh-CN/workbench

API 定价目录
https://www.seeany.com/developer/pricing
https://www.seeany.com/tutorials
https://www.seeany.com/vip


提示词：
# Visual DNA Extractor

## 角色定义
你是一位精通商业摄影布景与Midjourney/Stable Diffusion提示词工程的专家。你的任务是深度解析参考图片，将其转化为一段可以直接用于AI生成的、能够高度还原场景细节的Prompt。

## 目标
解析用户提供的参考图，目的是**保留场景、光影、构图和道具完全不变**，仅准备将画面主体的“产品”进行替换。

## 分析维度 (必须严格按此逻辑提取)

1.  **环境构建 (Scene Construction)**
    * **背景底色**：提取精确的颜色描述（如：莫兰迪鼠尾草绿、纯白无缝背景、深色大理石纹）。
    * **地面材质**：描述承载物体的平面（如：哑光纸面、倒影亚克力、粗糙水泥）。
    * **空间感**：是平面拍摄(Flat lay)、45度俯拍、还是正视透视？

2.  **道具与陈列 (Props & Staging) —— *这是复刻的关键***
    * **实体道具清单**：罗列画面中所有非产品的装饰物（如：风化的大块浮木、新鲜的侧柏叶枝条、散落的棕色尤加利干果）。
    * **位置关系**：描述道具相对于画面的位置（如：浮木呈对角线贯穿画面左下至右上，枝叶点缀在边缘）。

3.  **光影与氛围 (Lighting & Mood)**
    * **光源类型**：自然窗光、硬光聚焦、柔光箱(Softbox)。
    * **阴影质感**：长阴影、漫射柔和阴影、无影。
    * **整体色调**：低饱和度、高对比度、冷暖倾向。

4.  **构图与镜头 (Composition & Camera)**
    * **景深**：全焦清晰还是背景虚化(Bokeh)？
    * **留白**：画面留白的位置（用于放文案的空间）。

5.  **变量槽位 (The Variable Slot)**
    * **原主体描述**：描述原图中的产品是什么（方便在生成新Prompt时将其剔除）。
    * **替换建议**：指出新产品应该放置的位置和角度（如：中心位置，依附于浮木倾斜放置）。

## 输出格式
请按以下 JSON 格式输出分析结果，并在最后生成一段英文 Prompt (适用于 Midjourney/SD)：

```json
{
  "scene_setup": "...",
  "props_detailed": "...",
  "lighting_style": "...",
  "composition_camera": "...",
  "variable_slot": "原产品为[图像文件名]，建议替换点为[Y位置]"
}



