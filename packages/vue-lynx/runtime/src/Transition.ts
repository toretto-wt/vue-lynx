// Copyright 2025 The Lynx Authors. All rights reserved.
// Licensed under the Apache License Version 2.0 that can be found in the
// LICENSE file in the root directory of this source tree.

import Vue from 'vue';
import type { CreateElement, RenderContext, VueConstructor } from 'vue';

export interface TransitionProps {
  name?: string;
  type?: 'transition' | 'animation';
  duration?: number | { enter: number; leave: number };
}

const VueCtor = Vue as unknown as VueConstructor;

export const Transition = VueCtor.extend({
  name: 'Transition',
  functional: true,
  render(createElement: CreateElement, context: RenderContext) {
    return context.children?.[0] ?? createElement();
  },
});
