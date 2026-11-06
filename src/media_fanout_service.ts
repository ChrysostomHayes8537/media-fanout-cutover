import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { ZodError } from "zod";
import { AssetIngestion, planFanout } from "./fanout_plan.js";
import { InfraiError, InfraiQueue } from "./infrai_queue.js";

const queue = new InfraiQueue();
const port = Number(process.env.PORT ?? 3000);

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function reply(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function clientStatus(error: InfraiError): number {
  return error.status >= 400 && error.status < 500 ? error.status : 502;
}

const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/assets") {
    reply(response, 404, { error: "Route not found" });
    return;
  }

  try {
    const ingestion = AssetIngestion.parse(await readJson(request));
    const job = planFanout(ingestion);
    await queue.publish(job, `ingest-${job.assetId}`);
    reply(response, 202, {
      assetId: job.assetId,
      state: "processing_queued",
      deliveryCount: job.deliveries.length
    });
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) {
      reply(response, 400, { error: "Invalid asset ingestion request" });
    } else if (error instanceof InfraiError) {
      reply(response, clientStatus(error), {
        error: error.message,
        ...(error.code ? { code: error.code } : {})
      });
    } else {
      reply(response, 500, { error: "Request could not be completed" });
    }
  }
});

server.listen(port, () => console.log(`Media fanout service listening on http://localhost:${port}`));
