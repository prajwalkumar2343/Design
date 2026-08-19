import {
  createBridgeCommand,
  createBridgeHandshake,
  createBridgeRequest,
  SANDBOXED_IFRAME_ORIGIN,
  validateBridgeMessage,
  type BridgeCommand,
  type BridgeCommandAck,
  type BridgeEventMessage,
  type BridgeCommandMessage,
  type BridgeHierarchySnapshot,
  type BridgeInspection,
  type BridgeReadyMessage,
  type BridgeRequestMessage,
  type BridgeResponseMessage,
  type BridgeSessionIdentity,
} from "./protocol";

export interface IframeBridgeController {
  requestSnapshot: () => Promise<BridgeHierarchySnapshot>;
  inspect: (targetId: string) => Promise<BridgeInspection | null>;
  setInlineStyle: (
    command: Extract<BridgeCommand, { command: "set-inline-style" }>,
  ) => Promise<BridgeCommandAck>;
  setText: (
    command: Extract<BridgeCommand, { command: "set-text" }>,
  ) => Promise<BridgeCommandAck>;
  startTextEdit: (targetId: string) => Promise<BridgeCommandAck>;
  cancelTextEdit: (targetId: string) => Promise<BridgeCommandAck>;
  commitTextEdit: (
    command: Extract<BridgeCommand, { command: "commit-text-edit" }>,
  ) => Promise<BridgeCommandAck>;
  createElement: (
    command: Extract<BridgeCommand, { command: "create-element" }>,
  ) => Promise<BridgeCommandAck>;
  deleteElement: (
    command: Extract<BridgeCommand, { command: "delete-element" }>,
  ) => Promise<BridgeCommandAck>;
  restoreElement: (
    command: Extract<BridgeCommand, { command: "restore-element" }>,
  ) => Promise<BridgeCommandAck>;
  duplicateElement: (
    command: Extract<BridgeCommand, { command: "duplicate-element" }>,
  ) => Promise<BridgeCommandAck>;
  setShapeRadius: (
    command: Extract<BridgeCommand, { command: "set-shape-radius" }>,
  ) => Promise<BridgeCommandAck>;
  pickElement: (
    command: Extract<BridgeCommand, { command: "pick-element" }>,
  ) => Promise<BridgeCommandAck>;
}

export interface BridgeTransportHandlers {
  onReady?: (message: BridgeReadyMessage) => void;
  onEvent?: (message: BridgeEventMessage) => void;
}

const BRIDGE_REQUEST_TIMEOUT_MS = 5000;

export class BridgeTransportError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "BridgeTransportError";
    this.code = code;
  }
}

interface PendingResponse {
  resolve: (message: BridgeResponseMessage) => void;
  reject: (error: BridgeTransportError) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export interface IframeBridgeTransportOptions extends BridgeSessionIdentity {
  iframe: HTMLIFrameElement;
  window?: Window;
  handlers?: BridgeTransportHandlers;
}

export class IframeBridgeTransport {
  private readonly iframe: HTMLIFrameElement;
  private readonly parentWindow: Window;
  private readonly identity: BridgeSessionIdentity;
  private readonly handlers: BridgeTransportHandlers;
  private readonly pending = new Map<string, PendingResponse>();
  private requestSequence = 0;
  private attached = false;
  private disposed = false;

  constructor(options: IframeBridgeTransportOptions) {
    this.iframe = options.iframe;
    this.parentWindow = options.window ?? window;
    this.identity = { channel: options.channel, frameId: options.frameId };
    this.handlers = options.handlers ?? {};
    this.handleMessage = this.handleMessage.bind(this);
    this.handleLoad = this.handleLoad.bind(this);
  }

