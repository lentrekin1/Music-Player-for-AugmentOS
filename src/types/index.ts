import {SessionMode, PlayerCommand} from "../handlers/session-handler";

export interface SpotifyCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export enum SettingKey {
  MUSIC_PLAYER = 'music_player',
  VOICE_COMMANDS = 'voice_commands',
  HEADS_UP_DISPLAY = 'heads_up_display'
}

export interface ProcessedUserSettings {
  musicPlayer: 'spotify' | 'android' | 'ios',
  isVoiceCommands: boolean,
  isHeadsUpDisplay: boolean
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