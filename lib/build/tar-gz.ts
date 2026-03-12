import { gzipSync } from "fflate";

type TarEntry = {
  name: string;
  data: Uint8Array;
};

function writeString(target: Uint8Array, offset: number, length: number, value: string) {
  const encoded = new TextEncoder().encode(value);
  target.set(encoded.slice(0, length), offset);
}

function writeOctal(target: Uint8Array, offset: number, length: number, value: number) {
  const raw = Math.max(0, value).toString(8);
  const padded = raw.padStart(length - 1, "0").slice(-(length - 1));
  writeString(target, offset, length - 1, padded);
  target[offset + length - 1] = 0;
}

function createHeader(name: string, size: number, mtime: number): Uint8Array {
  const header = new Uint8Array(512);

  writeString(header, 0, 100, name);
  writeOctal(header, 100, 8, 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, mtime);

  for (let i = 148; i < 156; i += 1) {
    header[i] = 0x20;
  }

  header[156] = "0".charCodeAt(0);
  writeString(header, 257, 6, "ustar");
  writeString(header, 263, 2, "00");

  const checksum = header.reduce((acc, byte) => acc + byte, 0);
  writeOctal(header, 148, 8, checksum);

  return header;
}

function padTo512(bytes: Uint8Array): Uint8Array {
  const remainder = bytes.length % 512;
  if (remainder === 0) return bytes;
  const padded = new Uint8Array(bytes.length + (512 - remainder));
  padded.set(bytes);
  return padded;
}

export function createTar(entries: TarEntry[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const mtime = Math.floor(Date.now() / 1000);

  entries.forEach((entry) => {
    parts.push(createHeader(entry.name, entry.data.length, mtime));
    parts.push(padTo512(entry.data));
  });

  parts.push(new Uint8Array(1024));

  const totalSize = parts.reduce((acc, part) => acc + part.length, 0);
  const archive = new Uint8Array(totalSize);
  let offset = 0;
  parts.forEach((part) => {
    archive.set(part, offset);
    offset += part.length;
  });

  return archive;
}

export function createTarGz(entries: TarEntry[]): Uint8Array {
  return gzipSync(createTar(entries));
}
