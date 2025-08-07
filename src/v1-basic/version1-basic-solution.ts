import { Logger } from './index';
import * as crypto from 'crypto';
import { Disk } from './index';

interface FileSystemResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface FileMeta {
  name: string;
  offset: number;
  size: number;
  checksum: string;
  replicaOffset: number;
}

export class FileSystem {
  private disk: Disk;
  private blockSize = 512;
  private fatOffset = 0;
  private fatSize = 32768; // 32 KB for FAT
  private fileMetaList: FileMeta[] = [];
  private fatLoaded = false;
  private fatCorrupted = false;

  constructor(disk: Disk) {
    this.disk = disk;
  }

  // helper function to calculate checksum, feel free to use this or implement your own
  private calculateChecksum(data: Buffer): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  private async loadFAT() {
    if (this.fatLoaded && !this.fatCorrupted) return;
    try {
      const raw = await this.disk.read(this.fatOffset, this.fatSize);
      const json = raw.toString().replace(/\0+$/, '');
      this.fileMetaList = json.trim() ? JSON.parse(json) : [];
      this.fatCorrupted = false;
      Logger.info(`[YOIFS] FAT loaded (${this.fileMetaList.length} files).`);
    } catch (e) {
      Logger.error('[YOIFS] Could not load FAT! Disk might be empty or corrupted.');
      this.fileMetaList = [];
      this.fatCorrupted = true;
    }
    this.fatLoaded = true;
  }

  private async saveFAT() {
    const json = JSON.stringify(this.fileMetaList);
    if (Buffer.byteLength(json) > this.fatSize) {
      Logger.error('[YOIFS] FAT overflow! Too many files or file names too long.');
      throw new Error('FAT overflow: too many files or file names too long');
    }
    const buf = Buffer.alloc(this.fatSize, 0);
    buf.write(json);
    await this.disk.write(this.fatOffset, buf);
  }

  private getNextOffset(): number {
    let maxEnd = this.fatOffset + this.fatSize;
    for (const meta of this.fileMetaList) {
      maxEnd = Math.max(maxEnd, meta.offset + meta.size, meta.replicaOffset + meta.size);
    }
    return Math.ceil(maxEnd / this.blockSize) * this.blockSize;
  }

  async writeFile(fileName: string, content: Buffer): Promise<FileSystemResult<void>> {
    await this.loadFAT();
    if (this.fatCorrupted) {
      Logger.error('[YOIFS] Cannot write file: FAT is corrupted!');
      return { success: false, error: 'FAT corrupted' };
    }
    this.fileMetaList = this.fileMetaList.filter(f => f.name !== fileName);
    const offset = this.getNextOffset();
    const replicaOffset = offset + Math.ceil(content.length / this.blockSize) * this.blockSize;
    const checksum = this.calculateChecksum(content);
    const meta: FileMeta = { name: fileName, offset, size: content.length, checksum, replicaOffset };
    const diskSize = this.disk.size ? this.disk.size() : Infinity;
    if (replicaOffset + content.length > diskSize) {
      Logger.error('[YOIFS] Not enough disk space for file and replica!');
      return { success: false, error: 'Disk full: not enough space for file and replica' };
    }
    try {
      await this.disk.write(offset, content);
      await this.disk.write(replicaOffset, content);
      this.fileMetaList.push(meta);
      await this.saveFAT();
      return { success: true };
    } catch (error: any) {
      Logger.error(`[YOIFS] Failed to write file '${fileName}': ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  async readFile(fileName: string): Promise<FileSystemResult<Buffer>> {
    await this.loadFAT();
    if (this.fatCorrupted) {
      Logger.error('[YOIFS] Cannot read file: FAT is corrupted!');
      return { success: false, error: 'FAT corrupted' };
    }
    const meta = this.fileMetaList.find(f => f.name === fileName);
    if (!meta) {
      Logger.info(`[YOIFS] File '${fileName}' not found.`);
      return { success: false, error: 'File not found' };
    }
    let primary: Buffer | undefined, replica: Buffer | undefined;
    let primaryOk = false, replicaOk = false;
    try {
      primary = await this.disk.read(meta.offset, meta.size);
      if (primary && this.calculateChecksum(primary) === meta.checksum) primaryOk = true;
    } catch (error: any) {
      Logger.warning(`[YOIFS] Failed to read primary copy: ${error.message}`);
    }
    try {
      replica = await this.disk.read(meta.replicaOffset, meta.size);
      if (replica && this.calculateChecksum(replica) === meta.checksum) replicaOk = true;
    } catch (error: any) {
      Logger.warning(`[YOIFS] Failed to read replica copy: ${error.message}`);
    }
    if (primaryOk && replicaOk && primary) {
      return { success: true, data: primary };
    }
    if (primaryOk && primary) {
      await this.disk.write(meta.replicaOffset, primary);
      return { success: true, data: primary };
    }
    if (replicaOk && replica) {
      await this.disk.write(meta.offset, replica);
      return { success: true, data: replica };
    }
    return { success: false, error: 'Corruption detected' };
  }

  async listFiles(): Promise<FileSystemResult<string[]>> {
    await this.loadFAT();
    if (this.fatCorrupted) {
      Logger.error('[YOIFS] Cannot list files: FAT is corrupted!');
      return { success: false, error: 'FAT corrupted' };
    }
    return { success: true, data: this.fileMetaList.map(f => f.name) };
  }
}