import {
  ERR_CONNECT_FAILED,
  ERR_FRAME_PROTOCOL,
  ERR_STREAM_ERROR,
  InvocationError,
  InvocationImpl,
  type BindingInvocationArgs,
  type BindingInvoker,
  type ContextRequiredDetails,
  type Invocation,
  type OBInterface,
} from "@openbindings/sdk";

/**
 * Private binding identity for ob start's frame carrier.
 *
 * The public server artifact describes these operations with AsyncAPI, but
 * openbindings.asyncapi@1 intentionally refuses reply-bearing WebSocket
 * receive operations. Treating that artifact as invocable anyway would
 * violate the binding spec. The embedded application therefore adapts the
 * server's two explicitly documented frame endpoints through this local
 * carrier while retaining the public OBI's operation contracts.
 */
const OB_START_FRAME_BINDING = "openbindings.ob-start-frame@local";

export interface OBStartFrameInvokerOptions {
  origin: string;
  token: () => string;
}

/**
 * Returns an application-local implementation OBI whose operation contracts
 * are the server's published contracts and whose two frame bindings use the
 * embedded client's private carrier.
 */
export function adaptOBStartFrameBindings(iface: OBInterface): OBInterface {
  const adapted = structuredClone(iface);
  adapted.sources ??= {};
  let sourceName = "__obStartFrameCarrier";
  while (Object.hasOwn(adapted.sources, sourceName)) sourceName = `_${sourceName}`;
  adapted.sources[sourceName] = {
    bindingSpec: OB_START_FRAME_BINDING,
    content: {},
  };

  for (const binding of Object.values(adapted.bindings ?? {})) {
    if (
      binding.ref === "#/operations/invokeOperation" ||
      binding.ref === "#/operations/invokeBinding"
    ) {
      binding.source = sourceName;
    }
  }
  return adapted;
}

/**
 * Browser carrier for ob start's documented JSON frame protocol.
 *
 * This is application plumbing, not a reusable OpenBindings binding
 * specification. The public elements still depend only on the canonical
 * Operation Invoker operation; an application may satisfy that dependency
 * with any implementation.
 */
export class OBStartFrameInvoker implements BindingInvoker {
  readonly #origin: string;
  readonly #token: () => string;

  constructor(options: OBStartFrameInvokerOptions) {
    this.#origin = options.origin;
    this.#token = options.token;
  }

  bindingSpecs() {
    return [
      {
        bindingSpec: OB_START_FRAME_BINDING,
        description: "ob start embedded frame carrier",
      },
    ];
  }

  async prepareBinding(
    args: BindingInvocationArgs,
  ): Promise<ContextRequiredDetails | null> {
    this.#route(args.ref);
    if (!this.#token()) {
      throw new Error("the ob start session token has not been supplied");
    }
    return null;
  }

  invokeBinding<I = unknown, O = unknown>(
    args: BindingInvocationArgs,
  ): Invocation<I, O> {
    const invocation = new InvocationImpl<I, O>(
      args.signal ? { signal: args.signal } : {},
    );
    queueMicrotask(() => {
      void this.#run(args, invocation).catch(error => {
        invocation.fireError(
          error instanceof InvocationError
            ? error
            : new InvocationError(ERR_STREAM_ERROR),
        );
      });
    });
    return invocation;
  }

  async #run<I, O>(
    args: BindingInvocationArgs,
    invocation: InvocationImpl<I, O>,
  ): Promise<void> {
    const token = this.#token();
    if (!token) {
      invocation.fireError(
        new InvocationError(ERR_CONNECT_FAILED),
      );
      return;
    }

    const endpoint = new URL(this.#route(args.ref), this.#origin);
    endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";

    const encodedToken = encodeBase64Url(token);
    const socket = new WebSocket(endpoint, [
      "openbindings.frames.v1",
      `openbindings.bearer.${encodedToken}`,
    ]);
    const opened = new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener(
        "error",
        () =>
          reject(
            new InvocationError(ERR_CONNECT_FAILED),
          ),
        { once: true },
      );
    });

    let receiveChain = Promise.resolve();
    let transportFailed = false;
    let terminalFrameSeen = false;
    let cleanClose: (() => void) | null = null;
    const closed = new Promise<void>(resolve => {
      cleanClose = resolve;
    });

    socket.addEventListener("message", event => {
      receiveChain = receiveChain
        .then(async () => {
          let text: string;
          if (typeof event.data === "string") {
            text = event.data;
          } else if (event.data instanceof Blob) {
            text = await event.data.text();
          } else {
            text = new TextDecoder().decode(event.data as ArrayBuffer);
          }

          let frame: O;
          try {
            frame = JSON.parse(text) as O;
          } catch (error) {
            transportFailed = true;
            invocation.fireError(
              new InvocationError(ERR_FRAME_PROTOCOL),
            );
            socket.close(1002, "invalid JSON");
            return;
          }
          if (
            frame !== null &&
            typeof frame === "object" &&
            "kind" in frame &&
            ((frame as { kind?: unknown }).kind === "complete" ||
              (frame as { kind?: unknown }).kind === "error")
          ) {
            terminalFrameSeen = true;
          }
          await invocation.emitOutput(frame);
        })
        .catch(error => {
          transportFailed = true;
          if (!invocation.signal.aborted) {
            invocation.fireError(
              error instanceof InvocationError
                ? error
                : new InvocationError(ERR_STREAM_ERROR),
            );
          }
        });
    });
    socket.addEventListener("error", () => {
      transportFailed = true;
    });
    socket.addEventListener("close", event => {
      receiveChain = receiveChain.finally(() => {
        if (!invocation.signal.aborted) {
          if (
            terminalFrameSeen ||
            (event.code === 1000 && !transportFailed)
          ) {
            invocation.closeOutput();
          } else {
            invocation.fireError(
              new InvocationError(ERR_STREAM_ERROR),
            );
          }
        }
        cleanClose?.();
      });
    });

    const onAbort = () => {
      if (
        socket.readyState === WebSocket.CONNECTING ||
        socket.readyState === WebSocket.OPEN
      ) {
        socket.close(1000, "invocation ended");
      }
    };
    invocation.signal.addEventListener("abort", onAbort, { once: true });

    try {
      await opened;
      const send = async () => {
        for await (const frame of invocation.inputs()) {
          if (socket.readyState !== WebSocket.OPEN) {
            throw new InvocationError(ERR_STREAM_ERROR);
          }
          socket.send(JSON.stringify(frame));
        }
      };
      await Promise.all([send(), closed]);
      await receiveChain;
    } finally {
      invocation.signal.removeEventListener("abort", onAbort);
      if (
        socket.readyState === WebSocket.CONNECTING ||
        socket.readyState === WebSocket.OPEN
      ) {
        socket.close(1000, "invocation ended");
      }
    }
  }

  #route(ref: string): string {
    switch (ref) {
      case "#/operations/invokeOperation":
        return "/operations/invoke";
      case "#/operations/invokeBinding":
        return "/bindings/invoke";
      default:
        throw new InvocationError(ERR_FRAME_PROTOCOL);
    }
  }
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
