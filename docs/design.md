# Design boundaries

## What an element is

An OpenBindings element is a presentation and interaction unit with an
ordinary browser contract:

- OBI and other data arrive through JavaScript properties.
- User intent leaves through composed DOM events.
- Visual adaptation uses CSS custom properties and named parts.
- Behavior outside the element arrives as compatible OpenBindings operation
  implementations.

This is intentionally smaller than an OpenBindings host. There is no required
application shell, registry singleton, router, credential store, protocol
bundle, framework, or backend.

## Pure views and behavioral elements

Pure views such as the OBI explorer and operation detail accept values and
perform no network, storage, synthesis, or invocation.

A behavioral element publishes the smallest reusable operation requirement
that describes what it needs. It observes an `OperationSource`, resolves the
requirement using SDK compatibility and invocability rules, and exposes
available, unavailable, ambiguous, and failed states. It does not decide how
implementations were discovered or trusted.

The operation requirement is the reusable seam. `OperationEnvironment` is
only lifecycle plumbing around an application-owned immutable snapshot; it is
not a universal delegate manager.

## Ownership

The application owns:

- implementation discovery, registration, removal, and preference;
- the set of binding-family invokers included in its bundle;
- credentials, context resolution, consent, and persistence;
- routing between elements and application state;
- trust policy and any fallback, fan-out, or aggregation semantics.

The element owns:

- its documented property, event, part, and theme contract;
- presentation and accessible interaction state;
- resolution of its published operation requirement;
- cancellation and stale-result suppression for work it initiates;
- exact shared-interface framing it claims to implement.

The SDK owns operation compatibility, binding selection, invocation lifecycle,
and the protocol implementations the application explicitly installs.

The exact binding specification named by a selected source—not an element, the
SDK, or an installed invoker—governs the portable meaning of that binding. An
invoker may complete a case the specification leaves open, but that behavior is
implementation-defined and must not be inferred or presented by an element as
portable meaning under the identifier.

## Graph viewer and graph editor

The operation graph viewer and editor should be separate public elements over
a shared graph model and renderer.

The viewer is a value component: graph in, selection/activation events out.
It must not acquire mutation, persistence, execution, or operation discovery
responsibilities merely because the editor needs them.

The editor composes the renderer with mutation affordances and emits proposed
graph values or patches. Validation, operation lookup, persistence, and
formatting are independent operation dependencies where they add real reuse.
The editor must not silently repair graph semantics or invent executable
defaults.

Keeping these packages separate lets documentation, search results, execution
traces, and read-only application screens use a small viewer without shipping
authoring machinery.

## Why the ob start carrier is local

`ob start` exposes a bidirectional JSON frame stream over WebSocket and
publishes the shape in AsyncAPI. The current
`openbindings.asyncapi@1` specification intentionally refuses reply-bearing
WebSocket `receive` operations because it does not define the needed
request/reply session model.

The embedded workbench therefore adapts those documented endpoints with a
private application carrier and a local binding identity. It keeps the
server's public operation contracts and resolves the standard Operation
Invoker requirement normally. Calling the carrier revision-1 AsyncAPI would
be a false conformance claim; changing the public binding specification merely
to make one application convenient would put the dependency direction
backwards.

This is a focused design-review question for the wider project: either a
future AsyncAPI revision gains a faithful, general session model, or `ob
start` publishes the frame carrier under another appropriate public binding
specification. The element abstraction does not depend on that outcome.
