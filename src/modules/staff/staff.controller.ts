import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus,
  Param, Patch, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { StaffService } from './staff.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ROLES } from '../../common/constants';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { CreateStaffDto, StaffLoginDto, UpdateStaffDto } from './dto/staff.dto';

@ApiTags('Staff')
@Controller('staff')
export class StaffController {
  constructor(private readonly staffService: StaffService) {}

  // ── Public: staff login ────────────────────────────────────────────────
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Staff login' })
  login(@Body() dto: StaffLoginDto, @Req() req: Request) {
    return this.staffService.staffLogin(dto, req.ip);
  }

  // ── Operator manages staff ─────────────────────────────────────────────
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.CLIENT)
  @Get()
  @ApiOperation({ summary: 'List all staff for my operator account' })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: PaginationDto) {
    return this.staffService.listStaff(user.id, query);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.CLIENT)
  @Post()
  @ApiOperation({ summary: 'Add a new staff member' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateStaffDto) {
    return this.staffService.createStaff(user.id, dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.CLIENT)
  @Patch(':id')
  @ApiOperation({ summary: 'Update staff member name / role / password' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateStaffDto,
  ) {
    return this.staffService.updateStaff(user.id, id, dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.CLIENT)
  @Patch(':id/toggle-active')
  @ApiOperation({ summary: 'Activate / deactivate a staff member' })
  toggleActive(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.staffService.toggleActive(user.id, id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.CLIENT)
  @Delete(':id')
  @ApiOperation({ summary: 'Remove a staff member' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.staffService.deleteStaff(user.id, id);
  }

  // ── Activity log — accessible to operator AND staff ────────────────────
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.CLIENT, ROLES.STAFF)
  @Get('activity')
  @ApiOperation({ summary: 'Staff payment activity log for my operator' })
  activity(@CurrentUser() user: AuthenticatedUser, @Query() query: PaginationDto) {
    const clientId = user.role === ROLES.STAFF ? user.clientId! : user.id;
    return this.staffService.getStaffActivity(clientId, query);
  }
}
