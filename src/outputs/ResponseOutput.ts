export interface ResponseEvent {
  type: "response-on" | "response-off";
  /** performance.now() at the state transition. */
  timestampMs: number;
  /** performance.now() of the camera frame that caused it. */
  frameTimeMs: number;
  score: number;
  /** True when a response ended because tracking was lost rather than by looking away. */
  cancelledByTrackingLoss?: boolean;
}

/** Any consumer of responses: screen, logger, and later WebSocket/BLE/hardware bridges. */
export interface ResponseOutput {
  readonly name: string;
  onResponseStart(e: ResponseEvent): void;
  onResponseEnd(e: ResponseEvent): void;
  dispose?(): void;
}
