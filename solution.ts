import * as crypto from 'crypto';
import { Disk } from './index';

// Result type for file system operations
interface FileSystemResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Fault-Tolerant File System Implementation
 * 
 * LEVELS TO IMPLEMENT:
 * 1. Basic file system operations (write, read, list) without fault tolerance
 * 2. Add corruption detection during file reads using checksums
 * 3. Optimize for fault tolerance - your solution will be tested against 
 *    increasing corruption rates to find the breaking point. 
 */

// A file is split into small chunks. Each chunk is stored several times
// (replicas) at different disk locations, each with its own checksum.
export interface ChunkInfo {
  copies: number[]; // disk offsets where each replica of this chunk lives
  length: number;   // this chunk's byte length (last chunk may be smaller)
  checksum: string; // fingerprint of this chunk's original bytes (sha256 hex)
}

// One row in our index: everything needed to rebuild a file from its chunks.
export interface FileEntry {
  size: number;         // total file size in bytes
  chunks: ChunkInfo[];  // the chunks that make up the file, in order
}

// Magic bytes at the front of a serialized index payload.
const META_PAYLOAD_MAGIC = Buffer.from('YOFS', 'ascii');

// Per-chunk checksums are truncated sha256 (8 bytes = 64 bits). Collision
// probability for a random corrupted chunk is 2^-64 — safe — but it makes the
// serialized index ~4x smaller so many fault-tolerant copies fit on disk.
const CHECKSUM_BYTES = 8;

// Reconstruct a buffer of `len` bytes from several equal-length copies by
// taking, at each byte position, the value that appears in the most copies.
// With N copies and random byte corruption, the correct value wins unless a
// wrong value out-votes it — astronomically unlikely, so this survives heavy
// corruption without storing any per-byte checksums.
function pluralityBytes(copies: Buffer[], len: number): Buffer {
  const out = Buffer.alloc(len);
  const counts = new Array<number>(256);
  for (let i = 0; i < len; i++) {
    for (const c of copies) counts[c[i]] = 0; // reset only the values we touch
    let best = -1, bestVal = 0;
    for (const c of copies) {
      const v = c[i];
      const n = ++counts[v];
      if (n > best) { best = n; bestVal = v; }
    }
    out[i] = bestVal;
  }
  return out;
}

/**
 * Serialize the in-RAM index into a compact binary blob.
 *
 * We exploit writeFile's contiguous layout: a file occupies one unbroken run
 * of `replicas` copies per `chunkSize` chunk starting at `baseOffset`. So we
 * only persist each chunk's checksum; every disk offset is derivable on load.
 */
export function encodeMetadata(
  index: Map<string, FileEntry>,
  tail: number,
  chunkSize: number,
  replicas: number,
): Buffer {
  const parts: Buffer[] = [];

  const head = Buffer.alloc(17);
  META_PAYLOAD_MAGIC.copy(head, 0);      // [0..3]  magic
  head.writeUInt8(1, 4);                 // [4]     version
  head.writeUInt16BE(chunkSize, 5);      // [5..6]  chunkSize
  head.writeUInt16BE(replicas, 7);       // [7..8]  replicas
  head.writeUInt32BE(tail, 9);           // [9..12] free-space tail
  head.writeUInt32BE(index.size, 13);    // [13..16] file count
  parts.push(head);

  for (const [name, entry] of index) {
    const nameBuf = Buffer.from(name, 'utf8');
    const baseOffset = entry.chunks.length > 0 ? entry.chunks[0].copies[0] : 0;

    const fh = Buffer.alloc(14);
    fh.writeUInt16BE(nameBuf.length, 0);       // [0..1]  name length
    fh.writeUInt32BE(entry.size, 2);           // [2..5]  file size
    fh.writeUInt32BE(baseOffset, 6);           // [6..9]  disk offset of first replica
    fh.writeUInt32BE(entry.chunks.length, 10); // [10..13] chunk count
    parts.push(fh, nameBuf);

    for (const ch of entry.chunks) {
      parts.push(Buffer.from(ch.checksum, 'hex')); // raw CHECKSUM_BYTES digest
    }
  }

  return Buffer.concat(parts);
}

