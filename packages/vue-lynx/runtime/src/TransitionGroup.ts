// Copyright 2025 The Lynx Authors. All rights reserved.
// Licensed under the Apache License Version 2.0 that can be found in the
// LICENSE file in the root directory of this source tree.

import Vue from 'vue';
import type { CreateElement, RenderContext, VueConstructor } from 'vue';

import type { TransitionProps } from './Transition.js';

export interface TransitionGroupProps extends TransitionProps {
  tag?: string;
}

const VueCtor = Vue as unknown as VueConstructor;

export const TransitionGroup = VueCtor.extend({
  name: 'TransitionGroup',
  functional: true,
  props: {
    tag: {
      type: String,
      default: 'view',
    },
  },
  render(createElement: CreateElement, context: RenderContext) {
    return createElement(
      (context.props.tag as string | undefined) ?? 'view',
      context.data,
      context.children,
    );
  },
});
