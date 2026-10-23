"""
一次性迁移脚本 (2026-10-20): 把 capability.registry.ts 里的 15 项能力
机械地拆成 definitions/<id>.ts。

## 状态: 已执行完毕, 保留作**可重跑的一次性工具**

registry 在迁移后已改写为门面 (CAPABILITIES 直接引用 definitions),
因此本脚本现在**无法**再从 registry 反推原始定义 ——
它依赖的是迁移前的单体 registry 结构。
`backend/src/capabilities/capability.registry.ts` 从未进入 git
(`git cat-file -e` 报 not in HEAD), 故**没有备份可取**。

⚠️ 结论: 本脚本不要重跑。当前 definitions/ 的内容已由
`scripts/verify-capability-extraction.ts` 对着固定的基线快照逐字段验证过
(参数键序 / 枚举取值 / 积分价 / 模态 / 本地实现句柄),
那才是真正的守卫; 本文件仅作为迁移过程的可追溯记录。

## 为什么当初用脚本生成而不是手写

能力参数有 200+ 行枚举 (语言 10 项、融合场景 15 项、详情模块 16 项…)。
手抄必然出错, 而参数值与参考站的一致性是 1:1 复刻的硬要求 ——
少一个选项就是契约差异。故机械抽取, 生成后再逐字段 diff 验证等价。
"""

import re
import os

SRC = 'src/capabilities/capability.registry.ts'
PROMPT_SRC = 'src/providers/gateway-prompt.ts'
OUT = 'src/capabilities/definitions'

# 能力 id → LocalImageProvider 上的本地实现方法名
LOCAL_IMPL = {
    'main_image': 'makeMainImage',
    'detail_image': 'makeDetailImage',
    'hot_remake': 'makeClone',
    'free_create': 'makeFreeCreation',
    'creative_image': 'makePlaceholder',
    'multi_fusion': 'makeMultiFusion',
    'sku_image': 'makeSkuImage',
    'local_redraw': 'makeLocalRedraw',
    'expand': 'makeExpand',
    'matting': 'makeMatting',
    'remove_watermark': 'makePlaceholder',
    'image_translate': 'makeImageTranslate',
    'enhance': 'makeEnhance',
    'recolor': 'makeRecolor',
    'rotate': 'makeRotate',
}

# 每个能力文件的表头注释
HEADERS = {
    'main_image': ('商品主图', '参考站 product-kit。上传商品图, 按变体类型生成主视觉套图。'),
    'detail_image': ('商品详情图', '参考站 product-detail。上传商品图, 按「包含模块」生成分区详情长图。'),
    'hot_remake': ('爆款复刻', '参考站 viral-clone。两张输入(商品图 + 参考图), 复刻爆款风格。'),
    'creative_image': ('创意生图', '参考站 creative-image。提示词驱动的创意视觉 (本地为参数化占位)。'),
    'multi_fusion': ('多图融合', '参考站 multi-image-fusion。主体图 + 搭配图合成一张主视觉。'),
    'sku_image': ('商品SKU图', '参考站 product-sku。按 SKU 清单批量出图。'),
    'local_redraw': ('局部重绘', '参考站 local-redraw。只重绘指定区域, 其余像素不变 (本地为占位)。'),
    'expand': ('智能扩图', '参考站 image-expand。向外延展画面并自然补全。'),
    'matting': ('一键抠图', '参考站 background-remove。分离主体与背景, 支持换底色。'),
    'remove_watermark': ('去除水印', '参考站 watermark-remove。清除水印与遮挡文字 (本地为模糊占位)。'),
    'image_translate': ('图片翻译', '参考站 image-translate。翻译图内文字并保持版式 (本地为占位)。'),
    'enhance': ('产品精修', '参考站 product-retouch。优化质感与细节, 6 种精修模式。'),
    'recolor': ('商品换色', '参考站 product-recolor。保持结构光影, 只换主体颜色。'),
    'rotate': ('旋转角度', '参考站 rotate-angle。三滑块(旋转/倾斜/缩放)改变展示视角。'),
    'free_create': ('自由创作', '参考站 free-creation。参考图(选填) + 提示词驱动, 已接优云智算 qwen-image-3.0。'),
}

# 选项集名 → 导出符号 (均为同名)
OPTION_SYMBOLS = [
    'PLATFORMS', 'LANGUAGES', 'RATIOS', 'RATIOS_WITH_ORIGINAL', 'BG_COLOR_OPTIONS',
    'EXPAND_POSITIONS', 'RETOUCH_MODES', 'FUSION_SCENARIOS', 'FUSION_VARIANT_COUNTS',
    'MAIN_IMAGE_VARIANTS', 'QUALITY_OPTIONS', 'DETAIL_SECTION_DEFAULTS', 'DETAIL_SECTIONS',
]

# 提示词公用片段
HELPERS = ['ratioText', 'sizeText', 'subjectText', 'refCountText']


def pascal(snake: str) -> str:
    return ''.join(p[:1].upper() + p[1:] for p in snake.split('_'))


