# `@openbindings/ui-core`

Small framework-neutral utilities shared by OpenBindings elements.

`OperationEnvironment` is application-owned reactive state containing concrete
OpenBindings operation implementations. Elements receive its read-only
`OperationSource` face. This keeps delegate registration, preference, trust,
and credential policy outside elements while still allowing availability to
change reactively.

This package has no DOM side effects and registers no custom elements.
