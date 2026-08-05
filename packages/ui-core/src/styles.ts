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
    /* One material for machine text (rev 17.4): every surface that renders
       code — editors, output views, schema blocks, previews — draws on this
       token, a step between background and surface-strong by default. */
    --_ob-code-surface: var(
      --ob-code-surface,
      color-mix(in srgb, var(--_ob-color-surface-strong) 45%, var(--_ob-color-background))
    );
    /* One token palette for machine text (rev 17.6): editors, code views,
       and code blocks all draw these. Hosts theme them app-wide through
       --ob-editor-token-*; the defaults below follow the OS scheme so a
       standalone element still reads correctly. */
    --_ob-editor-token-key: var(--ob-editor-token-key, #1a4fd6);
    --_ob-editor-token-string: var(--ob-editor-token-string, #0b7a52);
    --_ob-editor-token-number: var(--ob-editor-token-number, #9a5300);
    --_ob-editor-token-keyword: var(--ob-editor-token-keyword, #8b21c9);
    --_ob-editor-token-punct: var(--ob-editor-token-punct, var(--_ob-color-text-muted));
    --_ob-editor-token-comment: var(--ob-editor-token-comment, var(--_ob-color-text-muted));
    --_ob-editor-token-invalid: var(--ob-editor-token-invalid, var(--_ob-color-danger));

    color: var(--_ob-color-text);
    font: 400 var(--_ob-font-size) / 1.45 var(--_ob-font-family);
    box-sizing: border-box;
  }

  *, *::before, *::after {
    box-sizing: inherit;
  }

  /* The system disclosure marker: one chevron construction everywhere a
     <summary> (or a host-drawn toggle) folds content. Drawn with borders in
     currentColor — no glyphs, no image assets — closed points right, open
     points down, turning over --_ob-duration. */
  @media (prefers-color-scheme: dark) {
    :host {
      --_ob-editor-token-key: var(--ob-editor-token-key, #8fb4ff);
      --_ob-editor-token-string: var(--ob-editor-token-string, #6bd6a4);
      --_ob-editor-token-number: var(--ob-editor-token-number, #f0b45f);
      --_ob-editor-token-keyword: var(--ob-editor-token-keyword, #d3a2ff);
    }
  }

  summary {
    cursor: pointer;
    list-style: none;
  }

  summary::-webkit-details-marker {
    display: none;
  }

  summary::before {
    display: inline-block;
    width: 0.34em;
    height: 0.34em;
    margin-right: 0.55em;
    vertical-align: 0.1em;
    border-right: 1.5px solid currentColor;
    border-bottom: 1.5px solid currentColor;
    content: "";
    transform: rotate(-45deg);
    transition: transform var(--_ob-duration) ease;
  }

  details[open] > summary::before {
    transform: rotate(45deg);
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
