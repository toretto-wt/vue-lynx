// Copyright 2026 Xuan Huang (huxpro). All rights reserved.
// Licensed under the Apache License Version 2.0 that can be found in the
// LICENSE file in the root directory of this source tree.

/**
 * vue-lynx
 *
 * Vue 2.7 runtime adapter for Lynx's Background Thread.
 */

import Vue, {
  getCurrentInstance,
  h as vueH,
  nextTick as vueNextTick,
  unref,
} from 'vue';
import type {
  Component,
  ComponentPublicInstance,
  DirectiveOptions,
  ObjectDirective,
  VNode,
  VNodeData,
  CreateElement,
  RenderContext,
  VueConstructor,
} from 'vue';

import { runOnMainThread } from './cross-thread.js';
import { resetRegistry } from './event-registry.js';
import { flushNow, resetFlushState, scheduleFlush, waitForFlush } from './flush.js';
import { resetFunctionCallState } from './function-call.js';
import {
  MainThreadRef,
  resetMainThreadRefState,
  useMainThreadRef,
} from './main-thread-ref.js';
import { nodeOps, resetNodeOpsState } from './node-ops.js';
import { OP, pushOp, takeOps } from './ops.js';
import {
  resetRunOnBackgroundState,
  runOnBackground,
} from './run-on-background.js';
import { ShadowElement, createPageRoot } from './shadow-element.js';
import { transformToWorklet } from './transform-to-worklet.js';
import { Transition } from './Transition.js';
import { TransitionGroup } from './TransitionGroup.js';
import { installVue2Renderer } from './vue2-renderer.js';

export type { Component, ComponentPublicInstance, VNode };

const VueCtor = Vue as unknown as VueConstructor;
const hasOwnProperty = Object.prototype.hasOwnProperty;

installVue2Renderer(VueCtor);

/** @internal Vue 2 renderer entry used by tests. */
export function _render(vnode: VNode | null, container: ShadowElement): void {
  const vm = new VueCtor({
    render() {
      return vnode as VNode;
    },
  }) as Vue & { __vueLynxRoot?: ShadowElement };
  vm.__vueLynxRoot = container;
  vm.$mount();
  flushNow();
}

// ===========================================================================
// Vue Lynx APIs
// ===========================================================================

export interface VueLynxApp {
  mount(): void;
  unmount(): void;
  use(plugin: unknown, ...options: unknown[]): VueLynxApp;
  provide(key: unknown, value: unknown): VueLynxApp;
  config: VueConstructor['config'];
  [key: string]: unknown;
}

export function createApp(
  rootComponent: Component,
  rootProps?: Record<string, unknown>,
): VueLynxApp {
  const provides: Record<PropertyKey, unknown> = {};
  let vm: (Vue & { __vueLynxRoot?: ShadowElement }) | null = null;

  const app: VueLynxApp = {
    get config() {
      return VueCtor.config;
    },

    use(plugin: unknown, ...options: unknown[]): VueLynxApp {
      VueCtor.use(plugin as never, ...options);
      return app;
    },

    provide(key: unknown, value: unknown): VueLynxApp {
      provides[key as PropertyKey] = value;
      return app;
    },

    mount(): void {
      const root = createPageRoot();
      vm = new VueCtor({
        provide: () => provides,
        render() {
          return h(rootComponent, rootProps ?? {});
        },
      }) as Vue & { __vueLynxRoot?: ShadowElement };
      vm.__vueLynxRoot = root;
      vm.$mount();
      flushNow();
    },

    unmount(): void {
      if (!vm) return;
      const rootEl = vm.$el as unknown as ShadowElement | undefined;
      vm.$destroy();
      if (rootEl) nodeOps.remove(rootEl);
      vm = null;
    },
  };

  return app;
}

export function nextTick(fn?: () => void): Promise<void> {
  const tick = vueNextTick().then(() => waitForFlush());
  return fn ? tick.then(fn) : tick;
}

export {
  MainThreadRef,
  useMainThreadRef,
  runOnMainThread,
  runOnBackground,
  transformToWorklet,
};

/** @internal Exposed for test bridges. */
export { createPageRoot } from './shadow-element.js';

