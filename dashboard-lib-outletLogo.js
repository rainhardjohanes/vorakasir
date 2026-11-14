export const OUTLET_LOGO_SIZE = 500;
export const OUTLET_LOGO_MAX_BYTES = 300000;

export function outletLogoActions(asset) {
  if (typeof asset?.uri !== 'string' || !asset.uri || !Number.isFinite(asset.width) || !Number.isFinite(asset.height) || asset.width <= 0 || asset.height <= 0) {
    throw new Error('Ukuran gambar tidak dapat dibaca. Pilih ulang logo dari galeri.');
  }
  const side = Math.min(asset.width, asset.height);
  return [
    ...(asset.width === asset.height ? [] : [{ crop: { originX: Math.floor((asset.width - side) / 2), originY: Math.floor((asset.height - side) / 2), width: side, height: side } }]),
    { resize: { width: OUTLET_LOGO_SIZE, height: OUTLET_LOGO_SIZE } },
  ];
}

/** Prepare and verify the actual upload bytes, never just a preview URI. */
export async function prepareOutletLogo(asset, { manipulate, readBytes }) {
  const actions = outletLogoActions(asset);
  // Keep transparent logos as PNG when they fit; photographic logos can use JPEG.
  for (const [format, compress] of [['png', 1], ['jpeg', 0.85], ['jpeg', 0.65], ['jpeg', 0.45], ['jpeg', 0.25]]) {
    const image = await manipulate(asset.uri, actions, { format, compress });
    if (image.width !== OUTLET_LOGO_SIZE || image.height !== OUTLET_LOGO_SIZE) throw new Error('Logo belum berukuran 500 × 500 piksel. Pilih ulang gambar.');
    const bytes = await readBytes(image.uri);
    const length = bytes?.byteLength;
    if (!Number.isSafeInteger(length) || length <= 0) throw new Error('Berkas logo kosong atau tidak dapat dibaca. Pilih ulang gambar.');
    if (length <= OUTLET_LOGO_MAX_BYTES) return { ...image, bytes, contentType: `image/${format}`, extension: format === 'jpeg' ? 'jpeg' : 'png' };
  }
  throw new Error('Logo masih melebihi 300 KB setelah dikompres. Gunakan gambar logo yang lebih sederhana.');
}
