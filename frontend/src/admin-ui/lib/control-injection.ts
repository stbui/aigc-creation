import {
  Children,
  Fragment,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react';

type ControlProps = Record<string, unknown> & {
  id?: string;
  children?: ReactNode;
};

const DOM_CONTROL_TAGS = new Set(['input', 'select', 'textarea']);

function isControlElement(element: ReactElement<ControlProps>) {
  if (typeof element.type === 'string') return DOM_CONTROL_TAGS.has(element.type);
  return element.type !== Fragment;
}

/**
 * 找到布局容器中第一个真正的复合控件，并返回它已有的 id。
 *
 * 表单字段经常把控件包在布局 div 里；只检查直接子元素会把 id 注入到
 * 容器上。这里和 `injectPropsIntoFirstControl` 使用同一套遍历规则。
 */
export function findFirstControlId(node: ReactNode): string | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const id = findFirstControlId(child);
      if (id) return id;
    }
    return undefined;
  }
  if (!isValidElement(node)) return undefined;

  const element = node as ReactElement<ControlProps>;
  if (isControlElement(element)) {
    return typeof element.props.id === 'string' ? element.props.id : undefined;
  }
  return findFirstControlId(element.props.children);
}

/**
 * 把属性注入第一个复合控件，保留布局容器和同级按钮不变。
 *
 * 已有 `id` 不会被覆盖；没有 `id` 时才使用调用方提供的 fallback，确保
 * `<label htmlFor>` 能指到真正可聚焦的控件。
 */
export function injectPropsIntoFirstControl(
  node: ReactNode,
  props: Record<string, unknown>,
  fallbackId?: string,
): ReactNode {
  const [next, injected] = injectIntoFirst(node, props, fallbackId);
  return injected ? next : node;
}

function injectIntoFirst(
  node: ReactNode,
  props: Record<string, unknown>,
  fallbackId?: string,
): [ReactNode, boolean] {
  if (Array.isArray(node)) {
    let injected = false;
    const mapped = node.map((child) => {
      if (injected) return child;
      const [next, did] = injectIntoFirst(child, props, fallbackId);
      if (did) injected = true;
      return next;
    });
    return [mapped, injected];
  }
  if (!isValidElement(node)) return [node, false];

  const element = node as ReactElement<ControlProps>;
  if (isControlElement(element)) {
    const nextProps = {
      ...props,
      ...(element.props.id === undefined && fallbackId ? { id: fallbackId } : {}),
    };
    return [cloneElement(element, nextProps), true];
  }

  if (element.props.children === undefined) return [node, false];
  let injected = false;
  const mapped = Children.map(element.props.children, (child) => {
    if (injected) return child;
    const [next, did] = injectIntoFirst(child, props, fallbackId);
    if (did) injected = true;
    return next;
  });
  if (!injected) return [node, false];
  return [cloneElement(element, {}, mapped), true];
}