// ---------------------------------------------------------------------------
// h() compatibility
// ---------------------------------------------------------------------------

export function h(
  type: Parameters<typeof vueH>[0],
  propsOrChildren?: unknown,
  children?: unknown,
): VNode {
  if (
    arguments.length === 2
    && (Array.isArray(propsOrChildren)
      || typeof propsOrChildren === 'string'
      || typeof propsOrChildren === 'number')
  ) {
    return vueH(type, propsOrChildren as never) as VNode;
  }

  const data = normalizeHData(type, propsOrChildren);
  if (arguments.length >= 3) {
    return vueH(type, data as never, children as never) as VNode;
  }
  return vueH(type, data as never) as VNode;
}

function normalizeHData(type: unknown, value: unknown): VNodeData | undefined {
  if (value == null) return undefined;
  if (Array.isArray(value) || typeof value !== 'object') return value as never;

  const raw = value as Record<string, unknown>;
  if (hasVue2DataShape(raw)) return raw as VNodeData;

  const isComponent = typeof type !== 'string';
  const data: VNodeData = {};

  for (const key of Object.keys(raw)) {
    const propValue = raw[key];
    if (key === 'class') {
      data.class = propValue;
    } else if (key === 'style') {
      data.style = propValue as VNodeData['style'];
    } else if (key === 'key') {
      data.key = propValue as string | number;
    } else if (key === 'ref') {
      data.ref = propValue as never;
    } else if (/^on[A-Z]/.test(key)) {
      const event = key.slice(2, 3).toLowerCase() + key.slice(3);
      (data.on ??= {})[event] = propValue as never;
    } else if (isComponent) {
      (data.props ??= {})[key] = propValue;
    } else {
      (data.attrs ??= {})[key] = propValue;
    }
  }

  return data;
}

function hasVue2DataShape(value: Record<string, unknown>): boolean {
  return [
    'attrs',
    'props',
    'domProps',
    'on',
    'nativeOn',
    'staticClass',
    'staticStyle',
    'hook',
    'directives',
    'scopedSlots',
  ].some((key) => hasOwnProperty.call(value, key));
}

// ---------------------------------------------------------------------------
// v-show directive
// ---------------------------------------------------------------------------

function applyVShow(el: ShadowElement, value: unknown): void {
  el._vShowHidden = !value;
  const style = el._vShowHidden ? { ...el._style, display: 'none' } : el._style;
  pushOp(OP.SET_STYLE, el.id, style);
  scheduleFlush();
}

export const vShow = {
  bind(el: ShadowElement, binding: { value: unknown }) {
    applyVShow(el, binding.value);
  },
  update(
    el: ShadowElement,
    binding: { value: unknown; oldValue: unknown },
  ) {
    if (binding.value !== binding.oldValue) applyVShow(el, binding.value);
  },
  beforeMount(el: ShadowElement, binding: { value: unknown }) {
    applyVShow(el, binding.value);
  },
  updated(
    el: ShadowElement,
    binding: { value: unknown; oldValue: unknown },
  ) {
    if (binding.value !== binding.oldValue) applyVShow(el, binding.value);
  },
} as unknown as ObjectDirective<ShadowElement, unknown> & DirectiveOptions;

// ===========================================================================
// Vue 2.7 core re-exports
// ===========================================================================

export {
  computed,
  customRef,
  reactive,
  readonly,
  ref,
  shallowReactive,
  shallowRef,
  shallowReadonly,
  toRaw,
  toRef,
  toRefs,
  triggerRef,
  unref,
  isRef,
  isReactive,
  isReadonly,
  isProxy,
  isShallow,
  markRaw,
  onMounted,
  onBeforeMount,
  onUnmounted,
  onBeforeUnmount,
  onUpdated,
  onBeforeUpdate,
  onErrorCaptured,
  onRenderTracked,
  onRenderTriggered,
  watch,
  watchEffect,
  watchPostEffect,
  watchSyncEffect,
  inject,
  provide,
  effectScope,
  getCurrentScope,
  onScopeDispose,
  defineComponent,
  defineAsyncComponent,
  getCurrentInstance,
  useSlots,
  useAttrs,
  version,
  set,
  del,
} from 'vue';

