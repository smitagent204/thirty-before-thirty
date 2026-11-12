import type { PhotoMeta } from '@shared/types';

/**
 * Читает минимум метаданных из исходного JPEG до пережатия: снято ли на
 * камеру и чем обрабатывалось. Скачанные из интернета и скриншоты обычно идут
 * без данных камеры — это подсказка для проверки происхождения, не приговор:
 * мессенджеры тоже вырезают метаданные.
 */
const MAX_HEADER = 256 * 1024;

function readAscii(view: DataView, start: number, count: number): string {
  let out = '';
  for (let index = 0; index < count; index += 1) {
    const code = view.getUint8(start + index);
    if (code === 0) break;
    out += String.fromCharCode(code);
  }
  return out.trim();
}

interface TiffEntry {
  tag: number;
  type: number;
  count: number;
  /** Смещение поля значения внутри TIFF-блока. */
  valueOffset: number;
}

function readEntries(view: DataView, offset: number, little: boolean): TiffEntry[] {
  if (offset < 0 || offset + 2 > view.byteLength) return [];
  const count = view.getUint16(offset, little);
  if (count > 300) return [];
  const entries: TiffEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    const entry = offset + 2 + index * 12;
    if (entry + 12 > view.byteLength) break;
    entries.push({
      tag: view.getUint16(entry, little),
      type: view.getUint16(entry + 2, little),
      count: view.getUint32(entry + 4, little),
      valueOffset: entry + 8,
    });
  }
  return entries;
}

function asciiValue(view: DataView, entry: TiffEntry, little: boolean): string {
  if (entry.type !== 2 || entry.count === 0 || entry.count > 64) return '';
  if (entry.count <= 4) return readAscii(view, entry.valueOffset, entry.count);
  const pointer = view.getUint32(entry.valueOffset, little);
  if (pointer + entry.count > view.byteLength) return '';
  return readAscii(view, pointer, entry.count);
}

function parseTiff(bytes: Uint8Array, base: number): PhotoMeta | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset + base, bytes.byteLength - base);
  if (view.byteLength < 8) return null;

  const byteOrder = view.getUint16(0);
  if (byteOrder !== 0x4949 && byteOrder !== 0x4d4d) return null;
  const little = byteOrder === 0x4949;
  if (view.getUint16(2, little) !== 42) return null;

  const ifd0 = view.getUint32(4, little);
  const entries = readEntries(view, ifd0, little);
  if (entries.length === 0) return null;

  const meta: PhotoMeta = {};
  const byTag = (tag: number) => entries.find((entry) => entry.tag === tag);
  const make = byTag(0x010f);
  const model = byTag(0x0110);
  const software = byTag(0x0131);
  const exifIfd = byTag(0x8769);
  const gpsIfd = byTag(0x8825);

  const modelText = model ? asciiValue(view, model, little) : '';
  const makeText = make ? asciiValue(view, make, little) : '';
  const cameraName = [makeText, modelText].filter(Boolean).join(' ');
  if (cameraName) {
    meta.camera = true;
    meta.model = cameraName.slice(0, 40);
  } else {
    // Тег есть, но камеры нет — для проверки это тот же сигнал, что и пусто.
    meta.camera = false;
  }

  const softwareText = software ? asciiValue(view, software, little) : '';
  if (softwareText) meta.software = softwareText.slice(0, 40);

  if (exifIfd) {
    const exifOffset = view.getUint32(exifIfd.valueOffset, little);
    const exifEntries = readEntries(view, exifOffset, little);
    if (exifEntries.some((entry) => entry.tag === 0x9003)) meta.takenAt = true;
  }
  if (gpsIfd) meta.gps = true;

  return meta;
}

export async function readPhotoMeta(file: File): Promise<PhotoMeta | null> {
  try {
    const buffer = await file.slice(0, MAX_HEADER).arrayBuffer();
    const bytes = new Uint8Array(buffer);
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

    let offset = 2;
    while (offset + 10 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1];
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }
      const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
      if (length < 2) return null;

      if (marker === 0xe1 && length >= 8 && offset + 10 < bytes.length) {
        const start = offset + 4;
        if (
          bytes[start] === 0x45 &&
          bytes[start + 1] === 0x78 &&
          bytes[start + 2] === 0x69 &&
          bytes[start + 3] === 0x66 &&
          bytes[start + 4] === 0x00 &&
          bytes[start + 5] === 0x00
        ) {
          return parseTiff(bytes, start + 6) ?? { camera: false };
        }
      }
      offset += 2 + length;
    }
    // JPEG без EXIF: данных камеры точно нет.
    return { camera: false };
  } catch {
    return null;
  }
}
