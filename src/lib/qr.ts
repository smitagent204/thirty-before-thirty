import jsQR from 'jsqr';

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('image_load_failed'));
    image.src = src;
  });
}

/**
 * Локально распознаёт QR и возвращает только http(s)-ссылку.
 * Ссылка не показывается текстом и никуда не отправляется.
 */
export async function decodeQrLink(dataUrl: string): Promise<string | null> {
  const image = await loadImage(dataUrl);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (!sourceWidth || !sourceHeight) return null;

  // Ограничение по памяти на iPhone: больше 2048 px для QR не нужно.
  const scale = Math.min(1, 2048 / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  const pixels = context.getImageData(0, 0, width, height);
  const result = jsQR(pixels.data, pixels.width, pixels.height, {
    inversionAttempts: 'attemptBoth',
  });

  if (!result) return null;
  const value = result.data.trim();
  return /^https?:\/\//i.test(value) ? value : null;
}