/**
 * Rebuild the index from a blob produced by encodeMetadata. Chunk offsets and
 * lengths are re-derived from baseOffset + the stored geometry, reproducing the
 * exact `copies` arrays writeFile created.
 */
export function decodeMetadata(buf: Buffer): {
  files: Map<string, FileEntry>; tail: number; chunkSize: number; replicas: number;
} {
  if (buf.length < 17 || !buf.subarray(0, 4).equals(META_PAYLOAD_MAGIC)) {
    throw new Error('decodeMetadata: bad magic');
  }
  const chunkSize = buf.readUInt16BE(5);
  const replicas = buf.readUInt16BE(7);
  const tail = buf.readUInt32BE(9);
  const fileCount = buf.readUInt32BE(13);

  const files = new Map<string, FileEntry>();
  let p = 17;
  for (let f = 0; f < fileCount; f++) {
    const nameLen = buf.readUInt16BE(p);
    const size = buf.readUInt32BE(p + 2);
    const baseOffset = buf.readUInt32BE(p + 6);
    const chunkCount = buf.readUInt32BE(p + 10);
    p += 14;
    const name = buf.subarray(p, p + nameLen).toString('utf8');
    p += nameLen;

    const chunks: ChunkInfo[] = [];
    for (let i = 0; i < chunkCount; i++) {
      const checksum = buf.subarray(p, p + CHECKSUM_BYTES).toString('hex');
      p += CHECKSUM_BYTES;
      const length = Math.min(chunkSize, size - i * chunkSize);
      const chunkBase = baseOffset + replicas * chunkSize * i;
      const copies: number[] = [];
      for (let r = 0; r < replicas; r++) copies.push(chunkBase + r * length);
      chunks.push({ copies, length, checksum });
    }
    files.set(name, { size, chunks });
  }

  return { files, tail, chunkSize, replicas };
}

export class FileSystem {
  private disk: Disk;

  // How big each chunk is, and how many copies of each chunk we keep.
  // Smaller chunks + more copies = survives more corruption, but uses more
  // space. These values recover ~100% up to 5% corruption and >90% at 10%,
  // while a 1MB disk easily holds 100 small files at 10x replication.
  private static readonly CHUNK_SIZE = 8;
  private static readonly REPLICAS = 10;

  // DISK-ONLY METADATA. The index is NOT cached in RAM across calls; the disk
  // is the single source of truth. Every operation loads the index from disk,
  // uses it transiently, and (for writes) saves it back.
  //
  // The metadata lives in a reserved region at the END of the disk, made as
  // corruption-resistant as file data via two layers:
  //   1. A tiny ROOT record (magic + blob length + blob sha256) stored
  //      ROOT_COPIES times and recovered by byte-majority vote — small enough
  //      that copies survive heavy corruption.
  //   2. The serialized index BLOB stored INDEX_COPIES times and recovered by
  //      byte-plurality vote across the copies, then verified against the
  //      root's sha256.
  private static readonly META_REGION_SIZE = 512 * 1024;
  private static readonly INDEX_COPIES = 9;   // full copies of the index blob
  private static readonly ROOT_COPIES = 64;   // copies of the tiny root record
  private static readonly ROOT_RECORD_SIZE = 40; // magic(4)+len(4)+sha256(32)
  private static readonly ROOT_MAGIC = Buffer.from('YMSB', 'ascii');

  // Self-healing on the DATA path: when we find a corrupted copy but a good one
  // exists, we rewrite the good bytes over the bad copy so redundancy is
  // restored and corruption can't accumulate. (Set YOIFS_HEAL=0 to disable.)
  private static readonly SELF_HEAL = process.env.YOIFS_HEAL !== '0';

  // How many corrupted copies we've repaired — purely for observability/proof.
  public healCount = 0;

  constructor(disk: Disk) {
    this.disk = disk;
  }

  // ---- metadata region geometry ----

