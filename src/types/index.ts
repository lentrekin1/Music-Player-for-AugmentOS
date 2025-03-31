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