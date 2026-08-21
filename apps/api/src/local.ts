import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { InMemoryRateLimiter } from "./rate-limit.js";
import { InMemoryDesignRepository } from "./repository.js";

const port = Number(process.env.PORT ?? 8787);
const app = createApp({
  repository: new InMemoryDesignRepository(),
  rateLimiter: new InMemoryRateLimiter(),
});

serve({ fetch: app.fetch, hostname: "127.0.0.1", port }, ({ port: listeningPort }) => {
  console.log(`Egg Drop API listening on http://localhost:${listeningPort}`);
});
