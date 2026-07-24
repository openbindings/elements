# Contributing

OpenBindings elements are deliberately small browser contracts. Before adding
surface area, decide whether the responsibility belongs to the element, the
application, the SDK, or a published operation dependency. See
[`docs/design.md`](docs/design.md).

## Development checkout

Until the OpenBindings 0.2 packages are released, this workspace links sibling
checkouts:

```text
interfaces/
ob/
openbindings-ts/
elements/
```

Install and verify from `elements`:

```sh
pnpm install
pnpm check
pnpm test
pnpm browser:imports
pnpm ssr:imports
pnpm pack:verify
pnpm exec playwright install chromium
pnpm test:browser
pnpm test:ob-start
```

`pnpm sync:requirements` refreshes vendored published-interface contracts and
licenses from their authoritative sibling repositories. Generated changes
must be reviewed and committed with the source change that requires them.

## Public-contract checklist

- A class import has no registration side effect; `/define` is explicit.
- No public element package imports Node, a UI framework, or a binding family.
- Pure views perform no I/O.
- Behavioral elements depend on published operations, not private clients.
- Application policy remains outside the element.
- Properties, events, parts, and theme variables are documented and tested.
- Empty, unavailable, ambiguous, error, cancellation, narrow-layout, and
  keyboard states remain usable.
- Packed tarballs contain complete exports, types, README, and license files.

Run the live `ob start` test whenever a change touches requirement resolution,
frame handling, browser security policy, generated assets, or server lifecycle.
