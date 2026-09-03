export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  clientId?: string;
  staffId?: string;
  staffRole?: string; // APPROVER | VIEWER
  iat?: number;
  exp?: number;
}

export interface RefreshTokenPayload {
  sub: string;
  tokenId: string;
  role: string;
}

export type AuthenticatedUser = {
  id: string;
  email: string;
  role: string;
  clientId?: string;
  staffId?: string;
  staffRole?: string;
};
