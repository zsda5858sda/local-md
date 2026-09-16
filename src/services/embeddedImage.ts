const SUPPORTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml", "image/bmp"]);
const IMAGE_TYPE_BY_EXTENSION: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp",
};

function imageMime(file: File): string | null {
  if (SUPPORTED_IMAGE_TYPES.has(file.type)) return file.type;
  const extension = file.name.split(".").at(-1)?.toLowerCase() ?? "";
  return IMAGE_TYPE_BY_EXTENSION[extension] ?? null;
}

export async function imageDataFromFile(file: File): Promise<{ dataUri: string; fileName: string } | null> {
  const mime = imageMime(file);
  if (!mime) return null;
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return { dataUri: `data:${mime};base64,${btoa(binary)}`, fileName: file.name || "貼上圖片" };
}
