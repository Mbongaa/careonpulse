const MAX_NATIVE_FILE_BYTES = 12 * 1024 * 1024;

type CareonNativeFileChannel = {
  postMessage(message: string): void;
};

function nativeChannel(): CareonNativeFileChannel | null {
  if (typeof window === "undefined" || !window.navigator.userAgent.startsWith("CareonPulseShell/")) return null;
  const candidate = (window as typeof window & { CareonNativeFile?: unknown }).CareonNativeFile;
  if (!candidate || typeof candidate !== "object" || !("postMessage" in candidate)) return null;
  const postMessage = (candidate as { postMessage?: unknown }).postMessage;
  return typeof postMessage === "function" ? (candidate as CareonNativeFileChannel) : null;
}

function downloadInBrowser(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noreferrer";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return window.btoa(binary);
}

export function hasCareonNativeFileBridge(): boolean {
  return nativeChannel() !== null;
}

/**
 * Sends already-rendered bytes to the native shell only when its injected
 * channel and exact user agent are both present. Normal browsers keep their
 * ordinary download behavior. No access/session token enters this message.
 */
export async function saveBlobThroughCareon(blob: Blob, fileName: string): Promise<void> {
  const channel = nativeChannel();
  if (!channel) {
    downloadInBrowser(blob, fileName);
    return;
  }
  if (blob.size <= 0 || blob.size > MAX_NATIVE_FILE_BYTES) {
    throw new Error("Dit bestand is te groot voor beveiligde mobiele opslag.");
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  channel.postMessage(
    JSON.stringify({
      version: 1,
      action: "share-bytes",
      fileName,
      mimeType: blob.type.split(";")[0]?.trim().toLowerCase() || "application/octet-stream",
      base64: bytesToBase64(bytes),
    }),
  );
}
