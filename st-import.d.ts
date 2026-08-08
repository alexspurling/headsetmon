/**
 * Augments the GJS `imports.gi` namespace with St-1.0 types.
 *
 * The @girs/st-1.0 package skips its `-import.d.ts` to avoid a type conflict
 * with the GNOME Shell version of St. This file adds Cinnamon's St namespace
 * to the global `imports.gi.St` property.
 */
import type St from '@girs/st-1.0';

declare global {
  interface GjsGiImports {
    St: typeof St;
  }
}