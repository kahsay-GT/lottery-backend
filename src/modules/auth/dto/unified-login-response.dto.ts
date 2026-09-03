interface BaseUserDto {
  id: string;
  email: string | null;
  name: string;
  role: 'client' | 'buyer' | 'staff';
  status: string;
}

interface ClientUserDto extends BaseUserDto {
  role: 'client';
  businessName: string;
}

interface BuyerUserDto extends BaseUserDto {
  role: 'buyer';
  clientId: string;
}

interface StaffUserDto extends BaseUserDto {
  role: 'staff';
  clientId: string;
}

export interface UnifiedLoginResponse {
  accessToken: string;
  refreshToken: string;
  user: ClientUserDto | BuyerUserDto | StaffUserDto;
}