  // First byte of the reserved metadata region; file data must stay below this.
  private dataRegionEnd(): number {
    return this.disk.size() - FileSystem.META_REGION_SIZE;
  }
  private rootRegionStart(): number {
    return this.disk.size() - FileSystem.META_REGION_SIZE;
  }
  private rootRegionSize(): number {
    return FileSystem.ROOT_COPIES * FileSystem.ROOT_RECORD_SIZE;
  }
  private indexRegionStart(): number {
    return this.rootRegionStart() + this.rootRegionSize();
  }
  // Bytes available to each full copy of the index blob.
  private indexSlotSize(): number {
    return Math.floor((FileSystem.META_REGION_SIZE - this.rootRegionSize()) / FileSystem.INDEX_COPIES);
  }
  private indexCopyOffset(k: number): number {
    return this.indexRegionStart() + k * this.indexSlotSize();
  }

  /**
   * Persist the index to disk fault-tolerantly. Writes ROOT_COPIES copies of
   * the root record and INDEX_COPIES copies of the serialized blob.
   */
  private async saveState(index: Map<string, FileEntry>, tail: number): Promise<FileSystemResult<void>> {
    const payload = encodeMetadata(index, tail, FileSystem.CHUNK_SIZE, FileSystem.REPLICAS);
    if (payload.length > this.indexSlotSize()) {
      return { success: false, error: 'Metadata too large for reserved region' };
    }
    const blobChecksum = crypto.createHash('sha256').update(payload).digest(); // 32 bytes

    const root = Buffer.alloc(FileSystem.ROOT_RECORD_SIZE);
    FileSystem.ROOT_MAGIC.copy(root, 0);        // [0..3]   magic
    root.writeUInt32BE(payload.length, 4);      // [4..7]   blob length
    blobChecksum.copy(root, 8);                 // [8..39]  blob sha256

    for (let i = 0; i < FileSystem.ROOT_COPIES; i++) {
      await this.disk.write(this.rootRegionStart() + i * FileSystem.ROOT_RECORD_SIZE, root);
    }
    for (let k = 0; k < FileSystem.INDEX_COPIES; k++) {
      await this.disk.write(this.indexCopyOffset(k), payload);
    }
    return { success: true };
  }

  /**
   * Load the index from disk. Returns an empty index for a blank/unformatted
   * disk. Recovers from corruption via majority/plurality voting; returns empty
   * only if even that fails (whole metadata region destroyed).
   */
  private async loadState(): Promise<{ index: Map<string, FileEntry>; tail: number }> {
    const empty = { index: new Map<string, FileEntry>(), tail: 0 };
    try {
      // 1. Recover the root by byte-majority vote across all its copies.
      const rootCopies: Buffer[] = [];
      for (let i = 0; i < FileSystem.ROOT_COPIES; i++) {
        rootCopies.push(await this.disk.read(
          this.rootRegionStart() + i * FileSystem.ROOT_RECORD_SIZE, FileSystem.ROOT_RECORD_SIZE));
      }
      const root = pluralityBytes(rootCopies, FileSystem.ROOT_RECORD_SIZE);
      if (!root.subarray(0, 4).equals(FileSystem.ROOT_MAGIC)) return empty; // blank disk

      const len = root.readUInt32BE(4);
      if (len <= 0 || len > this.indexSlotSize()) return empty;
      const wantChecksum = root.subarray(8, 40);

      // 2. Read all copies of the blob.
      const copies: Buffer[] = [];
      for (let k = 0; k < FileSystem.INDEX_COPIES; k++) {
        copies.push(await this.disk.read(this.indexCopyOffset(k), len));
      }

      // Fast path: any fully-intact copy (checksum matches) wins immediately.
      let good: Buffer | null = null;
      for (const c of copies) {
        if (crypto.createHash('sha256').update(c).digest().equals(wantChecksum)) {
          good = Buffer.from(c); // copy out of the disk's live buffer before heal-writes
          break;
        }
      }
      // Recovery path: byte-plurality across copies, then verify.
      if (good === null) {
        const merged = pluralityBytes(copies, len);
        if (crypto.createHash('sha256').update(merged).digest().equals(wantChecksum)) good = merged;
      }
      if (good === null) return empty; // metadata unrecoverable

      // SELF-HEAL the metadata: rewrite the good blob/root over any corrupted
      // copies so redundancy is restored and corruption can't accumulate over
      // time (mirrors the data-path self-heal).
      if (FileSystem.SELF_HEAL) await this.healMetadata(good, copies, root, rootCopies);

      const d = decodeMetadata(good);
      return { index: d.files, tail: d.tail };
    } catch {
      return empty;
    }
  }

