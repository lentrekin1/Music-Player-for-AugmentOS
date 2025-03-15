export interface ButtonPress {
  buttonId: string;      // Identifier for the pressed button
  type: 'single' | 'double'
  timestamp: number;     // Event timestamp
} 

export interface SpotifyCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}