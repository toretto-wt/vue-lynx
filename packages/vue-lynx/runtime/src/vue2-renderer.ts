// Copyright 2026 Xuan Huang (huxpro). All rights reserved.
// Licensed under the Apache License Version 2.0 that can be found in the
// LICENSE file in the root directory of this source tree.

import Vue from 'vue';
import type { VNode, VNodeData, VNodeDirective, VueConstructor } from 'vue';

import { nodeOps } from './node-ops.js';
import type { ShadowElement } from './shadow-element.js';

type LynxVNode = Omit<VNode, 'elm' | 'children' | 'componentInstance'> & {
  elm?: ShadowElement;
  children?: LynxVNode[];
  componentInstance?: Vue & { $el: ShadowElement };
};

type VueLynxInstance = Vue & {
  __vueLynxRoot?: ShadowElement;
};

const installed = new WeakSet<VueConstructor>();
const hasOwnProperty = Object.prototype.hasOwnProperty;

export function installVue2Renderer(
  VueCtor: VueConstructor = Vue as unknown as VueConstructor,
): void {
  if (installed.has(VueCtor)) return;
  installed.add(VueCtor);

  (VueCtor.prototype as unknown as {
    __patch__: (
      this: VueLynxInstance,
      oldVnode?: LynxVNode | ShadowElement | null,
      vnode?: LynxVNode | null,
    ) => ShadowElement | undefined;
  }).__patch__ = function vueLynxPatch(oldVnode, vnode) {
    if (!vnode) {
      if (isLynxElement(oldVnode)) {
        nodeOps.remove(oldVnode);
      } else if (oldVnode?.elm) {
        nodeOps.remove(oldVnode.elm);
        destroyVnode(oldVnode);
      }
      return undefined;
    }

    if (!oldVnode || isLynxElement(oldVnode)) {
      const el = createElm(vnode);
      const root = this.__vueLynxRoot;
      if (root) {
        nodeOps.insert(el, root, null);
        invokeInsertHook(vnode);
      }
      return el;
    }

    if (sameVnode(oldVnode, vnode)) {
      patchVnode(oldVnode, vnode);
      return vnode.elm;
    }

    const parent = oldVnode.elm?.parent ?? this.__vueLynxRoot ?? null;
    const anchor = oldVnode.elm?.next ?? null;
    const el = createElm(vnode);
    if (parent) {
      nodeOps.insert(el, parent, anchor);
      invokeInsertHook(vnode);
      if (oldVnode.elm) nodeOps.remove(oldVnode.elm);
    }
    destroyVnode(oldVnode);
    return el;
  };
}

function isLynxElement(value: unknown): value is ShadowElement {
  return Boolean(value && typeof value === 'object' && 'id' in value && 'type' in value);
}

function sameVnode(a: LynxVNode, b: LynxVNode): boolean {
  return a.key === b.key
    && a.tag === b.tag
    && a.isComment === b.isComment
    && Boolean(a.componentOptions) === Boolean(b.componentOptions);
}

function createElm(vnode: LynxVNode): ShadowElement {
  if (createComponent(vnode)) {
    return vnode.elm!;
  }

  if (vnode.isComment) {
    const el = nodeOps.createComment(vnode.text ?? '');
    vnode.elm = el;
    return el;
  }

  if (vnode.tag) {
    const el = nodeOps.createElement(vnode.tag);
    vnode.elm = el;
    patchData(el, undefined, vnode.data);
    const text = getSingleTextChild(vnode.children);
    if (text != null) {
      nodeOps.setElementText(el, text);
    } else if ((vnode.children?.length ?? 0) > 0) {
      for (const child of vnode.children!) {
        insertChild(child, el, null);
      }
    } else if (vnode.text) {
      nodeOps.setElementText(el, vnode.text);
    }
    return el;
  }

  const el = nodeOps.createText(vnode.text ?? '');
  vnode.elm = el;
  return el;
}

