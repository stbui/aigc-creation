import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { cn } from '../lib/cn';

/**
 * C 端表单兼容层。
 *
 * 保留 antd Form 最常用的三件事：字段收集、提交校验、布局。
 * 控件值通过 FormItem 注入；未注入时仍可完全受控使用。
 *
 * 与 antd 的一处关键差异：`useForm()` 返回的是**稳定的外部实例**，
 * 值存放在实例自己的 store 里（`useSyncExternalStore` 订阅），而不是
 * 只活在 `<Form>` 内部。这样 `useWatch` / `form.getFieldValue` 在
 * `<Form>` 之外（如 AuthCard 的「发送验证码」）也能读到用户刚输入的值。
 */
export interface Rule {
  required?: boolean;
  message?: string;
  type?: 'email';
  min?: number;
  max?: number;
  whitespace?: boolean;
  pattern?: RegExp;
  validator?: (rule: Rule, value: unknown, form: FormInstance) => Promise<void> | void;
  dependencies?: string[];
}

export interface FormInstance {
  setFieldsValue: (values: Record<string, unknown>) => void;
  getFieldValue: (name: string) => unknown;
  getFieldsValue: () => Record<string, unknown>;
  resetFields: (names?: string[]) => void;
  setFields: (fields: Array<{ name: string; errors: string[] }>) => void;
}

interface FormSnapshot {
  values: Record<string, unknown>;
  errors: Record<string, string>;
}

type Listener = () => void;

/**
 * 表单值仓库。实例稳定、订阅式读取，避免把值绑在某个 React 组件的
 * state 上 —— 那样 `<Form>` 一重渲染，外部实例就拿不到最新值。
 */
class FormStore {
  values: Record<string, unknown> = {};
  initialValues: Record<string, unknown> = {};
  errors: Record<string, string> = {};
  rules = new Map<string, Rule[]>();
  listeners = new Set<Listener>();
  snapshot: FormSnapshot = { values: this.values, errors: this.errors };
  instance: FormInstance;

  constructor() {
    this.instance = {
      setFieldsValue: (next) => this.setValues(next),
      getFieldValue: (name) => this.values[name],
      getFieldsValue: () => this.values,
      resetFields: (names) => this.reset(names),
      setFields: (fields) => {
        const next = { ...this.errors };
        for (const field of fields) {
          if (field.errors?.[0]) next[field.name] = field.errors[0];
          else delete next[field.name];
        }
        this.errors = next;
        this.publish();
      },
    };
    storeRegistry.set(this.instance, this);
  }

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.snapshot;

  /** 在首次渲染、尚未有人订阅时灌入初始值。 */
  init(initialValues?: Record<string, unknown>) {
    if (!initialValues) return;
    this.initialValues = { ...initialValues };
    if (Object.keys(this.values).length === 0) {
      this.values = { ...initialValues };
      this.snapshot = { values: this.values, errors: this.errors };
    }
  }

  setValues(next: Record<string, unknown>) {
    this.values = { ...this.values, ...next };
    this.publish();
  }

  setValue(name: string, value: unknown) {
    this.values = { ...this.values, [name]: value };
    this.publish();
  }

  reset(names?: string[]) {
    if (!names) {
      this.values = { ...this.initialValues };
      this.errors = {};
      this.publish();
      return;
    }
    const next = { ...this.values };
    const nextErrors = { ...this.errors };
    for (const name of names) {
      delete next[name];
      delete nextErrors[name];
    }
    this.values = next;
    this.errors = nextErrors;
    this.publish();
  }

  setErrors(next: Record<string, string>) {
    this.errors = next;
    this.publish();
  }

  registerRules(name: string, rules?: Rule[]) {
    if (!rules || rules.length === 0) this.rules.delete(name);
    else this.rules.set(name, rules);
  }

  private publish() {
    this.snapshot = { values: this.values, errors: this.errors };
    for (const listener of this.listeners) listener();
  }
}

const storeRegistry = new WeakMap<FormInstance, FormStore>();

function storeOf(instance: FormInstance): FormStore {
  const store = storeRegistry.get(instance);
  if (!store) throw new Error('Form 实例缺少内部 store');
  return store;
}

