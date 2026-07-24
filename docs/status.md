# Current scope

This first vertical slice proves the element model with three independently
usable public elements and the minimal shared plumbing they need:

- OBI exploration;
- operation contract inspection;
- operation invocation through a published Operation Invoker requirement;
- a real `ob start` application composed from those elements.

It deliberately does not make the package set look more complete than it is.
The following Panjir-inspired surfaces remain focused follow-up loops:

- a JSON/YAML OBI source editor;
- an interface-level source and binding view;
- a read-only operation graph viewer;
- a separately shipped operation graph editor over the viewer's shared model
  and renderer;
- dedicated framework-consumer fixtures and an independent assistive
  technology audit.

The graph viewer and editor should not be collapsed into one element. The
viewer is reusable anywhere a graph is displayed; the editor adds mutation
without forcing authoring code into read-only consumers.

## Open carrier question

The embedded workbench honestly uses a private browser adapter for `ob start`'s
documented reply-bearing WebSocket frame endpoints. Revision 1 of
`openbindings.asyncapi@1` refuses that interaction rather than representing it
lossily. A future design review may add a general public session model or
identify another public binding specification, but this workspace must not
claim conformance before that boundary exists.

This limitation is local to how the reference application reaches its own
server. Public elements depend only on the standard Operation Invoker
operation and can receive any conforming implementation from the application.
