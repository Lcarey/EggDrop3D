import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { anonymizeRateLimitIdentity } from "./security.js";

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
}

export interface RateLimiter {
  consume(
    bucket: string,
    identity: string,
    limit: number,
    windowMs: number,
    nowMs: number,
  ): Promise<RateLimitResult>;
}

interface MemoryCounter {
  count: number;
  resetAt: number;
}

export class InMemoryRateLimiter implements RateLimiter {
  readonly #counters = new Map<string, MemoryCounter>();

  async consume(
    bucket: string,
    identity: string,
    limit: number,
    windowMs: number,
    nowMs: number,
  ): Promise<RateLimitResult> {
    const windowStart = Math.floor(nowMs / windowMs) * windowMs;
    const resetAt = windowStart + windowMs;
    const key = `${bucket}:${identity}:${windowStart}`;
    const existing = this.#counters.get(key);
    const count = (existing?.count ?? 0) + 1;
    this.#counters.set(key, { count, resetAt });

    // Opportunistic cleanup keeps a long-running local server bounded.
    if (this.#counters.size > 1_000) {
      for (const [counterKey, counter] of this.#counters) {
        if (counter.resetAt <= nowMs) this.#counters.delete(counterKey);
      }
    }

    return {
      allowed: count <= limit,
      limit,
      remaining: Math.max(0, limit - count),
      resetAt,
    };
  }
}

export class DynamoRateLimiter implements RateLimiter {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async consume(
    bucket: string,
    identity: string,
    limit: number,
    windowMs: number,
    nowMs: number,
  ): Promise<RateLimitResult> {
    const windowStart = Math.floor(nowMs / windowMs) * windowMs;
    const resetAt = windowStart + windowMs;
    const identityHash = anonymizeRateLimitIdentity(identity);
    const pk = `RATE_LIMIT#${bucket}#${identityHash}#${windowStart}`;

    const result = await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { pk, sk: "RATE_LIMIT" },
        UpdateExpression:
          "SET #count = if_not_exists(#count, :zero) + :one, #ttl = :ttl",
        ExpressionAttributeNames: {
          "#count": "count",
          "#ttl": "ttl",
        },
        ExpressionAttributeValues: {
          ":zero": 0,
          ":one": 1,
          // Keep expired windows briefly for diagnostics; DynamoDB TTL cleanup is asynchronous.
          ":ttl": Math.ceil(resetAt / 1_000) + 120,
        },
        ReturnValues: "UPDATED_NEW",
      }),
    );

    const count = Number(result.Attributes?.count ?? 1);
    return {
      allowed: count <= limit,
      limit,
      remaining: Math.max(0, limit - count),
      resetAt,
    };
  }
}