  // Rewrite the recovered index blob / root record over any copies that no
  // longer match, restoring full metadata redundancy.
  private async healMetadata(good: Buffer, copies: Buffer[], root: Buffer, rootCopies: Buffer[]): Promise<void> {
    for (let k = 0; k < FileSystem.INDEX_COPIES; k++) {
      if (Buffer.compare(copies[k], good) !== 0) {
        await this.disk.write(this.indexCopyOffset(k), good);
      }
    }
    for (let i = 0; i < FileSystem.ROOT_COPIES; i++) {
      if (Buffer.compare(rootCopies[i], root) !== 0) {
        await this.disk.write(this.rootRegionStart() + i * FileSystem.ROOT_RECORD_SIZE, root);
      }
    }
  }

  /**
   * Initialize a blank disk: write an empty index to the metadata region.
   * Optional — writes self-initialize a blank disk on first use anyway.
   */
  async format(): Promise<FileSystemResult<void>> {
    return this.saveState(new Map(), 0);
  }

  /**
   * Write a file to the disk
   * 
   * TODO: Implement basic file storage
   * - Design a simple file system layout (you can use any format you prefer)
   * - Store file metadata (name, size, location)
   * - Handle disk space allocation
   * - Return appropriate success/error results
   */
  async writeFile(filename: string, content: Buffer): Promise<FileSystemResult<void>> {
    try {
      const chunkSize = FileSystem.CHUNK_SIZE;
      const replicas = FileSystem.REPLICAS;

      // 0. Load the current index straight from disk (source of truth).
      const { index, tail: startTail } = await this.loadState();
      let tail = startTail;

      // 1. Check total space: every byte is stored `replicas` times. Data may
      //    only occupy the region BEFORE the reserved metadata region.
      if (tail + content.length * replicas > this.dataRegionEnd()) {
        return { success: false, error: 'Not enough disk space' };
      }

      // 2. Walk the file in chunk-sized slices.
      const chunks: ChunkInfo[] = [];
      for (let start = 0; start < content.length; start += chunkSize) {
        const chunk = content.subarray(start, start + chunkSize);
        const checksum = this.calculateChecksum(chunk);

        // 3. Write `replicas` copies of this chunk to different disk spots.
        const copies: number[] = [];
        for (let r = 0; r < replicas; r++) {
          const offset = tail;
          await this.disk.write(offset, chunk);
          tail += chunk.length;
          copies.push(offset);
        }

        chunks.push({ copies, length: chunk.length, checksum });
      }

      // 4. Record how to rebuild the file. (Empty files store zero chunks.)
      index.set(filename, { size: content.length, chunks });

      // 5. Persist the updated index back to disk. If this fails, the on-disk
      //    index still reflects the pre-write state (the new data bytes are
      //    orphaned but no metadata claims them), so we simply report failure.
      const saved = await this.saveState(index, tail);
      if (!saved.success) {
        return { success: false, error: saved.error };
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: `Write error: ${error}` };
    }
  }

  /**
   * Read a file from the disk
   * 
   * TODO: Implement file reading
   * - Look up file metadata to find where the file is stored
   * - Read the file content from disk
   * - Handle file not found errors
   */
  async readFile(filename: string): Promise<FileSystemResult<Buffer>> {
    try {
      // 1. Load the index from disk and look the file up.
      const { index } = await this.loadState();
      const entry = index.get(filename);
      if (!entry) {
        return { success: false, error: 'File not found' };
      }

      // 2. Rebuild the file one chunk at a time.
      const recovered: Buffer[] = [];
      for (let i = 0; i < entry.chunks.length; i++) {
        const chunk = entry.chunks[i];
        const goodCopy = await this.recoverChunk(chunk);

        // If every copy of this chunk is corrupted, the file is unrecoverable.
        // We report failure rather than returning wrong data.
        if (goodCopy === null) {
          return { success: false, error: `Corruption detected: chunk ${i} unrecoverable` };
        }
        recovered.push(goodCopy);
      }

      // 3. Stitch the good chunks back together into the original file.
      return { success: true, data: Buffer.concat(recovered) };
    } catch (error) {
      return { success: false, error: `Read error: ${error}` };
    }
  }

