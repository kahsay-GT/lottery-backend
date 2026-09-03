import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

// ─── Payload shapes ───────────────────────────────────────────────────────────

export interface PaymentStatusPayload {
  paymentId: string;
  referenceCode: string;
  status: string;
  amount: number;
  currency: string;
  lotteryName?: string;
  tickets?: string[];
  rejectionReason?: string;
  verificationStatus?: string;
  verificationReason?: string;
  autoApproved?: boolean;
  updatedAt: string;
}

export interface SubscriptionStatusPayload {
  transactionId: string;
  subscriptionId: string;
  status: string;
  planName?: string;
  verificationStatus?: string;
  verificationReason?: string;
  autoApproved?: boolean;
  updatedAt: string;
}

// ─── Room helpers ─────────────────────────────────────────────────────────────

/** Room all sockets for a given operator/client join */
export const clientRoom = (clientId: string) => `client:${clientId}`;

/** Room for public payment tracking by reference code (guest) */
export const refRoom = (referenceCode: string) => `ref:${referenceCode}`;

/** Room all super-admins join */
export const adminRoom = () => `admin:payments`;

// ─── Gateway ─────────────────────────────────────────────────────────────────

@WebSocketGateway({
  cors: {
    origin: (origin: string, cb: (err: Error | null, allow?: boolean) => void) => {
      if (!origin) return cb(null, true);
      const local =
        /^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)(:\d+)?$/.test(
          origin,
        );
      cb(null, local);
    },
    credentials: true,
  },
  namespace: '/ws',
  transports: ['websocket', 'polling'],
})
export class EventsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  private readonly server!: Server;

  private readonly logger = new Logger(EventsGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  afterInit() {
    this.logger.log('EventsGateway initialised — namespace /ws');
  }

  // ── Connection ──────────────────────────────────────────────────────────────

  async handleConnection(socket: Socket) {
    try {
      const token =
        (socket.handshake.auth?.token as string) ||
        (socket.handshake.headers?.authorization as string)?.replace('Bearer ', '');

      if (token) {
        const secret = this.config.get<string>('jwt.secret');
        const payload = this.jwtService.verify(token, { secret }) as {
          sub: string;
          role: string;
          clientId?: string;
        };

        socket.data.userId = payload.sub;
        socket.data.role = payload.role;
        socket.data.clientId = payload.clientId;

        // Join role-based rooms
        if (payload.role === 'SUPER_ADMIN') {
          await socket.join(adminRoom());
          this.logger.log(`Admin ${payload.sub} joined admin room`);
        } else if (payload.role === 'CLIENT' && payload.clientId) {
          await socket.join(clientRoom(payload.clientId));
          this.logger.log(`Client ${payload.clientId} joined client room`);
        }
      }
      // Unauthenticated sockets are allowed — they can join ref rooms for tracking
    } catch {
      // Invalid token — socket stays connected but unauthenticated (can still use ref rooms)
    }
  }

  handleDisconnect(socket: Socket) {
    this.logger.debug(`Socket ${socket.id} disconnected`);
  }

  // ── Client messages ─────────────────────────────────────────────────────────

  /** Guest / buyer joins a room to track a specific payment by reference code */
  @SubscribeMessage('track:join')
  async handleTrackJoin(
    @MessageBody() data: { referenceCode: string },
    @ConnectedSocket() socket: Socket,
  ) {
    if (!data?.referenceCode) return;
    const room = refRoom(data.referenceCode);
    await socket.join(room);
    this.logger.debug(`Socket ${socket.id} joined tracking room ${room}`);
    return { joined: room };
  }

  /** Leave a tracking room */
  @SubscribeMessage('track:leave')
  async handleTrackLeave(
    @MessageBody() data: { referenceCode: string },
    @ConnectedSocket() socket: Socket,
  ) {
    if (!data?.referenceCode) return;
    const room = refRoom(data.referenceCode);
    await socket.leave(room);
    return { left: room };
  }

  // ── Emission helpers (called from PaymentService) ───────────────────────────

  /**
   * Emit payment status change to:
   *   - the ref room (guest tracking)
   *   - the clientId room (operator dashboard)
   *   - the admin room
   */
  emitPaymentUpdate(clientId: string, payload: PaymentStatusPayload) {
    const event = 'payment:updated';
    this.server.to(refRoom(payload.referenceCode)).emit(event, payload);
    this.server.to(clientRoom(clientId)).emit(event, payload);
    this.server.to(adminRoom()).emit(event, payload);
    this.logger.log(
      `Emitted payment:updated ref=${payload.referenceCode} status=${payload.status}`,
    );
  }

  /**
   * Emit subscription status change to:
   *   - the clientId room (operator)
   *   - the admin room
   */
  emitSubscriptionUpdate(clientId: string, payload: SubscriptionStatusPayload) {
    const event = 'subscription:updated';
    this.server.to(clientRoom(clientId)).emit(event, payload);
    this.server.to(adminRoom()).emit(event, payload);
    this.logger.log(
      `Emitted subscription:updated txn=${payload.transactionId} status=${payload.status}`,
    );
  }

  /** Emit a generic notification to a client room */
  emitNotification(
    clientId: string,
    notification: { title: string; message: string; type: 'success' | 'error' | 'info' | 'warning' },
  ) {
    this.server.to(clientRoom(clientId)).emit('notification', notification);
  }

  /** Emit to admin room only */
  emitToAdmins(event: string, data: unknown) {
    this.server.to(adminRoom()).emit(event, data);
  }

  /** Total connected sockets (useful for health endpoint) */
  get connectedCount(): number {
    return this.server?.sockets?.sockets?.size ?? 0;
  }
}
