import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { FILE_LIMITS } from '../../common/constants';

@Injectable()
export class FileService {
  private readonly logger = new Logger(FileService.name);
  private readonly uploadDir: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    // Store uploads in <project_root>/uploads relative to cwd
    this.uploadDir = path.join(process.cwd(), 'uploads');
    this.ensureUploadDir();
  }

  // ─── helpers ────────────────────────────────────────────────────

  private ensureUploadDir(): void {
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
      this.logger.log(`Upload directory created: ${this.uploadDir}`);
    }
  }

  private ensureFolder(folder: string): string {
    const dir = path.join(this.uploadDir, folder);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  // ─── public API ─────────────────────────────────────────────────

  async uploadFile(
    file: Express.Multer.File,
    folder = 'uploads',
    uploadedById?: string,
    uploadedByType?: string,
  ) {
    if (!file) throw new BadRequestException('No file provided');

    // Validate for payment slips
    if (folder.includes('slip') || folder.includes('payment')) {
      if (!(FILE_LIMITS.ALLOWED_SLIP_TYPES as readonly string[]).includes(file.mimetype)) {
        throw new BadRequestException(
          `Invalid file type. Allowed: ${FILE_LIMITS.ALLOWED_SLIP_TYPES.join(', ')}`,
        );
      }
      if (file.size > FILE_LIMITS.PAYMENT_SLIP_MAX_SIZE) {
        throw new BadRequestException('File size exceeds 5MB limit');
      }
    }

    const ext = path.extname(file.originalname) || '';
    const fileName = `${uuidv4()}${ext}`;
    const folderPath = this.ensureFolder(folder);
    const filePath = path.join(folderPath, fileName);
    const storedName = `${folder}/${fileName}`;

    // Compute SHA-256 of the raw buffer for duplicate slip detection
    const contentHash = crypto.createHash('sha256').update(file.buffer).digest('hex');

    // Write to disk
    fs.writeFileSync(filePath, file.buffer);

    const saved = await this.prisma.file.create({
      data: {
        originalName: file.originalname,
        storedName,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        bucket: 'local',
        path: filePath,
        url: `/api/v1/files/${storedName}`,
        contentHash,
        uploadedById,
        uploadedByType,
        isScanned: false,
        isSafe: true,
      },
    });

    this.logger.log(`File saved locally: ${storedName}`);
    return saved;
  }

  /**
   * Read file buffer from disk by DB id — used for serving downloads
   */
  async getFileBuffer(fileId: string): Promise<{ buffer: Buffer; file: { id: string; mimeType: string; originalName: string; path: string; storedName: string } | null }> {
    const file = await this.prisma.file.findUnique({ where: { id: fileId } });
    if (!file) throw new NotFoundException('File not found');

    if (!fs.existsSync(file.path)) {
      throw new NotFoundException('File has been removed from disk');
    }

    const buffer = fs.readFileSync(file.path);
    return { buffer, file };
  }

  /**
   * Read file buffer from disk by storedName path — used for serving /files/:folder/:name
   */
  async getFileByPath(storedPath: string): Promise<{ buffer: Buffer; file: { id: string; mimeType: string; originalName: string; path: string; storedName: string } | null }> {
    const file = await this.prisma.file.findFirst({ where: { storedName: storedPath } });
    if (!file) throw new NotFoundException('File not found');

    if (!fs.existsSync(file.path)) {
      throw new NotFoundException('File has been removed from disk');
    }

    const buffer = fs.readFileSync(file.path);
    return { buffer, file };
  }

  /**
   * Return the SHA-256 contentHash for a file — used for duplicate slip detection.
   */
  async getContentHash(fileId: string): Promise<string | null> {
    const file = await this.prisma.file.findUnique({
      where: { id: fileId },
      select: { contentHash: true },
    });
    return file?.contentHash ?? null;
  }

  async getPresignedUrl(fileId: string): Promise<string> {
    const file = await this.prisma.file.findUnique({ where: { id: fileId } });
    if (!file) throw new BadRequestException('File not found');
    // For local storage just return the direct download URL
    return `/api/v1/files/download/${fileId}`;
  }

  async deleteFile(fileId: string): Promise<void> {
    const file = await this.prisma.file.findUnique({ where: { id: fileId } });
    if (!file) return;

    if (fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
    await this.prisma.file.delete({ where: { id: fileId } });
    this.logger.log(`File deleted: ${file.storedName}`);
  }
}