interface FormContextValue {
  instance: FormInstance;
  values: Record<string, unknown>;
  errors: Record<string, string>;
  setValue: (name: string, value: unknown) => void;
  registerRules: (name: string, rules?: Rule[]) => void;
}

const FormContext = createContext<FormContextValue | null>(null);

export function useForm<T extends object = Record<string, unknown>>(): [
  FormInstance,
  (values: T) => void,
] {
  const storeRef = useRef<FormStore | null>(null);
  if (!storeRef.current) storeRef.current = new FormStore();
  const store = storeRef.current;
  const setValues = useCallback(
    (values: T) => store.setValues(values as Record<string, unknown>),
    [store],
  );
  return [store.instance, setValues];
}

const NOOP_SUBSCRIBE = () => () => undefined;

/** 观察单个字段；可在 `<Form>` 之外使用（AuthCard 的注册手机号联动）。 */
export function useWatch(name: string, form?: FormInstance): unknown {
  const ctx = useContext(FormContext);
  const instance = form ?? ctx?.instance;
  const store = instance ? storeOf(instance) : null;
  const subscribe = store ? store.subscribe : NOOP_SUBSCRIBE;
  const getSnapshot = store ? () => store.getSnapshot().values[name] : () => undefined;
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function Form<T extends object = Record<string, unknown>>({
  children,
  onFinish,
  initialValues,
  className,
  layout,
  form,
}: {
  children?: ReactNode;
  onFinish?: (values: T) => void | Promise<void>;
  initialValues?: Partial<T>;
  className?: string;
  layout?: 'horizontal' | 'vertical';
  requiredMark?: boolean;
  form?: FormInstance;
}) {
  const [internal] = useForm();
  const instance = form ?? internal;
  const store = storeOf(instance);
  const initialized = useRef(false);
  if (!initialized.current) {
    initialized.current = true;
    store.init(initialValues as Record<string, unknown> | undefined);
  }
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  const registerRules = useCallback(
    (name: string, rules?: Rule[]) => store.registerRules(name, rules),
    [store],
  );

  const value = useMemo<FormContextValue>(
    () => ({
      instance,
      values: snapshot.values,
      errors: snapshot.errors,
      setValue: (name, next) => store.setValue(name, next),
      registerRules,
    }),
    [instance, snapshot, store, registerRules],
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const nextErrors = await validate(store);
    store.setErrors(nextErrors);
    if (Object.keys(nextErrors).length === 0) {
      await onFinish?.(store.values as unknown as T);
    }
  };

  return (
    <FormContext.Provider value={value}>
      <form
        className={cn('ui-form', layout === 'vertical' && 'is-vertical', className)}
        onSubmit={(event) => void submit(event)}
      >
        {children}
      </form>
    </FormContext.Provider>
  );
}

/** 按字段顺序执行规则；同一字段命中第一条错误即停止。 */
async function validate(store: FormStore): Promise<Record<string, string>> {
  const nextErrors: Record<string, string> = {};
  for (const [name, rules] of store.rules.entries()) {
    const fieldValue = store.values[name];
    for (const rule of rules) {
      if (rule.validator) {
        try {
          await rule.validator(rule, fieldValue, store.instance);
        } catch (error) {
          nextErrors[name] = error instanceof Error ? error.message : '校验失败';
          break;
        }
      }
      const empty = fieldValue === undefined || fieldValue === null || fieldValue === '';
      if (
        rule.required &&
        (empty || (rule.whitespace && typeof fieldValue === 'string' && !fieldValue.trim()))
      ) {
        nextErrors[name] = rule.message ?? '请填写此项';
        break;
      }
      if (typeof fieldValue === 'string') {
        if (rule.type === 'email' && fieldValue && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fieldValue)) {
          nextErrors[name] = rule.message ?? '格式不正确';
          break;
        }
        if (rule.min !== undefined && fieldValue.length < rule.min) {
          nextErrors[name] = rule.message ?? `至少 ${rule.min} 位`;
          break;
        }
        if (rule.max !== undefined && fieldValue.length > rule.max) {
          nextErrors[name] = rule.message ?? `最多 ${rule.max} 个字符`;
          break;
        }
        if (rule.pattern && !rule.pattern.test(fieldValue)) {
          nextErrors[name] = rule.message ?? '格式不正确';
          break;
        }
      }
    }
  }
  return nextErrors;
}

