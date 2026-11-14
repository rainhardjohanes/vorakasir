import { prepareOutletLogo } from '/dashboard-lib-outletLogo.js';

const abort = signal => { if (signal?.aborted) throw new DOMException('Permintaan dibatalkan.', 'AbortError'); };
async function decodeLogo(file) {
  if (typeof globalThis.createImageBitmap === 'function') return globalThis.createImageBitmap(file);
  const source = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Gambar logo tidak dapat dibaca. Pilih ulang gambar.'));
    reader.readAsDataURL(file);
  });
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Gambar logo tidak dapat dibaca. Pilih ulang gambar.'));
    image.src = source;
  });
}

// Uses the APK's exact crop, dimensions, compression ladder and byte limit.
// Local image bytes stay in memory; neither fetch(blob:) nor a public upload
// happens until the final bytes have passed the common validation.
export async function prepareBrowserOutletLogo(file, {
  signal, decodeImage = decodeLogo, createCanvas = () => document.createElement('canvas'),
} = {}) {
  abort(signal);
  if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)
    || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > 2 * 1024 * 1024) {
    throw new Error('Gunakan PNG, JPG, atau WebP maksimal 2 MB.');
  }
  let image;
  try {
    image = await decodeImage(file);
    abort(signal);
    const width = image.width || image.naturalWidth, height = image.height || image.naturalHeight;
    const outputs = new Map();
    return await prepareOutletLogo({ uri: 'memory:outlet-logo', width, height }, {
      async manipulate(_uri, actions, { format, compress }) {
        abort(signal);
        const crop = actions.find(action => action.crop)?.crop || { originX: 0, originY: 0, width, height };
        const resize = actions.find(action => action.resize)?.resize;
        const canvas = createCanvas();
        canvas.width = resize.width; canvas.height = resize.height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Browser belum dapat memproses logo. Coba browser terbaru.');
        if (format === 'jpeg') { context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height); }
        context.drawImage(image, crop.originX, crop.originY, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, `image/${format}`, compress));
        abort(signal);
        if (!blob || blob.type !== `image/${format}`) throw new Error('Gambar logo belum dapat diproses. Pilih ulang gambar.');
        const uri = `memory:outlet-logo/${format}/${compress}`;
        outputs.set(uri, blob);
        return { uri, width: canvas.width, height: canvas.height };
      },
      async readBytes(uri) { abort(signal); return outputs.get(uri).arrayBuffer(); },
    });
  } finally {
    image?.close?.();
  }
}
