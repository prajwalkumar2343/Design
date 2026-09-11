import { describe, expect, it } from "vitest";
import { createZipArchive, crc32 } from "./zip";

const encoder = new TextEncoder();

interface ParsedEntry {
  name: string;
  data: Uint8Array;
  crc32: number;
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function u16(bytes: Uint8Array, offset: number): number {
  return view(bytes).getUint16(offset, true);
}

function u32(bytes: Uint8Array, offset: number): number {
  return view(bytes).getUint32(offset, true);
}

/** Sequentially walks local headers then asserts central directory + EOCD. */
export function parseZipArchive(bytes: Uint8Array): ParsedEntry[] {
  const entries: ParsedEntry[] = [];
  let offset = 0;

  while (offset < bytes.length && u32(bytes, offset) === 0x04034b50) {
    const flags = u16(bytes, offset + 6);
    const method = u16(bytes, offset + 8);
    const compressedSize = u32(bytes, offset + 18);
    const uncompressedSize = u32(bytes, offset + 22);
    const nameLength = u16(bytes, offset + 26);
    const extraLength = u16(bytes, offset + 28);
    expect(flags & 0x08).toBe(0);
    expect(flags & 0x800).toBe(0x800);
    expect(method).toBe(0);
    expect(compressedSize).toBe(uncompressedSize);
    const name = new TextDecoder().decode(bytes.slice(offset + 30, offset + 30 + nameLength));
    const dataStart = offset + 30 + nameLength + extraLength;
    const data = bytes.slice(dataStart, dataStart + compressedSize);
    entries.push({ name, data, crc32: u32(bytes, offset + 14) });
    offset = dataStart + compressedSize;
  }

  const centralOffset = offset;
  if (entries.length > 0) {
    expect(u32(bytes, offset)).toBe(0x02014b50);
  }
  let centralCursor = offset;
  for (let i = 0; i < entries.length; i += 1) {
    expect(u32(bytes, centralCursor)).toBe(0x02014b50);
    const nameLength = u16(bytes, centralCursor + 28);
    const extraLength = u16(bytes, centralCursor + 30);
    const commentLength = u16(bytes, centralCursor + 32);
    const localHeaderOffset = u32(bytes, centralCursor + 42);
    expect(localHeaderOffset).toBeGreaterThanOrEqual(0);
    const name = new TextDecoder().decode(
      bytes.slice(centralCursor + 46, centralCursor + 46 + nameLength),
    );
    expect(name).toBe(entries[i]!.name);
    centralCursor += 46 + nameLength + extraLength + commentLength;
  }

  expect(u32(bytes, centralCursor)).toBe(0x06054b50);
  expect(u16(bytes, centralCursor + 8)).toBe(entries.length);
  expect(u16(bytes, centralCursor + 10)).toBe(entries.length);
  expect(u32(bytes, centralCursor + 12)).toBe(centralCursor - centralOffset);
  expect(u32(bytes, centralCursor + 16)).toBe(centralOffset);
  expect(u16(bytes, centralCursor + 20)).toBe(0);
  expect(centralCursor + 22).toBe(bytes.length);

  return entries;
}

describe("crc32", () => {
  it("matches the canonical check value", () => {
    expect(crc32(encoder.encode("123456789"))).toBe(0xcbf43926);
  });

  it("returns zero for empty input", () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe("createZipArchive", () => {
  it("emits a valid empty archive", () => {
    const bytes = createZipArchive([]);
    expect(bytes.length).toBe(22);
    expect(u32(bytes, 0)).toBe(0x06054b50);
    expect(parseZipArchive(bytes)).toHaveLength(0);
  });

  it("stores one entry verbatim", () => {
    const html = "<!doctype html><html><body>Hello</body></html>";
    const bytes = createZipArchive([{ name: "index.html", data: html }]);
    const [entry] = parseZipArchive(bytes);
    expect(entry!.name).toBe("index.html");
    expect(new TextDecoder().decode(entry!.data)).toBe(html);
    expect(entry!.crc32).toBe(crc32(encoder.encode(html)));
  });

  it("supports multiple UTF-8 named entries and binary payloads", () => {
    const bytes = createZipArchive([
      { name: "pages/index.html", data: "<h1>Home</h1>" },
      { name: "pages/lumina-station.html", data: "<h1>Lumina</h1>" },
      { name: "assets/blob.bin", data: new Uint8Array([0, 1, 2, 255, 254]) },
    ]);
    const entries = parseZipArchive(bytes);
    expect(entries.map((entry) => entry.name)).toEqual([
      "pages/index.html",
      "pages/lumina-station.html",
      "assets/blob.bin",
    ]);
    expect(Array.from(entries[2]!.data)).toEqual([0, 1, 2, 255, 254]);
  });
});
