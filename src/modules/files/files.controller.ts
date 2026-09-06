import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { FileService } from './file.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ROLES } from '../../common/constants';

// Folders that contain sensitive files and require authentication
const PRIVATE_FOLDERS = ['payment-slips', 'subscription-slips'];

@ApiTags('Files')
@Controller('files')
export class FilesController {
  constructor(private readonly fileService: FileService) {}

  /**
   * Download a file by its DB id.
   * Public for logos/banners; protected for payment slips.
   */
  @Public()
  @Get('download/:id')
  @ApiOperation({ summary: 'Download a stored file by id' })
  async downloadById(@Param('id') id: string, @Res() res: Response) {
    const { buffer, file } = await this.fileService.getFileBuffer(id);

    // Block unauthenticated access to sensitive folders
    const folder = file?.storedName?.split('/')?.[0] ?? ''
    if (PRIVATE_FOLDERS.includes(folder)) {
      throw new ForbiddenException('Authentication required to access this file')
    }

    res.set({
      'Content-Type': file!.mimeType,
      'Content-Disposition': `inline; filename="${file!.originalName}"`,
      'Content-Length': buffer.length,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    });
    res.send(buffer);
  }

  /**
   * Download a slip file — requires authentication (payment slips are private).
   */
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.SUPER_ADMIN, ROLES.CLIENT)
  @Get('slip/:id')
  @ApiOperation({ summary: 'Download a payment slip by file id (auth required)' })
  async downloadSlip(@Param('id') id: string, @Res() res: Response) {
    const { buffer, file } = await this.fileService.getFileBuffer(id);
    res.set({
      'Content-Type': file!.mimeType,
      'Content-Disposition': `inline; filename="${file!.originalName}"`,
      'Content-Length': buffer.length,
      'Cache-Control': 'private, max-age=3600',
    });
    res.send(buffer);
  }

  /**
   * Serve a file by its stored path — public for images, protected for slips.
   */
  @Public()
  @Get(':folder/:filename')
  @ApiOperation({ summary: 'Serve file by stored path' })
  async serveFile(
    @Param('folder') folder: string,
    @Param('filename') filename: string,
    @Res() res: Response,
  ) {
    if (PRIVATE_FOLDERS.includes(folder)) {
      throw new ForbiddenException('Authentication required to access this file')
    }

    const storedPath = `${folder}/${filename}`;
    const { buffer, file } = await this.fileService.getFileByPath(storedPath);

    res.set({
      'Content-Type': file!.mimeType,
      'Content-Disposition': `inline; filename="${file!.originalName}"`,
      'Content-Length': buffer.length,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    });
    res.send(buffer);
  }
}
