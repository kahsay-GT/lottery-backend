import { SetMetadata } from '@nestjs/common';

export const AUDIT_ACTION_KEY = 'audit_action';

export interface AuditMeta {
  action: string;
  entityType: string;
}

export const Audit = (action: string, entityType: string) =>
  SetMetadata(AUDIT_ACTION_KEY, { action, entityType });
