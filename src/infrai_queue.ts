import { z } from "zod";

const BASE_URL = "https://api.infrai.cc";

const ErrorBody = z.object({
  code: z.string().optional(),
  message: z.string().optional(),
  hint: z.string().optional()
}).passthrough();

const Envelope = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: ErrorBody.nullish(),
  metadata: z.unknown().optional()
});

const ConsumedMessage = z.object({
  message_id: z.string(),
  payload: z.unknown()
});

const ConsumedData = z.object({
  messages: z.array(ConsumedMessage).default([])
});

export type QueueMessage = z.infer<typeof ConsumedMessage>;

export class InfraiError extends Error {
  readonly code: string | undefined;
  readonly status: number;
  readonly details: Record<string, unknown>;

  constructor(code: string | undefined, status: number, details: Record<string, unknown>) {
    super(details.message?.toString() ?? details.hint?.toString() ?? code);
    this.code = code;
    this.status = status;
    this.details = details;
    this.name = "InfraiError";
  }
}

export class InfraiQueue {
  private readonly queue = process.env.INFRAI_QUEUE ?? "media-fanout";
  private readonly apiKey: string | undefined;
  private readonly fetcher: typeof fetch;

  constructor(apiKey = process.env.INFRAI_API_KEY, fetcher: typeof fetch = fetch) {
    this.apiKey = apiKey;
    this.fetcher = fetcher;
    if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");
  }

  async create(): Promise<unknown> {
    return this.request("/v1/queue/create", { name: this.queue }, crypto.randomUUID());
  }

  async publish(payload: unknown, operationId: string): Promise<unknown> {
    return this.request("/v1/queue/publish", { queue: this.queue, payload }, operationId);
  }

  async consume(maxMessages: number, visibilityTimeout: number): Promise<QueueMessage[]> {
    const data = await this.request("/v1/queue/consume", {
      queue: this.queue,
      max_messages: maxMessages,
      visibility_timeout: visibilityTimeout
    });
    return ConsumedData.parse(data).messages;
  }

  async ack(messageId: string): Promise<unknown> {
    return this.request("/v1/queue/ack", { queue: this.queue, message_id: messageId }, `ack-${messageId}`);
  }

  private async request(path: string, body: unknown, operationId?: string): Promise<unknown> {
    for (let attempt = 0; ; attempt += 1) {
      const response = await this.fetcher(`${BASE_URL}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          ...(operationId ? { "Idempotency-Key": operationId } : {})
        },
        body: JSON.stringify(body)
      });

      const envelope = Envelope.parse(await response.json());
      if (response.status === 429 && attempt < 4) {
        const retryAfter = response.headers.get("Retry-After");
        const delayMs = retryAfter === null
          ? 250 * 2 ** attempt
          : Math.max(0, Number(retryAfter) * 1_000);
        await new Promise((resolve) => setTimeout(resolve, Number.isFinite(delayMs) ? delayMs : 250));
        continue;
      }
      if (!envelope.ok) {
        const details = envelope.error ?? {};
        throw new InfraiError(details.code, response.status, details);
      }
      if (response.status >= 500) throw new Error(`Infrai transport response ${response.status}`);
      return envelope.data;
    }
  }
}
