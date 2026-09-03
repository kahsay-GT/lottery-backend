import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { FileService } from '../files/file.service';
import { UpdateClientProfileDto } from './dto/update-client.dto';
import { buildPaginatedResult, getPrismaSkipTake } from '../../common/interfaces/pagination.interface';

@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fileService: FileService,
  ) {}

  async listPublicOperators(query: { page?: number; limit?: number; search?: string }) {
    const page  = Math.max(1, query.page  ?? 1);
    const limit = Math.min(50, Math.max(1, query.limit ?? 20));
    const { skip, take } = getPrismaSkipTake(page, limit);

    const where: Record<string, unknown> = {
      deletedAt: null,
      status: 'ACTIVE',
      username: { not: null },
    };

    if (query.search) {
      where.OR = [
        { businessName: { contains: query.search, mode: 'insensitive' } },
        { username:     { contains: query.search, mode: 'insensitive' } },
        { city:         { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.client.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          username: true,
          businessName: true,
          name: true,
          logo: true,
          city: true,
          website: true,
          isVerified: true,
          createdAt: true,
          _count: {
            select: {
              lotteries: {
                where: { deletedAt: null, status: { in: ['PUBLISHED', 'SELLING'] } },
              },
            },
          },
        },
      }),
      this.prisma.client.count({ where }),
    ]);

    return buildPaginatedResult(items, total, page, limit);
  }

  async getPublicProfile(username: string) {
    const client = await this.prisma.client.findUnique({
      where: { username, deletedAt: null },
      select: {
        id: true,
        username: true,
        businessName: true,
        name: true,
        logo: true,
        website: true,
        city: true,
        isVerified: true,
        verifiedAt: true,
        createdAt: true,
        _count: { select: { lotteries: { where: { deletedAt: null, status: { in: ['PUBLISHED', 'SELLING'] } } } } },
      },
    });
    if (!client) throw new NotFoundException('Operator not found');
    return client;
  }

  async getMe(clientId: string) {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId, deletedAt: null },
      select: {
        id: true,
        email: true,
        username: true,
        name: true,
        businessName: true,
        phone: true,
        website: true,
        address: true,
        city: true,
        logo: true,
        status: true,
        emailVerifiedAt: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: { lotteries: true, buyers: true },
        },
      },
    });

    if (!client) throw new NotFoundException('Client not found');
    return client;
  }

  async updateMe(clientId: string, dto: UpdateClientProfileDto) {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId, deletedAt: null },
    });
    if (!client) throw new NotFoundException('Client not found');

    // Username uniqueness check
    if (dto.username && dto.username !== client.username) {
      const taken = await this.prisma.client.findFirst({
        where: { username: dto.username, deletedAt: null, id: { not: clientId } },
        select: { id: true },
      });
      if (taken) throw new ConflictException('Username is already taken');
    }

    const updated = await this.prisma.client.update({
      where: { id: clientId },
      data: {
        ...(dto.username      !== undefined && { username:     dto.username }),
        ...(dto.name          !== undefined && { name:         dto.name }),
        ...(dto.businessName  !== undefined && { businessName: dto.businessName }),
        ...(dto.phone         !== undefined && { phone:        dto.phone }),
        ...(dto.website       !== undefined && { website:      dto.website }),
        ...(dto.address       !== undefined && { address:      dto.address }),
        ...(dto.city          !== undefined && { city:         dto.city }),
      },
      select: {
        id: true,
        email: true,
        username: true,
        name: true,
        businessName: true,
        phone: true,
        website: true,
        address: true,
        city: true,
        status: true,
        updatedAt: true,
      },
    });

    return updated;
  }

  async getBankAccounts(clientId: string) {
    return this.prisma.bankAccount.findMany({
      where: { clientId, isActive: true },
      include: { bank: true },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async addBankAccount(clientId: string, dto: {
    bankName: string;
    accountName: string;
    accountNumber: string;
    branchName?: string;
    isDefault?: boolean;
  }) {
    // Find or create the bank
    let bank = await this.prisma.bank.findFirst({
      where: { name: { contains: dto.bankName, mode: 'insensitive' } },
    });

    if (!bank) {
      bank = await this.prisma.bank.create({
        data: { name: dto.bankName },
      });
    }

    // If marking as default, unset others first
    if (dto.isDefault) {
      await this.prisma.bankAccount.updateMany({
        where: { clientId, isDefault: true },
        data: { isDefault: false },
      });
    }

    return this.prisma.bankAccount.create({
      data: {
        clientId,
        bankId: bank.id,
        accountName: dto.accountName,
        accountNumber: dto.accountNumber,
        branchName: dto.branchName,
        isDefault: dto.isDefault ?? false,
      },
      include: { bank: true },
    });
  }

  async deleteBankAccount(clientId: string, accountId: string) {
    const account = await this.prisma.bankAccount.findUnique({
      where: { id: accountId },
    });
    if (!account || account.clientId !== clientId) {
      throw new NotFoundException('Bank account not found');
    }
    await this.prisma.bankAccount.update({
      where: { id: accountId },
      data: { isActive: false },
    });
  }

  /**
   * Get the payment slip image/PDF for a payment, so the operator can visually verify it.
   */
  async uploadLogo(clientId: string, file: Express.Multer.File): Promise<{ logo: string }> {
    if (!file) throw new NotFoundException('No file provided');

    const saved = await this.fileService.uploadFile(file, 'logos', clientId, 'client');

    // Store the file path as the logo URL
    const logoPath = `/api/v1/files/download/${saved.id}`;

    await this.prisma.client.update({
      where: { id: clientId },
      data: { logo: logoPath },
    });

    return { logo: logoPath };
  }

  async getPaymentSlip(paymentId: string, clientId?: string): Promise<{ buffer: Buffer; mimeType: string; fileName: string }> {
    const where = clientId
      ? { id: paymentId, clientId }
      : { id: paymentId };

    const payment = await this.prisma.paymentTransaction.findFirst({
      where,
      include: {
        slips: {
          include: { file: true },
          orderBy: { uploadedAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!payment) throw new NotFoundException('Payment not found');

    const slip = payment.slips?.[0];
    if (!slip?.file) throw new NotFoundException('No payment slip uploaded for this payment');

    const { buffer, file } = await this.fileService.getFileBuffer(slip.file.id);
    return { buffer, mimeType: file!.mimeType, fileName: file!.originalName };
  }
}
