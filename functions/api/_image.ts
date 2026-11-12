/**
 * Дешёвая экспертиза кадра без декодирования картинки целиком: размеры из
 * заголовка файла, форма кадра и расстояние Хэмминга между отпечатками.
 * Полноценный EXIF до сервера не доходит — клиент пережимает фото через canvas.
 */

export interface ImageSize {
  width: number;
  height: number;
}

/** Первые ~190 КБ файла: заголовки JPEG/PNG всегда в начале. */
const PREFIX_CHARS = 400_000;

function bytesOf(base64: string): Uint8Array | null {
  try {
    const head = base64.slice(0, PREFIX_CHARS);
    const padded = head.slice(0, head.length - (head.length % 4));
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

function jpegSize(bytes: Uint8Array): ImageSize | null {
  let index = 2;
  while (index + 9 < bytes.length) {
    if (bytes[index] !== 0xff) {
      index += 1;
      continue;
    }

    let marker = bytes[index + 1];
    while (marker === 0xff && index + 2 < bytes.length) {
      index += 1;
      marker = bytes[index + 1];
    }

    // Маркеры без длины сегмента.
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      index += 2;
      continue;
    }

    const length = (bytes[index + 2] << 8) | bytes[index + 3];
    const isStartOfFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isStartOfFrame) {
      const height = (bytes[index + 5] << 8) | bytes[index + 6];
      const width = (bytes[index + 7] << 8) | bytes[index + 8];
      return width > 0 && height > 0 ? { width, height } : null;
    }
    if (length < 2) return null;
    index += 2 + length;
  }
  return null;
}

/** Размеры изображения по заголовку. null — формат не распознан. */
export function readImageSize(base64: string): ImageSize | null {
  const bytes = bytesOf(base64);
  if (!bytes || bytes.length < 24) return null;

  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return jpegSize(bytes);
  return null;
}

/**
 * Кадр по форме похож на полноэкранный скриншот: снимки камеры дают 4:3, 3:4
 * или 16:9, а экран телефона — 19.5:9 и выше (после сжатия до 1280 px это
 * примерно 590×1280). Кроме задания, где скриншот положен по смыслу.
 */
export function isScreenShape(size: ImageSize | null): boolean {
  if (!size) return false;
  const ratio = size.width / size.height;
  return ratio >= 2.02 || ratio <= 0.495;
}

/** Расстояние Хэмминга между двумя 16-значными отпечатками (0–64). */
export function fingerprintDistance(left: string, right: string): number {
  if (left.length !== right.length) return 64;
  let distance = 0;
  for (let index = 0; index < left.length; index += 1) {
    const diff = parseInt(left[index], 16) ^ parseInt(right[index], 16);
    if (!Number.isFinite(diff)) return 64;
    distance += (diff & 1) + ((diff >> 1) & 1) + ((diff >> 2) & 1) + ((diff >> 3) & 1);
  }
  return distance;
}

export function isFingerprint(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{16}$/i.test(value.trim());
}
