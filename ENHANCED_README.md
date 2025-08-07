# Enhanced YOIFS (Your Own Indestructible File System)

## Overview

This is an enhanced version of YOIFS that implements advanced fault tolerance, compression, deduplication, and space management features. The enhanced file system builds upon the original implementation with significant improvements in reliability, efficiency, and functionality.

## Key Enhancements

### 1. **Chunking for Error Isolation**
- Files are split into 4KB chunks instead of being stored as monolithic units
- Single bit errors only affect individual chunks, not entire files
- Partial file recovery is possible even when some chunks are corrupted
- Better parallel processing capabilities

### 2. **Metadata Resilience**
- Distributed metadata storage across multiple sections
- Automatic recovery from corrupted metadata using backup sections
- Version-based metadata management with checksums
- Graceful degradation when metadata corruption occurs

### 3. **Compression and Deduplication**
- Automatic gzip compression for chunks larger than 100 bytes
- Content-addressable storage using SHA-256 hashes
- Deduplication of identical chunks across multiple files
- Reference counting for shared chunks

### 4. **Space Reclamation**
- Automatic space reclamation when files are deleted
- Free space management with adjacent space merging
- Reference counting prevents premature chunk deletion
- Efficient space allocation using first-fit algorithm

### 5. **Advanced Operations**
- File append functionality
- File metadata retrieval
- Disk usage statistics
- Compression ratio reporting

## Architecture

### Data Structures

```typescript
interface FileMeta {
  name: string;
  size: number;
  checksum: string;
  chunkRefs: string[];        // References to chunks
  createdAt: number;
  modifiedAt: number;
}

interface FileChunk {
  hash: string;               // Content hash for deduplication
  compressedData: Buffer;     // Compressed chunk data
  originalSize: number;       // Original uncompressed size
  references: number;         // Reference count for deduplication
  offset: number;             // Primary storage location
  replicaOffset: number;      // Backup storage location
  checksum: string;           // Data integrity checksum
}

interface MetadataSection {
  version: number;            // Version for recovery
  files: FileMeta[];          // File metadata
  chunks: Map<string, FileChunk>; // Chunk storage
  freeSpace: FreeSpaceEntry[]; // Available space tracking
  checksum: string;           // Metadata integrity
}
```

### Storage Layout

```
Disk Layout:
[Metadata Section 1] [Metadata Section 2] [Metadata Section 3] [File Chunks...]
    64KB                64KB                  64KB              Variable
```

## Features

### Error Isolation
- **Chunk-level corruption**: Only affected chunks are lost
- **Metadata recovery**: Automatic recovery from backup sections
- **Dual-copy storage**: Primary and replica for each chunk
- **Checksum validation**: SHA-256 for data integrity

### Space Efficiency
- **Compression**: Automatic gzip compression for large chunks
- **Deduplication**: Identical chunks shared across files
- **Space reclamation**: Automatic cleanup of unused chunks
- **Reference counting**: Prevents premature deletion of shared chunks

### Performance
- **Parallel operations**: Chunks can be processed in parallel
- **Efficient allocation**: First-fit algorithm for space allocation
- **Caching**: Metadata loaded once and cached
- **Block alignment**: All operations align to 512-byte blocks

## Usage

### Basic Operations

```typescript
import { EnhancedFileSystem } from './enhanced-solution';
import { MemoryDisk } from './index';

// Create file system
const disk = new MemoryDisk(2 * 1024 * 1024); // 2MB disk
const fs = new EnhancedFileSystem(disk);

// Write file
await fs.writeFile('test.txt', Buffer.from('Hello, World!'));

// Read file
const result = await fs.readFile('test.txt');
if (result.success) {
  console.log(result.data.toString());
}

// List files
const files = await fs.listFiles();
console.log(files.data); // ['test.txt']

// Delete file
await fs.deleteFile('test.txt');

// Append to file
await fs.appendFile('test.txt', Buffer.from(' - appended'));
```

### Advanced Operations

```typescript
// Get file information
const info = await fs.getFileInfo('test.txt');
console.log(`File size: ${info.data!.size} bytes`);
console.log(`Chunks: ${info.data!.chunkRefs.length}`);

// Get disk usage
const usage = await fs.getDiskUsage();
console.log(`Used: ${usage.data!.used} bytes`);
console.log(`Free: ${usage.data!.free} bytes`);

// Get compression statistics
const stats = await fs.getCompressionStats();
console.log(`Compression ratio: ${stats.data!.ratio.toFixed(1)}%`);
```

## Testing

Run the enhanced test suite:

```bash
npm run enhanced
```

The test suite covers:

1. **Basic Operations**: Write, read, list, delete
2. **Chunking & Compression**: Large file handling and compression
3. **Deduplication**: Space savings with identical content
4. **Space Reclamation**: Automatic cleanup after deletion
5. **Metadata Resilience**: Recovery from corruption

## Performance Characteristics

### Space Efficiency
- **Compression**: Typically 20-80% space savings depending on content
- **Deduplication**: 100% space savings for identical content
- **Metadata overhead**: ~64KB for metadata storage
- **Chunk overhead**: ~4KB per chunk (configurable)

### Reliability
- **Single bit errors**: Isolated to individual 4KB chunks
- **Metadata corruption**: Automatic recovery from backups
- **Dual-copy storage**: 2x redundancy for all data
- **Checksum validation**: SHA-256 for integrity verification

### Scalability
- **File count**: Limited by metadata section size
- **File size**: Limited by disk space
- **Chunk size**: Configurable (default 4KB)
- **Metadata sections**: Configurable (default 3)

## Configuration

Key configuration parameters in `EnhancedFileSystem`:

```typescript
private chunkSize = 4096;              // Chunk size in bytes
private metadataSize = 65536;          // Metadata storage size
private metadataSections = 3;          // Number of metadata backups
private compressionThreshold = 100;    // Minimum size for compression
```

## Comparison with Original YOIFS

| Feature | Original YOIFS | Enhanced YOIFS |
|---------|----------------|----------------|
| Error isolation | File-level | Chunk-level |
| Metadata resilience | Single FAT | Distributed with backups |
| Compression | None | Automatic gzip |
| Deduplication | None | Content-addressable |
| Space reclamation | None | Automatic |
| Append operations | None | Supported |
| Performance | Basic | Optimized |

## Future Enhancements

Potential areas for further improvement:

1. **Advanced Error Correction**: Reed-Solomon codes for multiple chunk recovery
2. **Journaling**: Append-only log for better crash recovery
3. **Concurrency**: Multi-threaded operations
4. **Encryption**: Optional data encryption
5. **Snapshots**: Point-in-time file system snapshots
6. **Compression algorithms**: Multiple compression options
7. **Chunk size optimization**: Dynamic chunk sizing based on content

## License

ISC License - see package.json for details.
