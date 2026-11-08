import { Descriptions, FieldDescription, FieldLegend, FieldSet } from '~/admin-ui/primitives';
import type { ImageCapabilityConfigView } from './imageCapability';

/** 参数编辑后的派生合同快照，帮助运营确认最终会保存成什么。 */
export function ChannelModelImageDerivedSummary({
  image,
}: {
  image: ImageCapabilityConfigView;
}) {
  return (
    <FieldSet className="gap-3">
      <div>
        <FieldLegend variant="label">自动派生设置</FieldLegend>
        <FieldDescription>以下设置会随能力参数实时更新，保存后自动生效。</FieldDescription>
      </div>
      <Descriptions
        columns={3}
        items={[
          {
            label: '尺寸参数',
            value:
              image.size.parameter === 'none'
                ? '不发送'
                : image.size.parameter === 'aspect_ratio'
                  ? '宽高比'
                  : '像素尺寸',
          },
          {
            label: '尺寸值',
            value: image.size.allowCustom ? '允许自定义' : image.size.values.join('、') || '—',
          },
          { label: '默认尺寸', value: image.size.default || '—' },
          {
            label: '分辨率',
            value: image.resolution.supported
              ? image.resolution.values.join('、') || '—'
              : '不支持',
          },
          {
            label: '质量',
            value: image.quality.supported ? image.quality.values.join('、') || '—' : '不支持',
          },
          { label: '单次最大输出', value: `${image.maxOutputs} 张` },
          {
            label: '透明背景',
            value: image.transparentBackground.supported
              ? image.transparentBackground.default
                ? '支持，默认开启'
                : '支持，默认关闭'
              : '不支持',
          },
        ]}
      />
    </FieldSet>
  );
}
