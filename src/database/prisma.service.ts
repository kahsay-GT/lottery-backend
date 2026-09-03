import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'stdout', level: 'error' },
        { emit: 'stdout', level: 'warn' },
      ],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Database connected');

    // Log slow queries in development
    if (process.env.NODE_ENV === 'development') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.$on as any)('query', (e: { query: string; duration: number }) => {
        if (e.duration > 500) {
          this.logger.warn(`Slow query (${e.duration}ms): ${e.query}`);
        }
      });
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Database disconnected');
  }

  async enableShutdownHooks(): Promise<void> {
    process.on('beforeExit', async () => {
      await this.$disconnect();
    });
  }

  /**
   * Soft delete helper - sets deletedAt timestamp
   */
  async softDelete(model: string, id: string): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (this as any)[model].update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
