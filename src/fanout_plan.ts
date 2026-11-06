import { createHash } from "node:crypto";
import { z } from "zod";

export const AssetIngestion = z.object({
  assetId: z.string().min(1),
  sourceUrl: z.string().url(),
  creatorId: z.string().min(1),
  subscribers: z.array(z.object({
    subscriberId: z.string().min(1),
    callbackUrl: z.string().url()
  })).min(1).max(1_000)
});

export type AssetIngestion = z.infer<typeof AssetIngestion>;

export type ProcessingJob = {
  kind: "asset.processing";
  assetId: string;
  sourceUrl: string;
  creatorId: string;
  deliveries: DeliveryJob[];
};

export type DeliveryJob = {
  kind: "creator.delivery";
  deliveryId: string;
  assetId: string;
  creatorId: string;
  subscriberId: string;
  callbackUrl: string;
};

function stableId(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 24);
}

export function planFanout(input: AssetIngestion): ProcessingJob {
  return {
    kind: "asset.processing",
    assetId: input.assetId,
    sourceUrl: input.sourceUrl,
    creatorId: input.creatorId,
    deliveries: input.subscribers.map((subscriber) => ({
      kind: "creator.delivery",
      deliveryId: stableId(input.assetId, subscriber.subscriberId),
      assetId: input.assetId,
      creatorId: input.creatorId,
      subscriberId: subscriber.subscriberId,
      callbackUrl: subscriber.callbackUrl
    }))
  };
}