function createComponent(vnode: LynxVNode): boolean {
  const init = vnode.data?.hook?.init;
  if (init) {
    init(vnode, false);
  }
  if (vnode.componentInstance) {
    vnode.elm = vnode.componentInstance.$el;
    return true;
  }
  return false;
}

function insertChild(
  vnode: LynxVNode,
  parent: ShadowElement,
  anchor: ShadowElement | null,
): void {
  const el = createElm(vnode);
  nodeOps.insert(el, parent, anchor);
  invokeInsertHook(vnode);
}

function patchVnode(oldVnode: LynxVNode, vnode: LynxVNode): void {
  if (oldVnode === vnode) return;

  const prepatch = vnode.data?.hook?.prepatch;
  if (oldVnode.componentOptions || vnode.componentOptions) {
    prepatch?.(oldVnode, vnode);
    vnode.elm = vnode.componentInstance?.$el ?? oldVnode.elm;
    return;
  }

  const el = oldVnode.elm;
  vnode.elm = el;
  if (!el) return;

  patchData(el, oldVnode.data, vnode.data);

  const text = getSingleTextChild(vnode.children);
  if (text != null) {
    replaceChildren(el, oldVnode.children ?? [], []);
    nodeOps.setElementText(el, text);
    return;
  }

  if (vnode.text != null && (vnode.children?.length ?? 0) === 0) {
    if (vnode.text !== oldVnode.text) {
      if (vnode.tag) nodeOps.setElementText(el, vnode.text);
      else nodeOps.setText(el, vnode.text);
    }
    return;
  }

  replaceChildren(el, oldVnode.children ?? [], vnode.children ?? []);
}

function getSingleTextChild(children: LynxVNode[] | undefined): string | null {
  if (!children || children.length !== 1) return null;
  const child = children[0]!;
  if (child.tag || child.componentOptions || child.isComment) return null;
  return child.text ?? '';
}

function replaceChildren(
  parent: ShadowElement,
  oldChildren: LynxVNode[],
  newChildren: LynxVNode[],
): void {
  for (const child of oldChildren) {
    if (child.elm) nodeOps.remove(child.elm);
    destroyVnode(child);
  }
  for (const child of newChildren) {
    insertChild(child, parent, null);
  }
}

function destroyVnode(vnode: LynxVNode): void {
  vnode.data?.hook?.destroy?.(vnode);
  if (vnode.children) {
    for (const child of vnode.children) destroyVnode(child);
  }
}

function invokeInsertHook(vnode: LynxVNode): void {
  vnode.data?.hook?.insert?.(vnode);
  if (vnode.children) {
    for (const child of vnode.children) invokeInsertHook(child);
  }
}

function patchData(
  el: ShadowElement,
  oldData: VNodeData | undefined,
  data: VNodeData | undefined,
): void {
  const oldProps = normalizeDataProps(oldData);
  const nextProps = normalizeDataProps(data);

  for (const key of Object.keys(oldProps)) {
    if (!hasOwnProperty.call(nextProps, key)) {
      nodeOps.patchProp(el, key, oldProps[key], null);
    }
  }

  for (const key of Object.keys(nextProps)) {
    const prev = oldProps[key];
    const next = nextProps[key];
    if (next !== prev) {
      nodeOps.patchProp(el, key, prev, next);
    }
  }
}

export function normalizeDataProps(
  data: VNodeData | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!data) return out;

  assignRecord(out, data.attrs);
  assignRecord(out, data.props);
  assignRecord(out, data.domProps);

  const className = stringifyClass(data.staticClass, data.class);
  if (className) out.class = className;

  const style = normalizeStyleData(data.staticStyle, data.style);
  if (style) out.style = style;

  assignListeners(out, data.on);
  assignListeners(out, data.nativeOn);
  applyDirectiveProps(out, data);

  if (data.show === false) {
    out.style = { ...(out.style as Record<string, unknown> | undefined), display: 'none' };
  }

  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (
      key === 'attrs'
      || key === 'props'
      || key === 'domProps'
      || key === 'hook'
      || key === 'on'
      || key === 'nativeOn'
      || key === 'class'
      || key === 'staticClass'
      || key === 'style'
      || key === 'staticStyle'
      || key === 'directives'
      || key === 'scopedSlots'
      || key === 'slot'
      || key === 'key'
      || key === 'ref'
      || key === 'refInFor'
      || key === 'tag'
      || key === 'show'
      || key === 'transition'
      || key === 'keepAlive'
      || key === 'inlineTemplate'
    ) {
      continue;
    }
    out[key] = value;
  }

  return out;
}

