import { z } from "zod";
import { type DeliveryJob, type ProcessingJob } from "./fanout_plan.js";
import { InfraiQueue } from "./infrai_queue.js";

const ProcessingPayload = z.object({
  kind: z.literal("asset.processing"),
  assetId: z.string(),
  sourceUrl: z.string().url(),
  creatorId: z.string(),
  deliveries: z.array(z.object({
    kind: z.literal("creator.delivery"),
    deliveryId: z.string(),
    assetId: z.string(),
    creatorId: z.string(),
    subscriberId: z.string(),
    callbackUrl: z.string().url()
  }))
});

const DeliveryPayload = ProcessingPayload.shape.deliveries.element;
const queue = new InfraiQueue();

async function processOne(): Promise<ProcessingJob | null> {
  const [message] = await queue.consume(1, 60);
  if (!message) return null;
  const job = ProcessingPayload.parse(message.payload) as ProcessingJob;
  for (const delivery of job.deliveries) {
    await queue.publish(delivery, delivery.deliveryId);
  }
  await queue.ack(message.message_id);
  return job;
}

async function deliverOne(): Promise<DeliveryJob | null> {
  const [message] = await queue.consume(1, 60);
  if (!message) return null;
  const delivery = DeliveryPayload.parse(message.payload) as DeliveryJob;
  const response = await fetch(delivery.callbackUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      assetId: delivery.assetId,
      creatorId: delivery.creatorId,
      subscriberId: delivery.subscriberId,
      state: "ready"
    })
  });
  if (!response.ok) throw new Error(`Subscriber callback returned ${response.status}`);
  await queue.ack(message.message_id);
  return delivery;
}

const mode = process.argv[2];
if (mode === "process") {
  console.log(await processOne());
} else if (mode === "deliver") {
  console.log(await deliverOne());
} else if (mode === "setup") {
  console.log("queue ready", await queue.create());
} else {
  console.log("Run with setup, process, or deliver");
}
