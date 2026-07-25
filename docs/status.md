# Current scope

The current package set covers the reusable pieces needed to compose an
interface workbench:

- OBI exploration and operation contract inspection;
- conservative, cancellable operation invocation through a published
  Operation Invoker requirement;
- application-owned operation tabs with keyboard and pointer reordering;
- JSON/YAML OBI draft editing and interface source/binding inspection;
- a framework-neutral operation-graph model;
- separate read-only graph viewing and patch-intent graph editing;
- a real `ob start` application composed from those elements.

The package set intentionally does not include:

- a framework, application router, global delegate registry, or host shell;
- credential discovery, persistence, artifact fetching, or trust policy;
- automatic source-file saving or graph execution;
- a combined graph viewer/editor package;
- framework wrappers whose API could drift from the Custom Element contract.

Those responsibilities remain with the application or with separately
specified OpenBindings operations. Dedicated framework-consumer fixtures and
an independent assistive-technology audit remain valuable follow-up evidence;
they are not prerequisites for using the browser-native contracts.

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
