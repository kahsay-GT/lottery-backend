export interface ApiResponse<T = unknown> {
  success: boolean;
  statusCode: number;
  message: string;
  data?: T;
  errors?: ApiError[];
  meta?: Record<string, unknown>;
  requestId?: string;
  timestamp: string;
}

export interface ApiError {
  field?: string;
  message: string;
  code?: string;
}

export function successResponse<T>(
  data: T,
  message = 'Success',
  statusCode = 200,
  meta?: Record<string, unknown>,
): ApiResponse<T> {
  return {
    success: true,
    statusCode,
    message,
    data,
    meta,
    timestamp: new Date().toISOString(),
  };
}

export function errorResponse(
  message: string,
  statusCode = 400,
  errors?: ApiError[],
): ApiResponse {
  return {
    success: false,
    statusCode,
    message,
    errors,
    timestamp: new Date().toISOString(),
  };
}
