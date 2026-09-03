import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AuthenticatedUser } from '../interfaces/jwt-payload.interface';
import { ROLES } from '../constants';

/**
 * Enforces tenant isolation: a Client can only access their own resources.
 * Expects that route params contain `clientId` or the resource has a clientId
 * that matches the authenticated client's id.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser;

    // Super admins bypass tenant isolation
    if (user?.role === ROLES.SUPER_ADMIN) {
      return true;
    }

    // Clients can only access their own tenant
    if (user?.role === ROLES.CLIENT) {
      const clientIdParam =
        request.params?.clientId ||
        request.query?.clientId ||
        request.body?.clientId;

      if (clientIdParam && clientIdParam !== user.clientId) {
        throw new ForbiddenException('Access to this tenant is denied');
      }

      // Inject clientId into request for use in services
      request['tenantId'] = user.clientId;
      return true;
    }

    return true;
  }
}
