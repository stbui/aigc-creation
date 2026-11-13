import { ToolCard, type ToolAsset, type WatermarkMaskRegion } from './components';
import { WatermarkRemoveAnnotationRow } from './WatermarkRemoveAnnotationRow';

interface WatermarkRemoveAnnotationPanelProps {
  regions: WatermarkMaskRegion[];
  sourceImage: ToolAsset | null;
  onRemove: (id: number) => void;
}

/**
 * 水印标记面板：按画布上的有效区域逐条展示裁切预览。
 *
 * 无区域时保留一条占位行，提示用户先在画布上框选。
 */
export function WatermarkRemoveAnnotationPanel({
  regions,
  sourceImage,
  onRemove,
}: WatermarkRemoveAnnotationPanelProps) {
  return (
    <ToolCard
      title={
        <>
          <i className="pk-required-mark u-font-14">*</i>水印标记
        </>
      }
      className="prompt-card watermark-mark-card"
    >
      {(regions.length > 0 ? regions : [null]).map((region, index) => (
        <WatermarkRemoveAnnotationRow
          key={region?.id ?? 'pending'}
          region={region}
          index={index}
          sourceImage={sourceImage}
          onRemove={onRemove}
        />
      ))}
    </ToolCard>
  );
}
