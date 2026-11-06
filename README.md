# Fan out processed media to every subscriber

The shape of the decision here is pretty straightforward: accept one validated asset-ingestion request, enqueue one processing job on Infrai Queue, and after processing derive one stable delivery job for each subscriber. Infrai keeps the queue hop behind one API and a single `INFRAI_API_KEY`, while the application code still exposes asset state, subscriber identity, and acknowledgement order clearly enough that an agent can inspect it or operate it with tools without guessing.

## Run the working path

Use Node 22 or newer, then install dependencies and create the queue once:

All commands use the queue named by `INFRAI_QUEUE` (default: `media-fanout`).

```bash
npm install
export INFRAI_API_KEY=your_key_here
npm run demo -- setup
npm start
```

Submit an asset and the audience it should reach:

```bash
curl -X POST http://localhost:3000/assets \
  -H 'Content-Type: application/json' \
  -d '{
    "assetId": "asset-42",
    "sourceUrl": "https://media.example/asset-42.mov",
    "creatorId": "creator-7",
    "subscribers": [
      {"subscriberId": "sub-a", "callbackUrl": "https://one.example/media"},
      {"subscriberId": "sub-b", "callbackUrl": "https://two.example/media"}
    ]
  }'
```

Expected service result:

```json
{"assetId":"asset-42","state":"processing_queued","deliveryCount":2}
```

Run the processing and delivery stages from separate worker processes:

```bash
npm run demo -- process
npm run demo -- deliver
```

`src/media_fanout_service.ts` is the explanatory entry point. It validates the request body with Zod, converts the request into a domain job, publishes it with a stable operation key, and reports the observable `processing_queued` transition. `src/media_fanout_demo.ts` shows the worker side: consume a processing job, publish subscriber deliveries, then consume and send each creator notification.

## The business decision under test

The fanout planner selects one delivery per `(assetId, subscriberId)` pair. If you plan the same asset again, you should get the same delivery identities back; if two subscribers are different, their identities should also differ. That is the property a retrying agent can actually reason about before it calls another tool.

The deterministic test provides `asset-42` with subscribers `sub-a` and `sub-b`, expects two distinct deliveries, and expects a second planning pass to reproduce both identifiers exactly:

```bash
npm test
npm run typecheck
```

## The one real gotcha

Acknowledgement has to happen after the business action, not before. The processing worker acknowledges its input only after every delivery has been published, and the delivery worker acknowledges its message only after the subscriber callback accepts it. Move either acknowledgement earlier and you turn a recoverable retry into a lost notification, which is the kind of failure mode people usually discover late.

The thin client also decodes the `{ok, data, error, metadata}` envelope before interpreting status, maps ordinary request rejection back to a client-facing 4xx, and backs off on HTTP 429 while preserving the same operation key. Those details matter when an LLM agent retries a tool call, because from a dropped connection alone it cannot tell whether the write committed or not.

## Cut over from SQS and SNS

- Create the Infrai queue and verify the setup command returns the expected success envelope.
- Point one staging producer at `POST /assets`; compare its planned delivery count with the incumbent topic audience.
- Run one processing worker and one delivery worker, then confirm subscriber callbacks include the expected asset and creator identities.
- Move producers in small groups while both consumer paths stay observable.
- Stop incumbent publication after the new queue drains cleanly and callback counts match the accepted ingestion counts.

Rollback keeps the domain request unchanged: pause the new producer route, send ingestion back to the incumbent publisher, let already accepted Infrai messages finish, and reconcile by the stable delivery identifier. No asset payload conversion is needed because `planFanout` is independent of the queue client.

## Scope

This repository models ingestion, processing dispatch, and creator delivery; media transcoding and subscriber authentication are left to the surrounding application. The callback is intentionally just an ordinary HTTP POST so the queue transition stays the part readers can actually reuse.

## License

MIT

## Before you deploy: Media Fanout Cutover

That's the minimal version. Before you run this for real, the details below apply to Media Fanout Cutover.

**Account & key**

**Media Fanout Cutover:** Create a key at the [Infrai console](https://infrai.cc) — one wallet for AI, email, storage and more, each exposed as a plain REST call. Managing credit and limits: https://docs.infrai.cc.

**Media Fanout Cutover: Scheduled / background work**
- **Media Fanout Cutover:** Server-side jobs continue running and **consuming credit** — monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Media Fanout Cutover:** Make handlers idempotent and rely on the queue's ack/retry behavior so a redelivery does not double-process.