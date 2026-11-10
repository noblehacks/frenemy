/**
 * @file Minimal deterministic ZIP reader and stored-ZIP fixture builder.
 * @change 2026-11-07 TEST-FRENEMY-117, AC-TEST-FRENEMY-117-06 and
 * AC-TEST-FRENEMY-117-08: Added independently mockable ZIP parsing, CRC,
 * member-identity, and archive-byte validation for the live review archive.
 * @change 2026-11-07 TEST-FRENEMY-117, AC-TEST-FRENEMY-117-08: Added local
 * and central-directory bounds plus duplicate-name fixture support.
 * @change 2026-11-07 TEST-FRENEMY-117, AC-TEST-FRENEMY-117-06 and
 * AC-TEST-FRENEMY-117-08: Added deterministic deflate fixture generation and
 * retained the shared ZIP builder for direct parser-branch controls.
 */
import assert from "node:assert/strict";
import { deflateRawSync, inflateRawSync } from "node:zlib";

const signatures = Object.freeze({ local: 0x04034b50, central: 0x02014b50, end: 0x06054b50 });

function crc32(buffer) {
  let crc = 0xFFFFFFFF;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xEDB88320 : 0);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function findEndRecord(buffer) {
  const first = Math.max(0, buffer.length - 0xFFFF - 22);
  for (let offset = buffer.length - 22; offset >= first; offset -= 1) {
    if (buffer.readUInt32LE(offset) === signatures.end) return offset;
  }
  throw new Error("ZIP end record is missing");
}

/** Read and verify file members from a non-ZIP64 archive buffer. */
export function inspectZipArchive(buffer) {
  assert.ok(Buffer.isBuffer(buffer), "ZIP input must be a Buffer");
  assert.ok(buffer.length >= 22, "ZIP is truncated");
  const endOffset = findEndRecord(buffer);
  const entryCount = buffer.readUInt16LE(endOffset + 10);
  const centralSize = buffer.readUInt32LE(endOffset + 12);
  const centralOffset = buffer.readUInt32LE(endOffset + 16);
  assert.ok(centralOffset + centralSize <= endOffset, "ZIP central directory is out of bounds");

  const files = new Map();
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    assert.ok(offset + 46 <= centralOffset + centralSize, "ZIP central entry is truncated");
    assert.equal(buffer.readUInt32LE(offset), signatures.central, "ZIP central signature is invalid");
    const method = buffer.readUInt16LE(offset + 10);
    const expectedCrc = buffer.readUInt32LE(offset + 16);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    assert.ok(offset + 46 + nameLength + extraLength + commentLength <= centralOffset + centralSize, "ZIP central entry data is truncated");
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8").replaceAll("\\", "/");
    assert.ok(name, "ZIP member name is empty");
    assert.ok(localOffset + 30 <= centralOffset, `ZIP local entry is out of bounds: ${name}`);
    assert.equal(buffer.readUInt32LE(localOffset), signatures.local, `ZIP local signature is invalid: ${name}`);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    assert.ok(dataOffset + compressedSize <= buffer.length, `ZIP member is truncated: ${name}`);
    const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
    const content = method === 0 ? Buffer.from(compressed) : method === 8 ? inflateRawSync(compressed) : null;
    assert.ok(content, `ZIP compression method is unsupported: ${method}`);
    assert.equal(content.length, uncompressedSize, `ZIP member size mismatch: ${name}`);
    assert.equal(crc32(content), expectedCrc, `ZIP member CRC mismatch: ${name}`);
    if (!name.endsWith("/")) {
      assert.ok(!files.has(name), `ZIP contains duplicate member: ${name}`);
      files.set(name, content);
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  assert.equal(offset, centralOffset + centralSize, "ZIP central directory size mismatch");
  return files;
}

function createZip(entries, method) {
  const normalizedEntries = Array.isArray(entries) ? entries : Object.entries(entries);
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  for (const [name, value] of normalizedEntries) {
    const nameBuffer = Buffer.from(name.replaceAll("\\", "/"), "utf8");
    const content = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
    const compressed = method === 8 ? deflateRawSync(content) : content;
    const crc = crc32(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(signatures.local, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    localParts.push(local, nameBuffer, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(signatures.central, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, nameBuffer);
    localOffset += local.length + nameBuffer.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(signatures.end, 0);
  end.writeUInt16LE(normalizedEntries.length, 8);
  end.writeUInt16LE(normalizedEntries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

/** Build a deterministic stored ZIP for independent parser negative controls. */
export function createStoredZip(entries) {
  return createZip(entries, 0);
}

/** Build a deterministic deflate ZIP for the parser's method-8 positive control. */
export function createDeflatedZip(entries) {
  return createZip(entries, 8);
}
