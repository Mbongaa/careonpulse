export class RequestPayloadTooLargeError extends Error {}
export class InvalidJsonBodyError extends Error {}

export async function readTextBodyLimited(request: Request, maxBytes: number): Promise<string> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new RequestPayloadTooLargeError();
  }
  if (!request.body) throw new InvalidJsonBodyError();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let part = await reader.read();
  while (!part.done) {
    if (part.value) {
      size += part.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new RequestPayloadTooLargeError();
      }
      chunks.push(part.value);
    }
    part = await reader.read();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function readJsonBodyLimited<T>(request: Request, maxBytes: number): Promise<T> {
  const body = await readTextBodyLimited(request, maxBytes);
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new InvalidJsonBodyError();
  }
}
