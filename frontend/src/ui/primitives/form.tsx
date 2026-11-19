import {
  createContext,
  useContext,
  useId,
  type ReactNode,
} from 'react';
import {
  Controller,
  FormProvider,
  useForm as useReactHookForm,
  useFormContext,
  useWatch as useReactHookWatch,
  type Control,
  type ControllerFieldState,
  type ControllerRenderProps,
  type FieldValues,
  type Path,
  type UseFormProps,
  type UseFormReturn,
} from 'react-hook-form';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '~/admin-ui/components/ui/field';
import { cn } from '../lib/cn';

/**
 * C 端表单：react-hook-form 的值仓库 + shadcn `Field` 的结构与无障碍关联。
 *
 * 字段值由 `Controller` 托管，`FormItem` 通过 render prop 把 `field` 交给控件，
 * 因此控件始终是受控的，不需要按 DOM 结构猜测 value 该注入到哪一层。
 */
/** 表单实例；对外保留 react-hook-form 的完整返回类型。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FormInstance<T extends FieldValues = any> = UseFormReturn<T>;

/** 单字段校验规则；命中第一条即停止，因此文案粒度与表单顺序一致。 */
export interface FormItemRule {
  required?: boolean;
  /** 字符串字段：只有空白字符也算空 */
  whitespace?: boolean;
  message?: string;
  type?: 'email';
  /** 字符串最小长度 */
  min?: number;
  /** 字符串最大长度 */
  max?: number;
  pattern?: RegExp;
  /** 自定义校验：返回文案表示失败，返回空表示通过 */
  validate?: (
    value: unknown,
    form: FormInstance,
  ) => string | void | Promise<string | void>;
}

const FormContext = createContext<UseFormReturn<FieldValues> | null>(null);

export function useForm<T extends FieldValues = FieldValues>(
  props?: UseFormProps<T>,
): FormInstance<T> {
  return useReactHookForm<T>(props);
}

/**
 * 订阅单个字段；可在 `<Form>` 之外使用（显式传入 `form`）。
 *
 * 例：登录卡在表单外根据手机号决定是否渲染验证码字段。
 */
export function useWatch<T extends FieldValues = FieldValues>(
  name: Path<T> | string,
  form?: FormInstance<T>,
): unknown {
  const local = useContext(FormContext);
  const target = (form ?? local) as UseFormReturn<FieldValues> | null;
  if (!target) throw new Error('useWatch 必须在 Form 内使用，或显式传入 form');
  return useReactHookWatch({
    control: target.control,
    name: name as Path<FieldValues>,
  });
}

async function runRules(
  rules: FormItemRule[],
  value: unknown,
  form: FormInstance,
): Promise<string | null> {
  for (const rule of rules) {
    const message = rule.message ?? '请填写此项';
    const empty = value === undefined || value === null || value === '';
    if (rule.required) {
      if (empty || (rule.whitespace && typeof value === 'string' && !value.trim())) {
        return message;
      }
    }
    if (typeof value === 'string') {
      if (rule.type === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        return message;
      }
      if (rule.min !== undefined && value.length < rule.min) {
        return message;
      }
      if (rule.max !== undefined && value.length > rule.max) {
        return message;
      }
      if (rule.pattern && !rule.pattern.test(value)) {
        return message;
      }
    }
    if (rule.validate) {
      const result = await rule.validate(value, form);
      if (result) return result;
    }
  }
  return null;
}

export interface FormProps<T extends FieldValues = FieldValues> {
  form: FormInstance<T>;
  children?: ReactNode;
  className?: string;
  /** 校验通过后调用；按钮用 `type="submit"` 触发 */
  onSubmit?: (values: T) => void | Promise<void>;
  'aria-label'?: string;
}

/** 表单根：接住提交、下发表单实例，布局类由调用方传 `className`。 */
export function Form<T extends FieldValues = FieldValues>({
  form,
  children,
  className,
  onSubmit,
  'aria-label': ariaLabel,
}: FormProps<T>) {
  return (
    <FormContext.Provider value={form as UseFormReturn<FieldValues>}>
      <FormProvider {...form}>
        <form
          className={cn('ui-form', className)}
          aria-label={ariaLabel}
          noValidate
          onSubmit={
            onSubmit
              ? form.handleSubmit((values) => onSubmit(values as T))
              : (event) => event.preventDefault()
          }
        >
          {children}
        </form>
      </FormProvider>
    </FormContext.Provider>
  );
}

export interface FormItemRenderArgs {
  field: ControllerRenderProps<FieldValues, string>;
  fieldState: ControllerFieldState;
  form: FormInstance;
}

export interface FormItemProps {
  name: string;
  label?: ReactNode;
  /** 标签旁的帮助文案；有错误时让位给错误信息 */
  description?: ReactNode;
  rules?: FormItemRule[];
  className?: string;
  /** 控件由 render prop 提供，`field` 已包含 value / onChange / onBlur / ref */
  children: (args: FormItemRenderArgs) => ReactNode;
}

/** 单个字段：标签 / 控件 / 帮助与错误信息的关系在此一次性建立。 */
export function FormItem({
  name,
  label,
  description,
  rules,
  className,
  children,
}: FormItemProps) {
  const form = useContext(FormContext);
  const formFromProvider = useFormContext<FieldValues>();
  const instance = (form ?? formFromProvider) as FormInstance;
  const generatedId = useId();
  const controlId = `${generatedId}-control`;
  const descriptionId = `${generatedId}-description`;
  const errorId = `${generatedId}-error`;

  return (
    <Controller
      control={instance.control}
      name={name}
      rules={
        rules?.length
          ? {
              validate: async (value) => (await runRules(rules, value, instance)) ?? undefined,
            }
          : undefined
      }
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid || undefined} className={className}>
          {label && (
            <FieldLabel htmlFor={controlId} className="ui-form-label">
              {label}
            </FieldLabel>
          )}
          {children({
            field: {
              ...field,
              id: controlId,
              'aria-invalid': fieldState.invalid || undefined,
              'aria-describedby': fieldState.error
                ? errorId
                : description
                  ? descriptionId
                  : undefined,
            } as ControllerRenderProps<FieldValues, string>,
            fieldState,
            form: instance,
          })}
          {fieldState.error ? (
            <FieldError id={errorId} errors={[fieldState.error]} className="ui-form-error" />
          ) : (
            description && (
              <FieldDescription id={descriptionId} className="ui-form-description">
                {description}
              </FieldDescription>
            )
          )}
        </Field>
      )}
    />
  );
}
