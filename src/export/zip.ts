/**
 * Minimal dependency-free ZIP writer (STORE method, no compression).
 *
 * Produces spec-compliant archives readable by macOS Finder, Windows Explorer,
 * and every mainstream unzip utility. Entries are stored uncompressed, which
 * is ideal for already-compressed text like HTML/CSS exports and keeps the
 * writer small enough to audit at a glance.
 */

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc = CRC32_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntryInput {
  /** Entry path inside the archive, e.g. `pages/index.html`. */
  name: string;
  data: string | Uint8Array;
}

function pushBytes(state: { chunks: Uint8Array[]; length: number }, bytes: Uint8Array): void {
  state.chunks.push(bytes);
  state.length += bytes.length;
}

function u16(value: number): Uint8Array {
  const bytes = new Uint8Array(2);
  bytes[0] = value & 0xff;
  bytes[1] = (value >>> 8) & 0xff;
  return bytes;
}

function u32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  bytes[0] = value & 0xff;
  bytes[1] = (value >>> 8) & 0xff;
  bytes[2] = (value >>> 16) & 0xff;
  bytes[3] = (value >>> 24) & 0xff;
  return bytes;
}

/** DOS timestamp clamped to the ZIP format's 1980 floor. */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

export function createZipArchive(entries: readonly ZipEntryInput[]): Uint8Array {
  const encoder = new TextEncoder();
  const now = dosDateTime(new Date());
  const local = { chunks: [] as Uint8Array[], length: 0 };
  const central = { chunks: [] as Uint8Array[], length: 0 };
  let entryCount = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const dataBytes = typeof entry.data === "string" ? encoder.encode(entry.data) : entry.data;
    const checksum = crc32(dataBytes);
    const offset = local.length;

    pushBytes(local, u32(0x04034b50));
    pushBytes(local, u16(20));
    pushBytes(local, u16(0x0800));
    pushBytes(local, u16(0));
    pushBytes(local, u16(now.time));
    pushBytes(local, u16(now.date));
    pushBytes(local, u32(checksum));
    pushBytes(local, u32(dataBytes.length));
    pushBytes(local, u32(dataBytes.length));
    pushBytes(local, u16(nameBytes.length));
    pushBytes(local, u16(0));
    pushBytes(local, nameBytes);
    pushBytes(local, dataBytes);

    pushBytes(central, u32(0x02014b50));
    pushBytes(central, u16(20));
    pushBytes(central, u16(20));
    pushBytes(central, u16(0x0800));
    pushBytes(central, u16(0));
    pushBytes(central, u16(now.time));
    pushBytes(central, u16(now.date));
    pushBytes(central, u32(checksum));
    pushBytes(central, u32(dataBytes.length));
    pushBytes(central, u32(dataBytes.length));
    pushBytes(central, u16(nameBytes.length));
    pushBytes(central, u16(0));
    pushBytes(central, u16(0));
    pushBytes(central, u16(0));
    pushBytes(central, u16(0));
    pushBytes(central, u32(0));
    pushBytes(central, u32(offset));
    pushBytes(central, nameBytes);
    entryCount += 1;
  }

  const eocd: Uint8Array[] = [];
  let eocdLength = 0;
  const pushEocd = (bytes: Uint8Array) => {
    eocd.push(bytes);
    eocdLength += bytes.length;
  };
  pushEocd(u32(0x06054b50));
  pushEocd(u16(0));
  pushEocd(u16(0));
  pushEocd(u16(entryCount));
  pushEocd(u16(entryCount));
  pushEocd(u32(central.length));
  pushEocd(u32(local.length));
  pushEocd(u16(0));

  const archive = new Uint8Array(local.length + central.length + eocdLength);
  let cursor = 0;
  for (const chunk of [...local.chunks, ...central.chunks, ...eocd]) {
    archive.set(chunk, cursor);
    cursor += chunk.length;
  }
  return archive;
}
