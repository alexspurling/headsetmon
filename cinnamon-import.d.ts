/**
 * Augments `GjsImports` with Cinnamon-specific modules (`imports.ui`).
 *
 * The `@girs/gjs` package only defines core GJS modules (gi, lang, signals,
 * mainloop, …). Cinnamon adds `ui`, `misc`, `cinnamon`, and other custom JS
 * modules loaded at runtime from `/usr/share/cinnamon/js/`.
 */
import type St from '@girs/st-1.0';

// -- Desklet ----------------------------------------------------------------

declare namespace CinnamonDesklet {
  export class Desklet {
    metadata: Record<string, unknown>;
    instance_id: string;
    actor: St.BoxLayout;
    content: St.Bin;

    constructor(metadata: Record<string, unknown>, desklet_id: string);

    setHeader(header: string): void;
    setContent(actor: St.Widget, params?: Record<string, unknown>): void;
    on_desklet_removed(deleteConfig?: boolean): void;
    on_desklet_reloaded(): void;
    on_desklet_added_to_desktop(userEnabled?: boolean): void;
    on_desklet_clicked(event: unknown): void;
    destroy(deleteConfig?: boolean): void;
    highlight(highlight: boolean): void;
    openAbout(): void;
    configureDesklet(tab?: number): void;

    /** PopupMenu attached to the desklet; typed as any since Cinnamon popupMenu types aren't loaded. */
    _menu: { addSettingsAction(label: string, icon: string): void } & Record<string, unknown>;
    _draggable: unknown;
    _uuid: string | null;
    [key: string]: unknown;
  }
}

// -- Settings ---------------------------------------------------------------

declare namespace CinnamonSettings {
  export class DeskletSettings {
    isReady: boolean;
    bindings: Record<string, unknown>;

    constructor(xlet: Record<string, unknown>, uuid: string, instanceId: string);

    bind(key: string, prop: string, callback?: (...args: unknown[]) => void, userData?: unknown): boolean;
    bindWithObject(
      bindObject: Record<string, unknown>,
      key: string,
      prop: string,
      callback?: (...args: unknown[]) => void,
      userData?: unknown,
    ): boolean;
    unbindAll(key?: string): void;
    finalize(): void;
  }
}

// -- Augmentations ----------------------------------------------------------

declare global {
  interface GjsGiImports {
    St: typeof St;
  }

  interface GjsImports {
    ui: {
      desklet: typeof CinnamonDesklet;
      settings: typeof CinnamonSettings;
    };
  }
}