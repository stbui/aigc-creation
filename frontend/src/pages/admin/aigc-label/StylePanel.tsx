import {
  ColorField,
  FormField,
  Notice,
  Panel,
  RangeField,
  SuggestField,
  SwitchField,
  TextField,
} from './components';
import { FONT_PRESETS } from './constants';
import { ChoiceButton } from './ChoiceButton';
import type { AigcLabelSpec } from '../../../types/api';

/**
 * 角标样式面板。
 *
 * 文案与字体由浏览器渲染成位图后保存；这里改的每一项都会触发预览重画，
 * 但只有点「保存并应用」才会写回服务端并重新生成位图。
 */
export function StylePanel({
  spec,
  editable,
  onPatch,
}: {
  spec: AigcLabelSpec;
  editable: boolean;
  onPatch: (next: Partial<AigcLabelSpec>) => void;
}) {
  return (
    <Panel title="样式">
      <div className="flex flex-col gap-4">
        <FormField
          label="显示可见角标"
          hint="关闭后产出图不再合成角标，但文件内的隐式标识（XMP / IPTC DigitalSourceType）仍照常写入。按《人工智能生成合成内容标识办法》，显式标识属法定义务，关闭前请自行确认适用场景与法律风险。"
        >
          <div className="flex items-center gap-2">
            <SwitchField
              checked={spec.enabled}
              onChange={(checked) => onPatch({ enabled: checked })}
              disabled={!editable}
              ariaLabel="显示可见角标"
            />
            <span className="text-xs text-muted-foreground">
              {spec.enabled ? '开启（默认）' : '已关闭：产出图不显示角标'}
            </span>
          </div>
          {!spec.enabled && (
            <Notice tone="danger" className="mt-2">
              关闭后仅保留隐式标识；产品图被转发到站外时，观看者将看不到「AI 生成」提示。
            </Notice>
          )}
        </FormField>

        <FormField label="角标文案" hint="最多 20 个字。用户下载/转发图片时会一起带走">
          <TextField
            value={spec.text}
            maxLength={20}
            onChange={(next) => onPatch({ text: next })}
            disabled={!editable}
            ariaLabel="角标文案"
          />
        </FormField>

        <FormField label="字体" hint="使用你本机已安装的字体；不同运营电脑的预览可能略有差异">
          <SuggestField
            value={spec.fontFamily}
            suggestions={FONT_PRESETS}
            onChange={(next) => onPatch({ fontFamily: next })}
            disabled={!editable}
            ariaLabel="字体"
          />
        </FormField>

        <FormField label="字号">
          <RangeField
            value={spec.fontSize}
            min={12}
            max={80}
            suffix="px（2x 基准）"
            onChange={(v) => onPatch({ fontSize: v })}
            disabled={!editable}
            ariaLabel="字号"
          />
        </FormField>

        <FormField label="字重">
          <div className="flex gap-2">
            {[400, 500, 600, 700].map((w) => (
              <ChoiceButton
                key={w}
                pressed={spec.fontWeight === w}
                disabled={!editable}
                onClick={() => onPatch({ fontWeight: w })}
              >
                {w}
              </ChoiceButton>
            ))}
          </div>
        </FormField>

        <FormField label="字距">
          <RangeField
            value={spec.letterSpacing}
            min={0}
            max={12}
            step={0.5}
            suffix="px"
            onChange={(v) => onPatch({ letterSpacing: v })}
            disabled={!editable}
            ariaLabel="字距"
          />
        </FormField>

        <FormField label="文字颜色">
          <ColorField
            value={spec.textColor}
            onChange={(v) => onPatch({ textColor: v })}
            disabled={!editable}
            ariaLabel="文字颜色"
          />
        </FormField>

        <FormField label="底色">
          <ColorField
            value={spec.backgroundColor}
            onChange={(v) => onPatch({ backgroundColor: v })}
            disabled={!editable}
            ariaLabel="底色"
          />
        </FormField>

        <FormField label="底色不透明度">
          <RangeField
            value={spec.backgroundOpacity}
            min={0}
            max={100}
            suffix="%"
            onChange={(v) => onPatch({ backgroundOpacity: v })}
            disabled={!editable}
            ariaLabel="底色不透明度"
          />
        </FormField>

        <FormField label="圆角">
          <RangeField
            value={spec.radius}
            min={0}
            max={60}
            suffix="px（2x 基准）"
            onChange={(v) => onPatch({ radius: v })}
            disabled={!editable}
            ariaLabel="圆角"
          />
        </FormField>

        <FormField label="水平内边距">
          <RangeField
            value={spec.paddingX}
            min={0}
            max={80}
            suffix="px（2x 基准）"
            onChange={(v) => onPatch({ paddingX: v })}
            disabled={!editable}
            ariaLabel="水平内边距"
          />
        </FormField>

        <FormField label="圆点" hint="留空 = 不画圆点">
          <ColorField
            value={spec.dotColor}
            onChange={(v) => onPatch({ dotColor: v })}
            disabled={!editable || !spec.dotColor}
            ariaLabel="圆点颜色"
          />
        </FormField>
      </div>
    </Panel>
  );
}
