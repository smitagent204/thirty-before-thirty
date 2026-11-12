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
 * Отпечаток кадра (dHash 8×8): сравнение яркости соседних точек по сетке 9×8.
 * 16 шестнадцатеричных знаков. Нужен, чтобы поймать повтор уже загруженного
 * снимка — свой файл с тем же содержимым даёт тот же отпечаток.
 */
function computeFingerprint(image: HTMLImageElement): string {
  const size = 9;
  const small = document.createElement('canvas');
  small.width = size;
  small.height = 8;
  const context = small.getContext('2d', { willReadFrequently: true });
  if (!context) return '';

  context.drawImage(image, 0, 0, size, 8);
  const { data } = context.getImageData(0, 0, size, 8);

  let fingerprint = '';
  let nibble = 0;
  let bits = 0;
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const left = (y * size + x) * 4;
      const right = left + 4;
      const leftValue = data[left] * 0.299 + data[left + 1] * 0.587 + data[left + 2] * 0.114;
      const rightValue =
        data[right] * 0.299 + data[right + 1] * 0.587 + data[right + 2] * 0.114;
      nibble = (nibble << 1) | (leftValue > rightValue ? 1 : 0);
      bits += 1;
      if (bits % 4 === 0) {
        fingerprint += nibble.toString(16);
        nibble = 0;
      }
    }
  }
  return fingerprint;
}

export interface CompressedPhoto {
  image: string;
  /** Отпечаток для поиска повторов; пустая строка, если посчитать не вышло. */
  fingerprint: string;
}

/**
 * Сжимает фото перед отправкой на сервер: максимум 1280 px по длинной стороне,
 * JPEG. Такой кадр занимает ~150–400 КБ и проходит лимит D1.
 */
export async function compressPhoto(file: File): Promise<CompressedPhoto> {
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

  let fingerprint = '';
  try {
    fingerprint = computeFingerprint(image);
  } catch {
    // Canvas недоступен — проверка на повтор просто не сработает.
  }

  return { image: dataUrl, fingerprint };
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
