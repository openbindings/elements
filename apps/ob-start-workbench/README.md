# ob start workbench

This private Vite application composes the independently publishable elements
and writes its production assets into the sibling `ob` repository for Go
embedding.

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

The private carrier is not labeled `openbindings.asyncapi@1`: that published
binding specification intentionally refuses reply-bearing WebSocket
`receive` operations. See [`../../docs/design.md`](../../docs/design.md).

The session token authenticates the local `ob start` carrier. It is removed
from the URL fragment immediately, retained only in page memory, and never
forwarded as the bearer token for an arbitrary resolved target. Target
invocation context is a separate explicit value.
