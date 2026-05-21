// Copyright 2026 Xuan Huang (huxpro). All rights reserved.
// Licensed under the Apache License Version 2.0 that can be found in the
// LICENSE file in the root directory of this source tree.

/**
 * Vue 2.7 placeholder for SFC CSS v-bind() support.
 *
 * The Vue 3 implementation walked runtime-core VNodes and patched CSS
 * variables onto ShadowElements after each render. Vue 2's SFC compiler and
 * VNode shape differ, so CSS variable replay needs a dedicated follow-up pass.
 */
export function useCssVars(
  _getter: (ctx: unknown) => Record<string, string>,
): void {
  if (__DEV__) {
    console.warn(
      '[vue-lynx] useCssVars is not implemented for the Vue 2 runtime yet.',
    );
  }
}
