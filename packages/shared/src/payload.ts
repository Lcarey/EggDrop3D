export const MAX_DESIGN_PAYLOAD_BYTES = 250 * 1024;

const UTF8_ENCODER = new TextEncoder();

export function serializedJsonByteLength(payload: unknown): number {
  const serialized = typeof payload === "string" ? payload : JSON.stringify(payload);

  if (serialized === undefined) {
    throw new TypeError("Payload is not JSON serializable");
  }

  return UTF8_ENCODER.encode(serialized).byteLength;
}

export function isDesignPayloadWithinLimit(payload: unknown): boolean {
  try {
    return serializedJsonByteLength(payload) <= MAX_DESIGN_PAYLOAD_BYTES;
  } catch {
    return false;
  }
}