export function toValue<T>(value: T | (() => T)): T {
  return typeof value === 'function' ? (value as () => T)() : unref(value);
}

export function hasInjectionContext(): boolean {
  return Boolean(getCurrentInstance());
}

export function onWatcherCleanup(_fn: () => void): void {
  if (__DEV__) {
    console.warn('[vue-lynx] onWatcherCleanup is a Vue 3.5 API and is not available in Vue 2.7.');
  }
}

let nextId = 0;
export function useId(): string {
  return `v-lynx-${++nextId}`;
}

export function useModel(): never {
  throw new Error('[vue-lynx] useModel is a Vue 3 API and is not available in the Vue 2 runtime.');
}

export function useTemplateRef(): never {
  throw new Error('[vue-lynx] useTemplateRef is a Vue 3 API and is not available in the Vue 2 runtime.');
}

export function defineProps(): never {
  throw new Error('[vue-lynx] defineProps is a compiler macro and should not be called at runtime.');
}

export function defineEmits(): never {
  throw new Error('[vue-lynx] defineEmits is a compiler macro and should not be called at runtime.');
}

export function defineExpose(): void {
  return undefined;
}
export function defineOptions(): void {
  return undefined;
}

export function defineModel(): never {
  throw new Error('[vue-lynx] defineModel is a Vue 3 compiler macro and is not available in Vue 2.');
}

export function defineSlots(): never {
  throw new Error('[vue-lynx] defineSlots is a Vue 3 compiler macro and is not available in Vue 2.');
}

export function withDefaults<T>(props: T): T {
  return props;
}

export const Fragment = '__fragment';
export const Text: symbol = Symbol.for('vue.text');
export const Comment: symbol = Symbol.for('vue.comment');

export const Suspense = VueCtor.extend({
  name: 'Suspense',
  functional: true,
  render(createElement: CreateElement, context: RenderContext) {
    return context.children?.[0] ?? createElement();
  },
});

export function mergeProps(
  ...args: Record<string, unknown>[]
): Record<string, unknown> {
  return Object.assign({}, ...args);
}

// ---------------------------------------------------------------------------
// Template helper compatibility shims
// ---------------------------------------------------------------------------

export function openBlock(): void {
  return undefined;
}

export function createBlock(
  type: Parameters<typeof h>[0],
  props?: unknown,
  children?: unknown,
): VNode {
  return h(type, props, children);
}

export const createElementBlock = createBlock;
export const createVNode = createBlock;
export const createElementVNode = createBlock;

export function createTextVNode(text = ''): VNode {
  return {
    text: String(text),
    isComment: false,
    isRootInsert: true,
  } as VNode;
}

export function createCommentVNode(text = ''): VNode {
  return {
    text,
    isComment: true,
    isRootInsert: true,
  } as VNode;
}

export function cloneVNode(vnode: VNode): VNode {
  return { ...(vnode as unknown as Record<string, unknown>) } as unknown as VNode;
}

export function isVNode(value: unknown): value is VNode {
  return Boolean(value && typeof value === 'object' && 'isRootInsert' in value);
}

export function toDisplayString(value: unknown): string {
  return value == null ? '' : String(value);
}

export function normalizeClass(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(normalizeClass).filter(Boolean).join(' ');
  if (typeof value === 'object') {
    return Object.entries(value)
      .filter(([, enabled]) => enabled)
      .map(([name]) => name)
      .join(' ');
  }
  return String(value);
}

export function normalizeStyle(value: unknown): unknown {
  return value;
}

export function normalizeProps<T>(props: T): T {
  return props;
}

export function camelize(value: string): string {
  return value.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
}

export function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function renderList<T, R>(
  source: T[] | number | Record<string, T>,
  renderItem: (value: T, key: number | string) => R,
): R[] {
  if (typeof source === 'number') {
    return Array.from({ length: source }, (_, i) => renderItem((i + 1) as T, i));
  }
  if (Array.isArray(source)) {
    return source.map((item, i) => renderItem(item, i));
  }
  return Object.keys(source).map((key) => renderItem(source[key]!, key));
}

