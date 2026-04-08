/**
 * Resizes an image buffer to fit within Bedrock's 5 MB vision limit.
 * Uses canvas (already in serverExternalPackages).
 * Returns the original buffer if already small enough.
 */

const MAX_BYTES = 3.5 * 1024 * 1024; // 3.5 MB — safely under Bedrock's 5 MB cap

export async function resizeImageIfNeeded(
  buffer: Buffer,
  mimeType: string,
): Promise<{ buffer: Buffer; mimeType: string }> {
  if (buffer.length <= MAX_BYTES) return { buffer, mimeType };

  const { createCanvas, loadImage } = await import('canvas');

  const img = await loadImage(buffer);

  // Scale down proportionally so output fits under the byte limit.
  // This is a rough estimate — JPEG re-encoding may produce slightly different sizes.
  const scale = Math.sqrt(MAX_BYTES / buffer.length) * 0.9; // 0.9 safety margin
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));

  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img as any, 0, 0, w, h);

  const resized = canvas.toBuffer('image/jpeg', { quality: 0.82 });
  return { buffer: resized, mimeType: 'image/jpeg' };
}
