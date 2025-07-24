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

export class FileSystem {
  private disk: Disk;

  constructor(disk: Disk) {
    this.disk = disk;
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
      // TODO: Implement file writing
      // Hints:
      // - You might want to store a file allocation table (FAT) or similar metadata
      // - Consider how you'll handle multiple files and avoid collisions
      // - Think about how to store variable-length file names and content

      return { success: false, error: 'Not implemented' };
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
      // TODO: Implement file reading
      // Hints:
      // - First check if the file exists in your metadata
      // - Read the content from the appropriate disk location
      // - Return the file data as a Buffer

      return { success: false, error: 'Not implemented' };
    } catch (error) {
      return { success: false, error: `Read error: ${error}` };
    }
  }

  /**
   * List all files in the file system
   * 
   * TODO: Return a list of all stored file names
   */
  async listFiles(): Promise<FileSystemResult<string[]>> {
    try {
      // TODO: Implement file listing
      // Hint: Extract file names from your metadata structure

      return { success: false, error: 'Not implemented' };
    } catch (error) {
      return { success: false, error: `List error: ${error}` };
    }
  }

  /**
   * Optional: Health check for the entire file system
   * This could help identify which files are corrupted
   */
  async checkSystemHealth(): Promise<FileSystemResult<{ healthy: number, corrupted: number; }>> {
    // TODO: Optional - implement system-wide health check
    // Check all files for corruption and return statistics

    return { success: false, error: 'Health check not implemented' };
  }

  // helper function to calculate checksum, feel free to use this or implement your own
  private calculateChecksum(data: Buffer): string {
    return crypto.createHash('crc32').update(data).digest('hex');
  }

}