  attach(): void {
    if (this.attached || this.disposed) return;
    this.attached = true;
    this.parentWindow.addEventListener("message", this.handleMessage);
    this.iframe.addEventListener("load", this.handleLoad);
    queueMicrotask(() => this.sendHandshake());
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.parentWindow.removeEventListener("message", this.handleMessage);
    this.iframe.removeEventListener("load", this.handleLoad);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new BridgeTransportError("disposed", "The iframe bridge was disposed"));
    }
    this.pending.clear();
  }

  /** Sends the id-less handshake again after a load or when a caller retries. */
  sendHandshake(): boolean {
    return this.post(createBridgeHandshake(this.identity));
  }

  requestSnapshot(): Promise<BridgeHierarchySnapshot> {
    return this.request(createBridgeRequest(this.identity, this.nextRequestId(), "snapshot"), "snapshot")
      .then((message) => {
        if (!message.ok || message.result.kind !== "snapshot") {
          throw new BridgeTransportError("invalid-response", "The bridge returned an invalid hierarchy response");
        }
        return message.result.snapshot;
      });
  }

  inspect(targetId: string): Promise<BridgeInspection | null> {
    return this.request(
      createBridgeRequest(this.identity, this.nextRequestId(), "inspect", targetId),
      "inspection",
    ).then((message) => {
      if (!message.ok || message.result.kind !== "inspection") {
        throw new BridgeTransportError("invalid-response", "The bridge returned an invalid inspection response");
      }
      return message.result.inspection;
    });
  }

  setInlineStyle(command: Extract<BridgeCommand, { command: "set-inline-style" }>): Promise<BridgeCommandAck> {
    return this.sendCommand(command);
  }

  setText(command: Extract<BridgeCommand, { command: "set-text" }>): Promise<BridgeCommandAck> {
    return this.sendCommand(command);
  }

  startTextEdit(targetId: string): Promise<BridgeCommandAck> {
    return this.sendCommand({ command: "start-text-edit", targetId });
  }

  cancelTextEdit(targetId: string): Promise<BridgeCommandAck> {
    return this.sendCommand({ command: "cancel-text-edit", targetId });
  }

  commitTextEdit(command: Extract<BridgeCommand, { command: "commit-text-edit" }>): Promise<BridgeCommandAck> {
    return this.sendCommand(command);
  }

  createElement(command: Extract<BridgeCommand, { command: "create-element" }>): Promise<BridgeCommandAck> {
    return this.sendCommand(command);
  }

  deleteElement(command: Extract<BridgeCommand, { command: "delete-element" }>): Promise<BridgeCommandAck> {
    return this.sendCommand(command);
  }

  restoreElement(command: Extract<BridgeCommand, { command: "restore-element" }>): Promise<BridgeCommandAck> {
    return this.sendCommand(command);
  }

  duplicateElement(command: Extract<BridgeCommand, { command: "duplicate-element" }>): Promise<BridgeCommandAck> {
    return this.sendCommand(command);
  }

  setShapeRadius(command: Extract<BridgeCommand, { command: "set-shape-radius" }>): Promise<BridgeCommandAck> {
    return this.sendCommand(command);
  }

  pickElement(command: Extract<BridgeCommand, { command: "pick-element" }>): Promise<BridgeCommandAck> {
    return this.sendCommand(command);
  }

  /** Exposed for deterministic protocol tests; it applies the same checks as the event listener. */
  acceptMessage(event: Pick<MessageEvent, "data" | "origin" | "source">): boolean {
    if (this.disposed || event.origin !== SANDBOXED_IFRAME_ORIGIN || event.source !== this.iframe.contentWindow) {
      return false;
    }
    const message = validateBridgeMessage(event.data, this.identity);
    if (!message) return false;
    if (message.type === "ready") {
      this.handlers.onReady?.(message);
      return true;
    }
    if (message.type === "event") {
      this.handlers.onEvent?.(message);
      return true;
    }
    if (message.type !== "response") return false;
    const pending = this.pending.get(message.requestId);
    if (!pending) return true;
    this.pending.delete(message.requestId);
    clearTimeout(pending.timeout);
    if (message.ok) pending.resolve(message);
    else pending.reject(new BridgeTransportError(message.error.code, message.error.message));
    return true;
  }

  private handleMessage(event: MessageEvent): void {
    this.acceptMessage(event);
  }

  private handleLoad(): void {
    this.sendHandshake();
  }

  private nextRequestId(): string {
    this.requestSequence += 1;
    return `bridge-${this.identity.frameId}-${this.requestSequence}`;
  }

  private post(message: unknown): boolean {
    if (this.disposed || !this.iframe.contentWindow) return false;
    this.iframe.contentWindow.postMessage(message, "*");
    return true;
  }

  private request(
    message: BridgeRequestMessage | BridgeCommandMessage,
    expectedKind: string,
  ): Promise<BridgeResponseMessage> {
    if (this.disposed) {
      return Promise.reject(new BridgeTransportError("disposed", "The iframe bridge was disposed"));
    }

    const requestId = message.requestId;
    return new Promise<BridgeResponseMessage>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new BridgeTransportError("timeout", `The iframe bridge timed out while requesting ${expectedKind}`));
      }, BRIDGE_REQUEST_TIMEOUT_MS);
      this.pending.set(requestId, { resolve, reject, timeout });
      if (!this.post(message)) {
        this.pending.delete(requestId);
        clearTimeout(timeout);
        reject(new BridgeTransportError("unavailable", `The iframe bridge cannot request ${expectedKind}`));
      }
    });
  }

  private sendCommand(command: BridgeCommand): Promise<BridgeCommandAck> {
    const requestId = this.nextRequestId();
    return this.request(createBridgeCommand(this.identity, requestId, command), "command").then((message) => {
      if (!message.ok || message.result.kind !== "command") {
        throw new BridgeTransportError("invalid-response", "The bridge returned an invalid command acknowledgement");
      }
      return message.result.ack;
    });
  }
}
