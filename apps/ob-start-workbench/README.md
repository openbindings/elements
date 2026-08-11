# ob start workbench

This private Vite application composes the independently publishable elements
and writes its production assets into the sibling `ob` repository for Go
embedding.

Its shell deliberately follows a workbench rather than dashboard model:
the interface explorer is a master rail, the selected operation is identified
in an application-owned tab strip, and operation detail and invocation share
a resizable work area. Tabs retain independent input, output, and running
invocations; they can be activated, reordered, closed, deep-linked, and
restored per target. A separately resizable artifact pane composes the
JSON/YAML editor, source/binding inspector, graph viewer, and graph editor.
Panels can be hidden independently and non-secret layout preferences are
retained locally. These are composition concerns; every public element remains
independently usable and framework-neutral.

The browser bundle contains no OpenAPI, gRPC, GraphQL, MCP, AsyncAPI, or other
binding-family implementation. It:

1. retrieves the local server OBI through standard well-known discovery;
2. adapts `ob start`'s documented WebSocket frame endpoint as an
   application-local carrier;
3. publishes the server's canonical Operation Invoker contract through an
   `OperationEnvironment`;
4. asks that operation to resolve/synthesize targets and invoke selected
   operations.

Protocol processing stays in `ob`. A raw API artifact can therefore be
resolved and invoked without shipping its binding family to the browser.

The private carrier is not labeled `openbindings.asyncapi@1`: it is an
application-local transport contract, not an AsyncAPI source governed by that
unreleased candidate. The candidate delegates reply-bearing WebSocket sessions
to a driver capable of preserving them. See
[`../../docs/design.md`](../../docs/design.md).

The session token authenticates the local `ob start` carrier. It is removed
from the URL fragment immediately, retained in tab-scoped session storage, and
never forwarded as the bearer token for an arbitrary resolved target. Target
invocation context is a separate explicit value.

The application uses the server's optional `prepareOperation` capability to
turn standard context requirements into focused controls before invocation.
It preserves declared alternatives, refuses to guess protocol-specific
configuration, and keeps an advanced JSON escape hatch. This is host
convenience layered around the reusable elements; the invocation element
itself depends only on the published Operation Invoker interface.

Document and graph edits are local drafts. Applying one updates the in-memory
workspace but does not claim to save an upstream artifact. Source refresh,
source removal, and exact binding removal are explicit, confirmed host actions
fulfilled through `ob`'s own published operations. Same-target edits reconcile
the interface in place so surviving tabs and invocation history remain open;
switching to another target resets target context and sessions.
