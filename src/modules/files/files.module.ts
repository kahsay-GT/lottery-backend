import { Module } from '@nestjs/common';
import { FileService } from './file.service';
import { FilesController } from './files.controller';

@Module({
  controllers: [FilesController],
  providers: [FileService],
  exports: [FileService],
})
export class FilesModule {}
