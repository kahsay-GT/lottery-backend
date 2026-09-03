import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsArray, IsNotEmpty, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { DrawService } from './draw.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ROLES } from '../../common/constants';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';

class ManualWinnerDto {
  @IsString() @IsNotEmpty() prizeId!: string;
  @IsString() @IsNotEmpty() ticketNumber!: string;
  @IsString() @IsNotEmpty() winnerName!: string;
}

class ManualDrawDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => ManualWinnerDto)
  winners!: ManualWinnerDto[];
}

@ApiTags('Winner Draw')
@Controller('draws')
export class DrawController {
  constructor(private readonly drawService: DrawService) {}

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.CLIENT)
  @Post('lottery/:lotteryId/execute')
  @ApiOperation({ summary: 'Execute winner draw for a lottery (client)' })
  executeDraw(
    @CurrentUser() user: AuthenticatedUser,
    @Param('lotteryId') lotteryId: string,
  ) {
    return this.drawService.executeDraw(lotteryId, user.id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.CLIENT)
  @Patch('lottery/:lotteryId/publish')
  @ApiOperation({ summary: 'Publish draw results (client)' })
  publishResults(
    @CurrentUser() user: AuthenticatedUser,
    @Param('lotteryId') lotteryId: string,
  ) {
    return this.drawService.publishResults(lotteryId, user.id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.CLIENT)
  @Get('lottery/:lotteryId/results')
  @ApiOperation({ summary: 'Get draw results (client - full)' })
  getResults(
    @CurrentUser() user: AuthenticatedUser,
    @Param('lotteryId') lotteryId: string,
  ) {
    return this.drawService.getDrawResults(lotteryId, user.id);
  }

  @Public()
  @Get('lottery/:lotteryId/public-results')
  @ApiOperation({ summary: 'Get published draw results (public - masked)' })
  getPublicResults(@Param('lotteryId') lotteryId: string) {
    return this.drawService.getDrawResults(lotteryId);
  }

  @Public()
  @Get('lottery/:lotteryId/verify')
  @ApiOperation({ summary: 'Verify draw integrity by recomputing hash' })
  verifyDraw(@Param('lotteryId') lotteryId: string) {
    return this.drawService.verifyDraw(lotteryId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.CLIENT)
  @Post('lottery/:lotteryId/manual')
  @ApiOperation({ summary: 'Manually enter winners (operator physical draw)' })
  @ApiBody({ type: ManualDrawDto })
  manualDraw(
    @CurrentUser() user: AuthenticatedUser,
    @Param('lotteryId') lotteryId: string,
    @Body() dto: ManualDrawDto,
  ) {
    return this.drawService.manualDraw(lotteryId, user.id, dto.winners);
  }
}
