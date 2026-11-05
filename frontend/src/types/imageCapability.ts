/** 协议声明的图片参数；后台只能改 `enabled` 与 `values`。 */
export interface ImageParameterDefinitionView {
  name: string;
  label: string;
  type: string;
  description?: string;
  values?: unknown[];
  min?: number;
  max?: number;
  step?: number;
  maxLength?: number;
  default?: unknown;
  required?: boolean;
  pricing?: boolean;
  binding?: string;
  encoding?: string;
  models?: string[];
  enabled?: boolean;
}
