import {SessionMode, PlayerCommand} from "../handlers/session-handler";

export interface SpotifyCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface DeviceInfo {
  name: string;
  type: string;
  id: string;
}

export interface SessionState {
  mode: SessionMode;
  timeoutId: NodeJS.Timeout | null;
  data?: any;
  pendingCommand?: PlayerCommand;
}