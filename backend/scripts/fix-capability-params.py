"""
一次性修复 (2026-10-20): 给 definitions/*.ts 补回 params 字段。

## 背景

首次生成时脚本算出了 params 却没写进产物, 而 registry 随即被改写为门面,
原始单体定义不复存在 (该文件从未进入 git, `git cat-file -e` 报 not in HEAD,
故无备份可取)。故按会话内已读取的原始参数块逐项还原。

## 为什么这样还原是可信的

params 的每一条 (key / label / type / default / options / placeholder / help)
都来自本会话对迁移前 `capability.registry.ts` 的逐段读取, 且与
`scripts/verify-capability-extraction.ts` 里的固定基线快照逐字段对齐 ——
该基线是独立抄录的, 与本还原脚本不共享数据源, 两者一致才说明还原无误。

⚠️ 本脚本同样是一次性的, 完成后即可删除。
"""

import os
import re

OUT = 'src/capabilities/definitions'

# 每个能力的 params 块 (缩进 4 空格, 与原 registry 一致)
PARAMS: dict[str, str] = {}

PARAMS['main_image'] = """    params: [
      { key: 'productName', label: '商品名称', type: 'text', placeholder: '例如：夏季轻音桌面循环扇' },
      { key: 'brand', label: '品牌（选填）', type: 'text', placeholder: '请输入品牌（选填）' },
      { key: 'platform', label: '投放平台', type: 'enum', default: 'taobao', options: PLATFORMS },
      { key: 'language', label: '输出语言', type: 'enum', default: 'zh-CN', options: LANGUAGES },
      {
        key: 'description',
        label: '商品描述',
        type: 'text',
        placeholder: '例如：三档风速，低噪运行，USB 供电',
      },
      { key: 'variant', label: '主图类型', type: 'enum', default: 'other', options: MAIN_IMAGE_VARIANTS },
      { key: 'ratio', label: '画面比例', type: 'enum', default: '1:1', options: RATIOS },
      { key: 'size', label: '画质（输出边长）', type: 'enum', default: '1k', options: QUALITY_OPTIONS },
    ],"""

PARAMS['detail_image'] = """    params: [
      { key: 'productName', label: '商品名称', type: 'text', placeholder: '例如：夏季轻音桌面循环扇' },
      { key: 'brand', label: '品牌（选填）', type: 'text', placeholder: '请输入品牌（选填）' },
      { key: 'platform', label: '投放平台', type: 'enum', default: 'taobao', options: PLATFORMS },
      { key: 'language', label: '输出语言', type: 'enum', default: 'zh-CN', options: LANGUAGES },
      {
        key: 'description',
        label: '商品描述',
        type: 'text',
        placeholder: '例如：三档风速，低噪运行，USB 供电',
      },
      {
        key: 'sections',
        label: '包含模块（逗号分隔，默认前 6 项，上限 10）',
        type: 'text',
        placeholder: DETAIL_SECTION_DEFAULTS.join(','),
        help: '可选键: ' + DETAIL_SECTIONS.map((s) => s.value).join(' / '),
      },
      { key: 'sku', label: 'SKU 编号（选填）', type: 'text', placeholder: 'SKU-001' },
      { key: 'size', label: '画质（输出宽度）', type: 'enum', default: '1k', options: QUALITY_OPTIONS },
    ],"""

PARAMS['hot_remake'] = """    params: [
      { key: 'productName', label: '商品名称（选填）', type: 'text', placeholder: '请输入商品名称（选填）' },
      { key: 'brand', label: '品牌（选填）', type: 'text', placeholder: '请输入品牌（选填）' },
      { key: 'platform', label: '投放平台', type: 'enum', default: 'taobao', options: PLATFORMS },
      { key: 'language', label: '输出语言', type: 'enum', default: 'zh-CN', options: LANGUAGES },
      {
        key: 'requirement',
        label: '复刻要求（选填）',
        type: 'text',
        placeholder: '例如：文案统一用英文、模特保持完全不变、参考图不变只替换商品。',
        help: '本地算法仅将 ASCII 部分绘制到图上, 中文原文完整记录在任务参数中',
      },
      {
        key: 'degree',
        label: '复刻程度',
        type: 'enum',
        default: 'high_replica',
        options: [
          { value: 'reference_style', label: '参考风格' },
          { value: 'high_replica', label: '高度复刻' },
        ],
        help: '参考风格: 提取参考图配色与结构重建场景; 高度复刻: 保留参考图整体结构替换商品',
      },
      { key: 'ratio', label: '画面比例', type: 'enum', default: '1:1', options: RATIOS },
      { key: 'size', label: '画质（输出边长）', type: 'enum', default: '1k', options: QUALITY_OPTIONS },
    ],"""