def main() -> None:
    src = open(SRC, encoding='utf-8').read()
    m = re.search(r'export const CAPABILITIES: CapabilityDef\[\] = \[(.*)\n\];', src, re.S)
    if m is None:
        raise SystemExit(
            '本脚本依赖迁移前的单体 registry 结构, 而当前 registry 已是门面。\n'
            '它只作迁移记录, 不可重跑 —— 见文件头说明。\n'
            '若确需重跑, 请先恢复 registry 的定义本体 (注意: 它从未进入 git, 无备份)。',
        )
    body = m.group(1)
    blocks = re.findall(r'^  \{\n(.*?)^  \},$', body, re.S | re.M)
    assert len(blocks) == 15, f'期望 15 项能力, 实际 {len(blocks)}'

    gp = open(PROMPT_SRC, encoding='utf-8').read()
    os.makedirs(OUT, exist_ok=True)

    for blk in blocks:
        cid = re.search(r"id: '([a-z_]+)'", blk).group(1)
        title, desc = HEADERS[cid]

        # ---- 提示词: 取表达式体 (去掉 `cid: (p) =>` 前缀) ----
        # 两种写法都要支持:
        #   多行: `cid: (p) =>\n    \`…\` +\n    \`…\`,`
        #   单行: `cid: (p) => \`…\`,`            ← creative_image / sku_image 是这种
        pm = re.search(
            r'^  ' + cid + r': \(p\) => ?\n?(.*?)(?=,\n(?:  [a-z_]+: \(p\)|\};\s*$))',
            gp, re.S | re.M,
        )
        assert pm, f'{cid} 的提示词未找到'
        prompt_body = pm.group(1).rstrip().rstrip(',').rstrip()
        # 旧的 n(p) 隐式取参考图张数 → 改用显式入参 refCount
        prompt_body = re.sub(r'\bn\(p\)', 'refCountText(refCount)', prompt_body)
        # 提示词用到的公用片段
        helpers = [h for h in HELPERS if re.search(r'\b' + h + r'\(', prompt_body)]

        # ---- 抽取原块各字段 ----
        def field(name: str) -> str | None:
            m = re.search(r'^    ' + name + r':(.*?)(?=^    \w+:|\n    (?:params|//|/\*)|\Z)',
                          blk, re.S | re.M)
            return m.group(0).rstrip('\n') if m else None

        def field_raw(name: str) -> str:
            """取单行字段的原文 (如 mode: 'real',)"""
            m = re.search(r'^    ' + name + r':.*$', blk, re.M)
            return m.group(0) if m else ''

        credits = re.search(r'^    creditCost:.*$', blk, re.M)
        assert credits, f'{cid} 缺少 creditCost'

        params = field('params')
        assert params, f'{cid} 缺少 params'

        # 逐字段搬运 (保持原注释, 原样缩进到 2 空格)
        def reindent(text: str) -> str:
            return '\n'.join(ln[2:] if ln.startswith('  ') else ln for ln in text.split('\n'))

        def carry(name: str) -> str | None:
            """取单行字段原文并整体缩进到 2 空格 —— **保留末尾逗号**"""
            m = re.search(r'^    ' + name + r':.*$', blk, re.M)
            if not m:
                return None
            return '  ' + m.group(0).strip()

        carried = [x for x in (carry(f) for f in
                               ('name', 'group', 'summary', 'sidebarHint', 'badge', 'mode', 'creditCost', 'help'))
                   if x]

        # 用到的选项集 (params 内引用的)
        used_opts = [s for s in OPTION_SYMBOLS
                     if re.search(r'\b' + s + r'\b', params) or re.search(r'\b' + s + r'\b', prompt_body)]

        imports = ['import type { CapabilityPlugin } from \'../capability-plugin.type\';']
        syms = sorted(set(used_opts + helpers))
        if syms:
            imports.append(f"import {{ {', '.join(syms)} }} from './param-options';")

        # 入参名: PromptBuilder 的签名是 (params, refCount)
        # refCount 没用到时**必须保留 p 这个名字** —— 提示词体里通篇是 p.xxx,
        # 只给 refCount 改名会让 p 变成未定义。
        if 'refCount' in prompt_body:
            sig = '(p, refCount)'
        elif re.search(r'\bp\.', prompt_body):
            sig = '(p)'
        else:
            sig = '()'

        out = []
        out.append('/**')
        out.append(f' * {title} —— {desc}')
        out.append(' *')
        out.append(' * 2026-10-20 从 capability.registry.ts 抽离为独立文件。')
        out.append(' * 抽离的意义: 能力定义此前散在 registry / gateway-prompt / mock provider /')
        out.append(' * channel-config 四处, 新增一项要改四个文件且漏改不报错; 现在自包含在一个对象里,')
        out.append(' * 漏声明由 assertCapabilityIntegrity 在装配期拦下。')
        out.append(' */')
        out.append('')
        out.extend(imports)
        out.append('')
        out.append(f'export const {pascal(cid)}: CapabilityPlugin = {{')
        out.append(f"  id: '{cid}',")
        out.extend(carried)
        # params 数组 (原样搬运, 只缩进)
        out.append('  ' + reindent(params).strip() + ',')
        out.append(f'  buildPrompt: {sig} =>')
        plines = prompt_body.split('\n')
        for idx, ln in enumerate(plines):
            # 末行要补逗号 (下一个字段是 localImpl); 中间行原样
            tail = ',' if idx == len(plines) - 1 else ''
            out.append('    ' + ln.strip() + tail)
        out.append(f"  localImpl: '{LOCAL_IMPL[cid]}',")
        out.append("  modality: 'image',")
        out.append('  ' + re.search(r'^    inputs:.*$', blk, re.M).group(0).strip())
        out.append('  ' + re.search(r'^    inWorkbench:.*$', blk, re.M).group(0).strip())
        out.append('};')
        out.append('')

        open(os.path.join(OUT, f'{cid}.ts'), 'w', encoding='utf-8').write('\n'.join(out))
        print('写入', cid)

    print(f'\n共生成 {len(blocks)} 个文件 → {OUT}')


if __name__ == '__main__':
    main()