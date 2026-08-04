/**
 * Stable theme tokens shared by every element. Applications customize these
 * on an element or any ancestor; internal selectors are not part of the API.
 *
 * Internals consume private `--_ob-*` names that default through the public
 * `--ob-*` tokens (`--_ob-x: var(--ob-x, <default>)`). Declaring the defaults
 * this way — instead of assigning public tokens on `:host` — is what lets an
 * ancestor-set `--ob-*` value inherit into the shadow tree: a direct `:host`
 * declaration of the public name would always beat the inherited one.
 * Private names are not API; set the public tokens only.
 */
export const baseStyles = `
  :host([hidden]) {
    /* The UA's [hidden] rule targets the light-DOM element and loses to any
       document-level display set on the host (the reference app does exactly
       that). Shadow !important beats outer normal declarations, so hidden
       stays honest regardless of app CSS. */
    display: none !important;
  }

  :host {
    --_ob-color-background: var(--ob-color-background, #ffffff);
    --_ob-color-surface: var(--ob-color-surface, #f7f7f5);
    --_ob-color-surface-strong: var(--ob-color-surface-strong, #efefec);
    --_ob-color-text: var(--ob-color-text, #171714);
    --_ob-color-text-muted: var(--ob-color-text-muted, #686862);
    --_ob-color-border: var(--ob-color-border, #d9d9d3);
    --_ob-color-accent: var(--ob-color-accent, #305cff);
    --_ob-color-accent-contrast: var(--ob-color-accent-contrast, #ffffff);
    --_ob-color-danger: var(--ob-color-danger, #b42318);
    --_ob-color-success: var(--ob-color-success, #18794e);
    --_ob-font-family: var(--ob-font-family, Inter, ui-sans-serif, system-ui, sans-serif);
    --_ob-font-mono: var(--ob-font-mono, "SFMono-Regular", Consolas, "Liberation Mono", monospace);
    --_ob-font-size: var(--ob-font-size, 0.875rem);
    --_ob-radius: var(--ob-radius, 0.5rem);
    --_ob-space: var(--ob-space, 0.75rem);
    --_ob-focus-ring: var(--ob-focus-ring, 0 0 0 3px color-mix(in srgb, var(--_ob-color-accent) 28%, transparent));
    --_ob-shadow: var(--ob-shadow, 0 1px 2px color-mix(in srgb, var(--_ob-color-text) 12%, transparent));
    --_ob-duration: var(--ob-duration, 120ms);

    color: var(--_ob-color-text);
    font: 400 var(--_ob-font-size) / 1.45 var(--_ob-font-family);
    box-sizing: border-box;
  }

  *, *::before, *::after {
    box-sizing: inherit;
  }

  button, input, textarea, select {
    color: inherit;
    font: inherit;
  }

  button:focus-visible,
  input:focus-visible,
  textarea:focus-visible,
  select:focus-visible {
    outline: none;
    box-shadow: var(--_ob-focus-ring);
  }

  [hidden] {
    display: none !important;
  }
`;