export function withDirectives(
  vnode: VNode,
  directives?: [
    unknown,
    unknown,
    (string | undefined)?,
    (Record<string, boolean> | undefined)?,
  ][],
): VNode {
  if (directives && directives.length > 0) {
    const mutable = vnode as VNode & { data?: VNodeData };
    mutable.data ??= {};
    mutable.data.directives = [
      ...(mutable.data.directives ?? []),
      ...directives.map(([def, value, arg, modifiers]) => ({
        name: 'vue-lynx-directive',
        def: def as never,
        value,
        arg,
        modifiers,
      })),
    ];
  }
  return vnode;
}

export function resolveComponent(name: string): string {
  return name;
}

export function resolveDynamicComponent(component: unknown): unknown {
  return component;
}

export function resolveDirective(name: string): string {
  return name;
}

export function withCtx<T extends (...args: never[]) => unknown>(fn: T): T {
  return fn;
}

export function renderSlot(
  slots: Record<string, ((props?: unknown) => VNode[]) | undefined>,
  name: string,
  props?: unknown,
  fallback?: () => VNode[],
): VNode[] {
  return slots[name]?.(props) ?? fallback?.() ?? [];
}

export function createSlots(slots: unknown): unknown {
  return slots;
}

export function setBlockTracking(): void {
  return undefined;
}
export function pushScopeId(): void {
  return undefined;
}
export function popScopeId(): void {
  return undefined;
}
export function withScopeId(): (fn: () => unknown) => () => unknown {
  return (fn) => fn;
}
export function toHandlerKey(value: string): string {
  return value ? `on${capitalize(value)}` : '';
}
export function toHandlers(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) out[toHandlerKey(key)] = value[key];
  return out;
}
export function withMemo<T>(_: unknown[], render: () => T): T {
  return render();
}
export function guardReactiveProps<T>(props: T): T {
  return props;
}
export async function withAsyncContext<T>(fn: () => Promise<T>): Promise<[Promise<T>, () => void]> {
  return [fn(), () => undefined];
}

// ---------------------------------------------------------------------------
// Deprecated / unsupported APIs
// ---------------------------------------------------------------------------

export function onServerPrefetch(_fn: () => unknown): void {
  if (__DEV__) console.warn('[vue-lynx] onServerPrefetch is not supported.');
}

export function useSSRContext(): undefined {
  if (__DEV__) console.warn('[vue-lynx] useSSRContext is not available.');
  return undefined;
}

export function createStaticVNode(): never {
  throw new Error('[vue-lynx] createStaticVNode is not supported.');
}

export const Static: symbol = Symbol.for('v-stc');

export function KeepAlive(): void {
  if (__DEV__) console.warn('[vue-lynx] KeepAlive is not supported.');
}

export function onActivated(_fn: () => void): void {
  if (__DEV__) console.warn('[vue-lynx] onActivated is not supported.');
}

export function onDeactivated(_fn: () => void): void {
  if (__DEV__) console.warn('[vue-lynx] onDeactivated is not supported.');
}

export function Teleport(): void {
  if (__DEV__) console.warn('[vue-lynx] Teleport is not supported.');
}

export const vModelText = {
  __vueLynxVModelText: true,
} as unknown as ObjectDirective<ShadowElement>;
export const vModelCheckbox = {} as ObjectDirective;
export const vModelSelect = {} as ObjectDirective;
export const vModelRadio = {} as ObjectDirective;

export function withModifiers(
  fn: (...args: unknown[]) => unknown,
  _modifiers: string[],
): (...args: unknown[]) => unknown {
  return fn;
}

export function withKeys(
  fn: (...args: unknown[]) => unknown,
  _keys: string[],
): (...args: unknown[]) => unknown {
  return fn;
}

// ===========================================================================
// Built-in components and test utilities
// ===========================================================================

export { Transition, TransitionGroup };
export { useCssVars } from './use-css-vars.js';

/** @hidden */
export { ShadowElement };
/** @hidden */
export { nodeOps };
/** @hidden */
export { takeOps };

export function resetForTesting(): void {
  resetRegistry();
  resetNodeOpsState();
  resetFlushState();
  resetMainThreadRefState();
  resetFunctionCallState();
  resetRunOnBackgroundState();
  takeOps();
  ShadowElement.nextId = 2;
  nextId = 0;
}
