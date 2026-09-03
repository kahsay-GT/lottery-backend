import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request } from 'express';
import { AUDIT_ACTION_KEY } from '../decorators/audit.decorator';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const auditMeta = this.reflector.get<{
      action: string;
      entityType: string;
    }>(AUDIT_ACTION_KEY, context.getHandler());

    if (!auditMeta) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<Request>();
    const user = request['user'] as { id: string; role: string } | undefined;

    return next.handle().pipe(
      tap({
        next: (_result) => {
          // Audit logging handled by dedicated AuditService in business logic
          // This interceptor just marks the request for audit
          (request as unknown as Record<string, unknown>)['auditMeta'] = {
            ...auditMeta,
            userId: user?.id,
            userRole: user?.role,
            ipAddress: request.ip,
            userAgent: request.get('user-agent'),
          };
        },
      }),
    );
  }
}
