import assert from "node:assert/strict";
import test from "node:test";
import { planFanout } from "../src/fanout_plan.js";

test("one delivery is planned per subscriber with stable retry identities", () => {
  const input = {
    assetId: "asset-42",
    sourceUrl: "https://media.example/asset-42.mov",
    creatorId: "creator-7",
    subscribers: [
      { subscriberId: "sub-a", callbackUrl: "https://one.example/media" },
      { subscriberId: "sub-b", callbackUrl: "https://two.example/media" }
    ]
  };

  const first = planFanout(input);
  const retried = planFanout(input);

  assert.equal(first.deliveries.length, 2);
  assert.deepEqual(first.deliveries.map((job) => job.subscriberId), ["sub-a", "sub-b"]);
  assert.deepEqual(
    first.deliveries.map((job) => job.deliveryId),
    retried.deliveries.map((job) => job.deliveryId)
  );
  assert.notEqual(first.deliveries[0].deliveryId, first.deliveries[1].deliveryId);
});
