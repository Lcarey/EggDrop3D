import type { DesignV1 } from "@eggdrop/shared";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

export interface DesignRecord {
  id: string;
  design: DesignV1;
  editTokenHash: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ReplaceDesignInput {
  id: string;
  design: DesignV1;
  editTokenHash: string;
  expectedVersion: number;
  updatedAt: string;
}

export interface DeleteDesignInput {
  id: string;
  editTokenHash: string;
  expectedVersion: number;
}

export interface DesignRepository {
  /** Returns false only for the vanishingly unlikely case of an id collision. */
  create(record: DesignRecord): Promise<boolean>;
  get(id: string): Promise<DesignRecord | null>;
  /** Returns null when the token/version condition no longer matches. */
  replace(input: ReplaceDesignInput): Promise<DesignRecord | null>;
  /** Returns false when the token/version condition no longer matches. */
  delete(input: DeleteDesignInput): Promise<boolean>;
}

export class InMemoryDesignRepository implements DesignRepository {
  readonly #records = new Map<string, DesignRecord>();

  async create(record: DesignRecord): Promise<boolean> {
    if (this.#records.has(record.id)) return false;
    this.#records.set(record.id, structuredClone(record));
    return true;
  }

  async get(id: string): Promise<DesignRecord | null> {
    const record = this.#records.get(id);
    return record ? structuredClone(record) : null;
  }

  async replace(input: ReplaceDesignInput): Promise<DesignRecord | null> {
    const current = this.#records.get(input.id);
    if (
      !current ||
      current.version !== input.expectedVersion ||
      current.editTokenHash !== input.editTokenHash
    ) {
      return null;
    }

    const next: DesignRecord = {
      ...current,
      design: structuredClone(input.design),
      version: current.version + 1,
      updatedAt: input.updatedAt,
    };
    this.#records.set(input.id, next);
    return structuredClone(next);
  }

  async delete(input: DeleteDesignInput): Promise<boolean> {
    const current = this.#records.get(input.id);
    if (
      !current ||
      current.version !== input.expectedVersion ||
      current.editTokenHash !== input.editTokenHash
    ) {
      return false;
    }

    return this.#records.delete(input.id);
  }
}

interface DynamoDesignItem extends DesignRecord {
  pk: string;
  sk: "DESIGN";
  entityType: "DESIGN";
}

const DESIGN_SORT_KEY = "DESIGN";

function designPartitionKey(id: string): string {
  return `DESIGN#${id}`;
}

function isConditionalCheckFailure(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "ConditionalCheckFailedException"
  );
}

function fromDynamoItem(item: DynamoDesignItem): DesignRecord {
  return {
    id: item.id,
    design: item.design,
    editTokenHash: item.editTokenHash,
    version: item.version,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export class DynamoDesignRepository implements DesignRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async create(record: DesignRecord): Promise<boolean> {
    const item: DynamoDesignItem = {
      pk: designPartitionKey(record.id),
      sk: DESIGN_SORT_KEY,
      entityType: "DESIGN",
      ...record,
    };

    try {
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: item,
          ConditionExpression: "attribute_not_exists(pk)",
        }),
      );
      return true;
    } catch (error) {
      if (isConditionalCheckFailure(error)) return false;
      throw error;
    }
  }

  async get(id: string): Promise<DesignRecord | null> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: designPartitionKey(id), sk: DESIGN_SORT_KEY },
        ConsistentRead: true,
      }),
    );

    return result.Item ? fromDynamoItem(result.Item as DynamoDesignItem) : null;
  }

  async replace(input: ReplaceDesignInput): Promise<DesignRecord | null> {
    try {
      const result = await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { pk: designPartitionKey(input.id), sk: DESIGN_SORT_KEY },
          UpdateExpression:
            "SET #design = :design, #version = #version + :one, updatedAt = :updatedAt",
          ConditionExpression:
            "attribute_exists(pk) AND #version = :expectedVersion AND editTokenHash = :editTokenHash",
          ExpressionAttributeNames: {
            "#design": "design",
            "#version": "version",
          },
          ExpressionAttributeValues: {
            ":design": input.design,
            ":one": 1,
            ":updatedAt": input.updatedAt,
            ":expectedVersion": input.expectedVersion,
            ":editTokenHash": input.editTokenHash,
          },
          ReturnValues: "ALL_NEW",
        }),
      );

      return result.Attributes
        ? fromDynamoItem(result.Attributes as DynamoDesignItem)
        : null;
    } catch (error) {
      if (isConditionalCheckFailure(error)) return null;
      throw error;
    }
  }

  async delete(input: DeleteDesignInput): Promise<boolean> {
    try {
      await this.client.send(
        new DeleteCommand({
          TableName: this.tableName,
          Key: { pk: designPartitionKey(input.id), sk: DESIGN_SORT_KEY },
          ConditionExpression:
            "attribute_exists(pk) AND #version = :expectedVersion AND editTokenHash = :editTokenHash",
          ExpressionAttributeNames: { "#version": "version" },
          ExpressionAttributeValues: {
            ":expectedVersion": input.expectedVersion,
            ":editTokenHash": input.editTokenHash,
          },
        }),
      );
      return true;
    } catch (error) {
      if (isConditionalCheckFailure(error)) return false;
      throw error;
    }
  }
}