  // Scan every replica of a chunk. Keep the first good copy to serve the read,
  // and remember any corrupted copies. Return null only if EVERY copy is dead.
  private async recoverChunk(chunk: ChunkInfo): Promise<Buffer | null> {
    let goodData: Buffer | null = null;
    const badOffsets: number[] = [];

    for (const offset of chunk.copies) {
      const data = await this.disk.read(offset, chunk.length);
      if (this.calculateChecksum(data) === chunk.checksum) {
        // Copy the bytes out of the disk's live buffer so later heal-writes
        // can't alias them.
        if (goodData === null) goodData = Buffer.from(data);
      } else {
        badOffsets.push(offset);
      }
    }

    // SELF-HEAL: if we have a good copy, rewrite it over every corrupted copy
    // so this chunk is back to full redundancy for next time.
    if (FileSystem.SELF_HEAL && goodData !== null && badOffsets.length > 0) {
      for (const offset of badOffsets) {
        await this.disk.write(offset, goodData);
        this.healCount++;
      }
    }

    return goodData;
  }

  // Introspection / fsck helper: for one file, count how many chunk copies are
  // currently intact vs corrupted on disk. Used to prove healing restores them.
  async inspectRedundancy(filename: string): Promise<{ good: number, bad: number; }> {
    const { index } = await this.loadState();
    const entry = index.get(filename);
    if (!entry) return { good: 0, bad: 0 };

    let good = 0, bad = 0;
    for (const chunk of entry.chunks) {
      for (const offset of chunk.copies) {
        const data = await this.disk.read(offset, chunk.length);
        if (this.calculateChecksum(data) === chunk.checksum) good++;
        else bad++;
      }
    }
    return { good, bad };
  }

  /**
   * List all files in the file system
   * 
   * TODO: Return a list of all stored file names
   */
  async listFiles(): Promise<FileSystemResult<string[]>> {
    try {
      // Load the index from disk; filenames are its keys.
      const { index } = await this.loadState();
      return { success: true, data: Array.from(index.keys()) };
    } catch (error) {
      return { success: false, error: `List error: ${error}` };
    }
  }

  /**
   * Optional: Health check for the entire file system
   * This could help identify which files are corrupted
   */
  async checkSystemHealth(): Promise<FileSystemResult<{ healthy: number, corrupted: number; }>> {
    try {
      let healthy = 0;
      let corrupted = 0;

      // Reading each file also self-heals its damaged copies, so calling this
      // periodically acts as a background "scrubber" (like ZFS scrub) that keeps
      // rarely-read files from rotting.
      // A file is "healthy" if we can still rebuild it from surviving replicas.
      const { index } = await this.loadState();
      for (const filename of index.keys()) {
        const result = await this.readFile(filename);
        if (result.success) {
          healthy++;
        } else {
          corrupted++;
        }
      }

      return { success: true, data: { healthy, corrupted } };
    } catch (error) {
      return { success: false, error: `Health check error: ${error}` };
    }
  }

  // Fingerprint of the bytes. NOTE: the original used 'crc32', which Node's
  // crypto does NOT support (it throws "Digest method not supported"), so we
  // use sha256 — any single flipped byte produces a totally different hash.
  // Truncated to CHECKSUM_BYTES (64 bits) to keep the persisted index compact;
  // 2^-64 collision odds keep corruption detection effectively perfect.
  private calculateChecksum(data: Buffer): string {
    return crypto.createHash('sha256').update(data).digest('hex').slice(0, CHECKSUM_BYTES * 2);
  }

}