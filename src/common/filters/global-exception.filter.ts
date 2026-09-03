import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { errorResponse } from '../interfaces/api-response.interface';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let errors: Array<{ field?: string; message: string; code?: string }> = [];

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object') {
        const resp = exceptionResponse as Record<string, unknown>;
        message = (resp['message'] as string) || exception.message;

        if (Array.isArray(resp['message'])) {
          message = 'Validation failed';
          errors = (resp['message'] as string[]).map((msg) => ({ message: msg }));
        }
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      status = HttpStatus.BAD_REQUEST;
      switch (exception.code) {
        case 'P2002':
          message = 'A record with this value already exists';
          errors = [{ message: `Duplicate entry on field: ${exception.meta?.['target']}` }];
          break;
        case 'P2025':
          status = HttpStatus.NOT_FOUND;
          message = 'Record not found';
          break;
        case 'P2003':
          message = 'Foreign key constraint violation';
          break;
        default:
          message = 'Database operation failed';
      }
    } else if (exception instanceof Prisma.PrismaClientValidationError) {
      status = HttpStatus.BAD_REQUEST;
      message = 'Invalid data provided';
    } else if (exception instanceof Error) {
      message = exception.message || 'An unexpected error occurred';
      this.logger.error(`Unhandled exception: ${exception.message}`, exception.stack);
    }

    const requestId = request.headers['x-request-id'] as string;

    this.logger.error(
      `[${requestId}] ${request.method} ${request.url} - ${status}: ${message}`,
    );

    response.status(status).json({
      ...errorResponse(message, status, errors.length > 0 ? errors : undefined),
      requestId,
      path: request.url,
    });
  }
}
