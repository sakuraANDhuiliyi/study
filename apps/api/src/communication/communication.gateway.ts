import {
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
} from '@nestjs/websockets';
import type { Namespace } from 'socket.io';
import { AuthService } from '../auth/auth.service';
import { CommunicationSessions } from './socket-sessions';

/** Sockets carry invalidations only; content is fetched through authorized REST endpoints. */
@WebSocketGateway({ namespace: '/notifications', transports: ['websocket'], maxHttpBufferSize: 8192 })
export class CommunicationGateway
  extends CommunicationSessions
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() declare server: Namespace;
  constructor(auth: AuthService) {
    super(auth);
  }
}
