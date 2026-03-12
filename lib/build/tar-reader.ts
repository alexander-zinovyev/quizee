export type TarEntry = {
  name: string;
  data: Uint8Array;
};

function readCString(bytes: Uint8Array, offset: number, length: number): string {
  const end = offset + length;
  let cursor = offset;
  while (cursor < end && bytes[cursor] !== 0) {
    cursor += 1;
  }
  return new TextDecoder().decode(bytes.slice(offset, cursor)).trim();
}

function parseOctal(bytes: Uint8Array, offset: number, length: number): number {
  const raw = readCString(bytes, offset, length).replace(/\0/g, "").trim();
  if (!raw) return 0;
  const parsed = Number.parseInt(raw, 8);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isZeroBlock(block: Uint8Array): boolean {
  for (let i = 0; i < block.length; i += 1) {
    if (block[i] !== 0) return false;
  }
  return true;
}

export function readTarEntries(bytes: Uint8Array): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;

  while (offset + 512 <= bytes.length) {
    const header = bytes.slice(offset, offset + 512);
    if (isZeroBlock(header)) {
      break;
    }

    const name = readCString(header, 0, 100);
    const prefix = readCString(header, 345, 155);
    const fullName = (prefix ? `${prefix}/${name}` : name).replace(/^\.\//, "");
    const size = parseOctal(header, 124, 12);
    const typeFlag = header[156];

    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > bytes.length) {
      throw new Error("Malformed tar: entry exceeds archive bounds.");
    }

    const isDirectory = typeFlag === "5".charCodeAt(0) || fullName.endsWith("/");
    if (!isDirectory && fullName) {
      entries.push({
        name: fullName,
        data: bytes.slice(dataStart, dataEnd),
      });
    }

    const paddedSize = Math.ceil(size / 512) * 512;
    offset = dataStart + paddedSize;
  }

  return entries;
}