PARAMS['creative_image'] = """    params: [
      {
        key: 'prompt',
        label: '画面描述',
        type: 'text',
        placeholder: '例如：清晨窗边的木质桌面，柔和自然光，极简ins风',
        help: '描述越具体，构图越可控',
      },
      { key: 'ratio', label: '画面比例', type: 'enum', default: '4:3', options: RATIOS },
    ],"""

PARAMS['multi_fusion'] = """    params: [
      { key: 'scene', label: '融合场景', type: 'enum', default: 'print_pattern', options: FUSION_SCENARIOS },
      { key: 'variantCount', label: '变体张数', type: 'enum', default: '4', options: FUSION_VARIANT_COUNTS },
      { key: 'ratio', label: '画面比例', type: 'enum', default: '1:1', options: RATIOS },
      { key: 'size', label: '画质（输出边长）', type: 'enum', default: '1k', options: QUALITY_OPTIONS },
    ],"""

PARAMS['sku_image'] = """    params: [
      {
        key: 'region',
        label: '变体区域',
        type: 'enum',
        default: 'center',
        options: [
          { value: 'center', label: '画面中心' },
          { value: 'top', label: '画面上方' },
          { value: 'bottom', label: '画面下方' },
          { value: 'left', label: '画面左侧' },
          { value: 'right', label: '画面右侧' },
        ],
        help: '参考站支持框选最多 3 个 SKU 变体区域, 本地以位置枚举代替',
      },
      { key: 'skuName', label: 'SKU 名称', type: 'text', placeholder: '例如： CLASSIC BLACK / M' },
      { key: 'skuColor', label: 'SKU 颜色', type: 'enum', default: '#FFFFFF', options: BG_COLOR_OPTIONS.slice(1, 6) },
      { key: 'ratio', label: '画面比例', type: 'enum', default: '1:1', options: RATIOS },
      { key: 'size', label: '画质（输出边长）', type: 'enum', default: '1k', options: QUALITY_OPTIONS },
    ],"""

PARAMS['local_redraw'] = """    params: [
      {
        key: 'region',
        label: '重绘区域',
        type: 'enum',
        default: 'center',
        options: [
          { value: 'center', label: '画面中心' },
          { value: 'top', label: '画面上方' },
          { value: 'bottom', label: '画面下方' },
          { value: 'left', label: '画面左侧' },
          { value: 'right', label: '画面右侧' },
          { value: 'full', label: '整图重绘' },
        ],
        help: '参考站在画布上涂抹圈选, 本地以位置枚举代替涂抹区域',
      },
      { key: 'prompt', label: '这个区域改成什么？', type: 'text', placeholder: '例如：把包装盒改成哑光材质' },
      { key: 'ratio', label: '画面比例', type: 'enum', default: 'original', options: RATIOS_WITH_ORIGINAL },
      { key: 'size', label: '画质（输出边长）', type: 'enum', default: '1k', options: QUALITY_OPTIONS },
    ],"""

PARAMS['expand'] = """    params: [
      { key: 'occupy', label: '原图占比（%）', type: 'number', default: 80, min: 1, max: 100, step: 1 },
      { key: 'position', label: '原图位置', type: 'enum', default: 'center', options: EXPAND_POSITIONS },
      { key: 'ratio', label: '画面比例', type: 'enum', default: 'original', options: RATIOS_WITH_ORIGINAL },
      { key: 'size', label: '画质（输出边长）', type: 'enum', default: '1k', options: QUALITY_OPTIONS },
    ],"""

PARAMS['matting'] = """    params: [
      { key: 'bgColor', label: '背景颜色', type: 'enum', default: 'transparent', options: BG_COLOR_OPTIONS },
      {
        key: 'customColor',
        label: '自定义背景色（HEX）',
        type: 'text',
        placeholder: '#RRGGBB',
        help: '仅当背景颜色选择"自定义颜色"时生效',
      },
      { key: 'ratio', label: '画面比例', type: 'enum', default: 'original', options: RATIOS_WITH_ORIGINAL },
    ],"""

