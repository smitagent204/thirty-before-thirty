function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image_load_failed'));
    };
    image.src = url;
  });
}

/**
 * Сжимает фото перед отправкой на сервер: максимум 1280 px по длинной стороне,
 * JPEG. Такой кадр занимает ~150–400 КБ и проходит лимит D1.
 */
export async function compressPhoto(file: File): Promise<string> {
  const image = await loadImage(file);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const scale = Math.min(1, 1280 / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('canvas_unavailable');

  // Белая подложка: прозрачные PNG не превращаются в чёрные.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  let dataUrl = canvas.toDataURL('image/jpeg', 0.82);
  if (dataUrl.length > 1_400_000) {
    dataUrl = canvas.toDataURL('image/jpeg', 0.68);
  }
  return dataUrl;
}

/** Читает файл как data URL без пережатия — для QR-приза. */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('read_failed'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('read_failed'));
    reader.readAsDataURL(file);
  });
}
