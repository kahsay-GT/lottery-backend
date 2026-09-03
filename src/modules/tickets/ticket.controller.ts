import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TicketService } from './ticket.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ROLES } from '../../common/constants';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { ReserveTicketsDto } from './dto/ticket.dto';

@ApiTags('Tickets')
@Controller('tickets')
export class TicketController {
  constructor(private readonly ticketService: TicketService) {}

  @Public()
  @Post('reserve')
  @ApiOperation({ summary: 'Reserve tickets (public/guest)' })
  reserve(@Body() dto: ReserveTicketsDto) {
    return this.ticketService.reserveTickets(dto);
  }

  @Public()
  @Patch('reservations/:id/cancel')
  @ApiOperation({ summary: 'Cancel a reservation' })
  cancelReservation(@Param('id') id: string) {
    return this.ticketService.cancelReservation(id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.BUYER)
  @Get('my-tickets')
  @ApiOperation({ summary: 'Get my purchased tickets' })
  myTickets(@CurrentUser() user: AuthenticatedUser, @Query() query: PaginationDto) {
    return this.ticketService.getBuyerTickets(user.id, query);
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Get a ticket by ID' })
  getTicket(@Param('id') id: string) {
    return this.ticketService.getTicket(id);
  }

  // Client: view their lottery's tickets
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.CLIENT)
  @Get('lottery/:lotteryId')
  @ApiOperation({ summary: 'List tickets for a lottery (client)' })
  getLotteryTickets(
    @CurrentUser() user: AuthenticatedUser,
    @Param('lotteryId') lotteryId: string,
    @Query() query: PaginationDto & { status?: string },
  ) {
    return this.ticketService.getLotteryTickets(lotteryId, user.id, query);
  }
}
