import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { handle } from "hono/aws-lambda";
import { createApp } from "./app.js";
import { DynamoRateLimiter } from "./rate-limit.js";
import { DynamoDesignRepository } from "./repository.js";

const tableName = process.env.TABLE_NAME;
if (!tableName) {
  throw new Error("TABLE_NAME is required for the Egg Drop API Lambda.");
}

const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const app = createApp({
  repository: new DynamoDesignRepository(documentClient, tableName),
  rateLimiter: new DynamoRateLimiter(documentClient, tableName),
});

export const handler = handle(app);
