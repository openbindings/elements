/**
 * Stable theme tokens shared by every element. Applications customize these
 * on an element or any ancestor; internal selectors are not part of the API.
 */
export const baseStyles = `
  :host {
    --ob-color-background: #ffffff;
    --ob-color-surface: #f7f7f5;
    --ob-color-surface-strong: #efefec;
    --ob-color-text: #171714;
    --ob-color-text-muted: #686862;
    --ob-color-border: #d9d9d3;
    --ob-color-accent: #305cff;
    --ob-color-accent-contrast: #ffffff;
    --ob-color-danger: #b42318;
    --ob-color-success: #18794e;
    --ob-font-family: Inter, ui-sans-serif, system-ui, sans-serif;
    --ob-font-mono: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
    --ob-font-size: 0.875rem;
    --ob-radius: 0.5rem;
    --ob-space: 0.75rem;
    --ob-focus-ring: 0 0 0 3px color-mix(in srgb, var(--ob-color-accent) 28%, transparent);

    color: var(--ob-color-text);
    font: 400 var(--ob-font-size) / 1.45 var(--ob-font-family);
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
    box-shadow: var(--ob-focus-ring);
  }

  [hidden] {
    display: none !important;
  }
`;
