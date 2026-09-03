import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards,
  UploadedFile, UseInterceptors, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { LotteryService } from './lottery.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ROLES } from '../../common/constants';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { CreateLotteryDto, CreatePrizeDto, ReorderImagesDto, UpdateLotteryDto } from './dto/lottery.dto';

@ApiTags('Lotteries')
@Controller('lotteries')
export class LotteryController {
  constructor(private readonly lotteryService: LotteryService) {}

  // ==================== PUBLIC ====================

  @Public()
  @Get('public')
  @ApiOperation({ summary: 'Browse public lotteries' })
  listPublic(@Query() query: PaginationDto) {
    return this.lotteryService.listPublicLotteries(query);
  }

  @Public()
  @Get('public/:slug')
  @ApiOperation({ summary: 'Get public lottery by slug' })
  getPublic(@Param('slug') slug: string) {
    return this.lotteryService.getPublicLottery(slug);
  }

  @Public()
  @Get('public/by/:username')
  @ApiOperation({ summary: 'List public lotteries for an operator by username' })
  listByUsername(@Param('username') username: string, @Query() query: PaginationDto) {
    return this.lotteryService.listPublicLotteriesByUsername(username, query);
  }

  @Public()
  @Get('public/by/:username/closed')
  @ApiOperation({ summary: 'List closed/completed lotteries for an operator by username' })
  listClosedByUsername(@Param('username') username: string, @Query() query: PaginationDto) {
    return this.lotteryService.listClosedLotteriesByUsername(username, query);
  }

  @Public()
  @Get('public/by/:username/winners')
  @ApiOperation({ summary: 'List all winners for an operator by username' })
  listWinnersByUsername(@Param('username') username: string, @Query() query: PaginationDto) {
    return this.lotteryService.listWinnersByUsername(username, query);
  }

  @Public()
  @Get('public/by/:username/:slug')
  @ApiOperation({ summary: 'Get a public lottery by operator username and slug' })
  getByUsername(@Param('username') username: string, @Param('slug') slug: string) {
    return this.lotteryService.getPublicLotteryByUsername(username, slug);
  }

  // ==================== CLIENT ====================

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.CLIENT)
  @Post()
  @ApiOperation({ summary: 'Create a lottery' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateLotteryDto) {
    return this.lotteryService.createLottery(user.id, dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.CLIENT)
  @Get()
  @ApiOperation({ summary: 'List my lotteries' })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: PaginationDto) {
    return this.lotteryService.listClientLotteries(user.id, query);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.CLIENT)
  @Get(':id')
  @ApiOperation({ summary: 'Get a lottery' })
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.lotteryService.getLottery(id, user.id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.CLIENT)
  @Get(':id/stats')
  @ApiOperation({ summary: 'Get lottery statistics' })
  getStats(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.lotteryService.getLotteryStats(id, user.id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.CLIENT)
  @Patch(':id')
  @ApiOperation({ summary: 'Update a draft lottery' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateLotteryDto,
  ) {
    return this.lotteryService.updateLottery(id, user.id, dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.CLIENT)
  @Patch(':id/publish')
  @ApiOperation({ summary: 'Publish a lottery' })
  publish(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.lotteryService.publishLottery(id, user.id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.CLIENT)
  @Patch(':id/close')
  @ApiOperation({ summary: 'Close ticket sales' })
  close(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.lotteryService.closeLottery(id, user.id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.CLIENT)
  @Patch(':id/archive')
  @ApiOperation({ summary: 'Archive a completed lottery' })
  archive(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.lotteryService.archiveLottery(id, user.id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.CLIENT)
  @Delete(':id')
  @ApiOperation({ summary: 'Delete a draft lottery' })
  delete(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.lotteryService.deleteLottery(id, user.id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.CLIENT)
  @Post(':id/banner')
  @ApiOperation({ summary: 'Upload or replace lottery banner image' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  uploadBanner(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.lotteryService.uploadBanner(id, user.id, file);
  }

  // ==================== IMAGES ====================

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.CLIENT)
  @Post(':id/images')
  @ApiOperation({ summary: 'Upload an image for a lottery (max 10)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  uploadImage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.lotteryService.addImage(id, user.id, file);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.CLIENT)
  @Delete(':id/images/:imageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a lottery image' })
  deleteImage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('imageId') imageId: string,
  ) {
    return this.lotteryService.deleteImage(id, imageId, user.id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.CLIENT)
  @Patch(':id/images/reorder')
  @ApiOperation({ summary: 'Reorder lottery images' })
  reorderImages(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ReorderImagesDto,
  ) {
    return this.lotteryService.reorderImages(id, user.id, dto.orderedIds);
  }

  // ==================== PRIZES ====================

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.CLIENT)
  @Post(':id/prizes')
  @ApiOperation({ summary: 'Add a prize to a lottery' })
  addPrize(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreatePrizeDto,
  ) {
    return this.lotteryService.addPrize(id, user.id, dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.CLIENT)
  @Patch(':id/prizes/:prizeId')
  @ApiOperation({ summary: 'Update a prize' })
  updatePrize(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('prizeId') prizeId: string,
    @Body() dto: Partial<CreatePrizeDto>,
  ) {
    return this.lotteryService.updatePrize(id, prizeId, user.id, dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.CLIENT)
  @Delete(':id/prizes/:prizeId')
  @ApiOperation({ summary: 'Remove a prize' })
  deletePrize(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('prizeId') prizeId: string,
  ) {
    return this.lotteryService.deletePrize(id, prizeId, user.id);
  }
}