export function FormItem({
  name,
  label,
  children,
  className,
  rules,
  valuePropName = 'value',
  tooltip,
  noStyle,
  shouldUpdate: _shouldUpdate,
}: {
  name?: string;
  label?: ReactNode;
  children: ReactNode | ((form: FormInstance) => ReactNode);
  className?: string;
  rules?: Rule[];
  valuePropName?: string;
  tooltip?: ReactNode;
  noStyle?: boolean;
  shouldUpdate?: (prev: Record<string, unknown>, next: Record<string, unknown>) => boolean;
}) {
  const form = useContext(FormContext);
  if (!form) throw new Error('FormItem 必须在 Form 内使用');

  // rules 每次都可能是新数组；注册是幂等的，清理时按字段移除即可。
  useEffect(() => {
    if (!name) return;
    form.registerRules(name, rules);
    return () => form.registerRules(name);
  }, [form, name, rules]);

  if (typeof children === 'function') {
    return <>{children(form.instance)}</>;
  }

  const error = name ? form.errors[name] : undefined;
  const rawValue = name ? form.values[name] : undefined;
  const injected = name
    ? injectControl(children, valuePropName, valuePropName === 'checked' ? Boolean(rawValue) : rawValue, (next) =>
        form.setValue(name, next),
      )
    : children;

  if (noStyle) return <>{injected}</>;

  return (
    <div className={cn('ui-form-item', className)}>
      {label && (
        <label className="ui-form-label ant-form-item-label">
          <span>{label}</span>
        </label>
      )}
      {tooltip && <span className="ui-form-tooltip">{tooltip}</span>}
      <div className="ui-form-control">
        {injected}
        {error && <span className="ui-form-error ant-form-item-explain-error">{error}</span>}
      </div>
    </div>
  );
}

/**
 * 把 `value` / `onChange` 注入到可受控的元素里。
 *
 * FormItem 的子节点经常是布局容器（例如登录验证码的 `.login-code-row`
 * 里同时放输入框和「获取验证码」按钮）。antd 只克隆直接子元素，容器
 * 本身不消费 value，输入框就永远拿不到值。这里对 DOM 容器向下找到
 * **第一个组件节点**再注入，同时保持按钮等兄弟节点不受影响。
 */
function injectControl(
  children: ReactNode,
  propName: string,
  value: unknown,
  onChange: (next: unknown) => void,
): ReactNode {
  const props: Record<string, unknown> = {
    [propName]: value,
    onChange: (eventOrValue: unknown) => {
      if (eventOrValue && typeof eventOrValue === 'object' && 'target' in eventOrValue) {
        const target = (eventOrValue as { target: { value?: unknown; checked?: boolean } }).target;
        onChange(propName === 'checked' ? target.checked : (target.value ?? target.checked));
        return;
      }
      onChange(eventOrValue);
    },
  };
  const [node, injected] = injectIntoFirst(children, props);
  if (injected) return node;
  return children;
}

function injectIntoFirst(
  node: ReactNode,
  props: Record<string, unknown>,
): [ReactNode, boolean] {
  if (Array.isArray(node)) {
    let injected = false;
    const mapped = node.map((child) => {
      if (injected) return child;
      const [next, did] = injectIntoFirst(child, props);
      if (did) injected = true;
      return next;
    });
    return [mapped, injected];
  }
  if (!isValidElement(node)) return [node, false];

  const element = node as ReactElement<{ children?: ReactNode }>;
  if (typeof element.type !== 'string') {
    return [cloneElement(element as ReactElement<Record<string, any>>, props), true];
  }

  if (element.props.children === undefined) return [node, false];
  let injected = false;
  const mapped = Children.map(element.props.children, (child) => {
    if (injected) return child;
    const [next, did] = injectIntoFirst(child, props);
    if (did) injected = true;
    return next;
  });
  if (!injected) return [node, false];
  return [cloneElement(element, {}, mapped), true];
}

Form.Item = FormItem;
Form.useForm = useForm;
