import { Maximize2 } from 'lucide-react';

import { MAX_REQUIREMENT_LEN, REQUIREMENT_PLACEHOLDER } from './constants';
import {
  Field,
  FieldGroup,
  FieldLabel,
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from './components';

/** 复刻要求（独立卡）+ 放大编辑入口。 */
export function ViralCloneRequirementCard({
  requirement,
  onRequirementChange,
  onExpand,
}: {
  requirement: string;
  onRequirementChange: (value: string) => void;
  onExpand: () => void;
}) {
  return (
    <section className="vc-requirement-section" aria-labelledby="vc-requirement-label">
      <FieldGroup>
        <Field className="gap-1.5">
          <FieldLabel id="vc-requirement-label" htmlFor="vc-requirement" className="text-sm font-semibold">
            复刻要求
          </FieldLabel>
          <InputGroup className="vc-requirement-input">
            <InputGroupTextarea
              id="vc-requirement"
              className="min-h-24 resize-none pr-12"
              rows={3}
              maxLength={MAX_REQUIREMENT_LEN}
              value={requirement}
              placeholder={REQUIREMENT_PLACEHOLDER}
              onChange={(e) => onRequirementChange(e.target.value)}
            />
            <InputGroupAddon align="inline-end" className="absolute top-2 right-2">
              <InputGroupButton
                size="icon-xs"
                variant="ghost"
                aria-label="放大编辑复刻要求"
                title="放大编辑"
                onClick={onExpand}
              >
                <Maximize2 />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </Field>
      </FieldGroup>
    </section>
  );
}