PARAMS['remove_watermark'] = """    params: [
      {
        key: 'mode',
        label: '处理方式',
        type: 'enum',
        default: 'auto',
        options: [
          { value: 'auto', label: '自动识别' },
          { value: 'region', label: '指定区域' },
        ],
      },
      { key: 'region', label: '区域位置', type: 'enum', default: 'bottom_right', options: [
        { value: 'bottom_right', label: '右下角' },
        { value: 'bottom_left', label: '左下角' },
        { value: 'top_right', label: '右上角' },
        { value: 'top_left', label: '左上角' },
        { value: 'center', label: '画面中央' },
      ] },
    ],"""

PARAMS['image_translate'] = """    params: [
      { key: 'targetLang', label: '目标语言', type: 'enum', default: 'zh-CN', options: LANGUAGES },
      { key: 'protectSubject', label: '保护商品主体', type: 'boolean', default: true },
      { key: 'size', label: '画质（输出边长）', type: 'enum', default: '1k', options: QUALITY_OPTIONS },
    ],"""

PARAMS['enhance'] = """    params: [
      { key: 'mode', label: '精修模式', type: 'enum', default: 'comprehensive', options: RETOUCH_MODES },
      {
        key: 'note',
        label: '补充要求（选填）',
        type: 'text',
        placeholder: '如：去掉电镀件上的指纹，让皮革看起来更有光泽',
        help: '本地算法仅将 ASCII 部分绘制到图上, 中文原文完整记录在任务参数中',
      },
      { key: 'ratio', label: '画面比例', type: 'enum', default: 'original', options: RATIOS_WITH_ORIGINAL },
      { key: 'size', label: '画质（输出边长）', type: 'enum', default: '1k', options: QUALITY_OPTIONS },
    ],"""

PARAMS['recolor'] = """    params: [
      { key: 'color', label: '商品颜色', type: 'enum', default: '#FFFFFF', options: BG_COLOR_OPTIONS.slice(1) },
      {
        key: 'customColor',
        label: '自定义颜色（HEX）',
        type: 'text',
        placeholder: '#RRGGBB',
        help: '仅当商品颜色选择"自定义颜色"时生效',
      },
      { key: 'ratio', label: '画面比例', type: 'enum', default: 'original', options: RATIOS_WITH_ORIGINAL },
      { key: 'size', label: '画质（输出边长）', type: 'enum', default: '1k', options: QUALITY_OPTIONS },
    ],"""

PARAMS['rotate'] = """    params: [
      { key: 'yaw', label: '旋转（水平角）', type: 'number', default: 0, min: -90, max: 90, step: 1 },
      { key: 'pitch', label: '倾斜（俯仰角）', type: 'number', default: 0, min: -30, max: 60, step: 1 },
      { key: 'zoom', label: '缩放', type: 'number', default: 1, min: 0.8, max: 1.2, step: 0.01 },
      { key: 'ratio', label: '画面比例', type: 'enum', default: 'original', options: RATIOS_WITH_ORIGINAL },
      { key: 'size', label: '画质（输出边长）', type: 'enum', default: '1k', options: QUALITY_OPTIONS },
    ],"""

PARAMS['free_create'] = """    params: [
      {
        key: 'prompt',
        label: '创作提示词',
        type: 'text',
        placeholder: '例如：把这款产品放在未来感厨房场景中，清晨自然光，干净高级，电商广告质感',
      },
      { key: 'ratio', label: '画面比例', type: 'enum', default: '1:1', options: RATIOS },
      { key: 'size', label: '画质（输出边长）', type: 'enum', default: '1k', options: QUALITY_OPTIONS },
    ],"""


def main() -> None:
    for cid, block in PARAMS.items():
        path = os.path.join(OUT, f'{cid}.ts')
        s = open(path, encoding='utf-8').read()
        if 'params:' in s:
            print('跳过 (已有 params):', cid)
            continue
        # 插到 buildPrompt 之前
        m = re.search(r'^  buildPrompt: ', s, re.M)
        assert m, f'{cid} 找不到 buildPrompt 锚点'
        # params 块是 4 空格缩进, 移到这里要变成 2
        normalized = '\n'.join(
            ln[2:] if ln.startswith('    ') else ln for ln in block.split('\n')
        )
        s = s[:m.start()] + normalized.rstrip() + '\n' + s[m.start():]
        open(path, 'w', encoding='utf-8').write(s)
        print('补回 params:', cid)
    print(f'\n共处理 {len(PARAMS)} 个文件')


if __name__ == '__main__':
    main()