function assignRecord(
  out: Record<string, unknown>,
  value: Record<string, unknown> | undefined,
): void {
  if (!value) return;
  for (const key of Object.keys(value)) {
    out[key] = value[key];
  }
}

function assignListeners(
  out: Record<string, unknown>,
  listeners: Record<string, unknown> | undefined,
): void {
  if (!listeners) return;
  for (const rawName of Object.keys(listeners)) {
    const name = rawName.replace(/^[!~&]+/, '');
    if (name.startsWith('update:')) continue;
    out[`on${name.charAt(0).toUpperCase()}${name.slice(1)}`] = listeners[rawName];
  }
}

function applyDirectiveProps(
  out: Record<string, unknown>,
  data: VNodeData,
): void {
  if (!data.directives || data.directives.length === 0) return;
  for (const directive of data.directives) {
    if (!isVueLynxVModelText(directive)) continue;
    const modifiers = directive.modifiers ?? {};
    const eventName = modifiers.lazy ? 'confirm' : 'input';
    const eventProp = `on${eventName.charAt(0).toUpperCase()}${eventName.slice(1)}`;
    const userHandler = out[eventProp];
    const assign = getModelAssigner(data.on);

    out.value = directive.value == null ? '' : String(directive.value);
    out[eventProp] = (eventData: unknown) => {
      const evt = eventData as {
        detail?: { value?: string; isComposing?: boolean };
      };
      if (evt?.detail?.isComposing) return;

      let value = evt?.detail?.value ?? '';
      if (modifiers.trim) value = value.trim();
      assign(modifiers.number ? looseToNumber(value) : value);
      invokeHandler(userHandler, eventData);
    };
  }
}

function isVueLynxVModelText(directive: VNodeDirective): boolean {
  return Boolean(
    directive.def
      && typeof directive.def === 'object'
      && '__vueLynxVModelText' in directive.def,
  );
}

function getModelAssigner(
  listeners: Record<string, unknown> | undefined,
): (value: unknown) => void {
  const handler = listeners?.['update:modelValue'];
  return (value: unknown) => invokeHandler(handler, value);
}

function invokeHandler(handler: unknown, payload: unknown): void {
  if (Array.isArray(handler)) {
    for (const fn of handler) {
      if (typeof fn === 'function') fn(payload);
    }
  } else if (typeof handler === 'function') {
    handler(payload);
  }
}

function looseToNumber(value: string): number | string {
  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? value : parsed;
}

function normalizeStyleData(
  staticStyle: Record<string, unknown> | undefined,
  style: VNodeData['style'],
): Record<string, unknown> | string | undefined {
  if (!staticStyle && !style) return undefined;
  if (typeof style === 'string') return style;
  const out: Record<string, unknown> = { ...(staticStyle ?? {}) };
  if (Array.isArray(style)) {
    for (const item of style) {
      if (item && typeof item === 'object') assignRecord(out, item as Record<string, unknown>);
    }
  } else if (style && typeof style === 'object') {
    assignRecord(out, style as Record<string, unknown>);
  }
  return out;
}

function stringifyClass(...values: unknown[]): string {
  const classes: string[] = [];
  for (const value of values) appendClass(classes, value);
  return classes.join(' ');
}

function appendClass(classes: string[], value: unknown): void {
  if (!value) return;
  if (typeof value === 'string') {
    classes.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) appendClass(classes, item);
  } else if (typeof value === 'object') {
    for (const [key, enabled] of Object.entries(value)) {
      if (enabled) classes.push(key);
    }
  }
}
