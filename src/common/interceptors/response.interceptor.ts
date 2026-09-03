import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Request } from 'express';

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, unknown> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const requestId = request.headers['x-request-id'] as string;

    return next.handle().pipe(
      map((data) => {
        // If data is already formatted (has 'success' field), return as-is
        if (data && typeof data === 'object' && 'success' in data) {
          return { ...data, requestId };
        }

        return {
          success: true,
          statusCode: context.switchToHttp().getResponse().statusCode || 200,
          message: 'Success',
          data,
          requestId,
          timestamp: new Date().toISOString(),
        };
      }),
    );
  }
}
