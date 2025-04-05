import SpotifyWebApi from 'spotify-web-api-node';
import {tokenService} from './token-service';
import {config} from '../config/environment';

export class SpotifyService {
  private spotifyApi: SpotifyWebApi;

  constructor() {
    // Initialize Spotify Api with app credentials
    this.spotifyApi = new SpotifyWebApi({
      clientId: config.spotify.clientId,
      clientSecret: config.spotify.clientSecret,
      redirectUri: config.spotify.redirectUri
    });
  }

  public createAuthorizationUrl(sessionId: string): string {
    // Generate auth URL with necessary scopes (Spotify web-api scopes)
    return this.spotifyApi.createAuthorizeURL([
      'user-read-currently-playing',
      'user-read-playback-state',
      'user-modify-playback-state'
    ], sessionId);
  }

  public async handleAuthorizationCallback(code: string, sessionId: string): Promise<void> {
    // Exchange authorization code for access token
    const data = await this.spotifyApi.authorizationCodeGrant(code);

    // Store user tokens for this session
    tokenService.setToken(sessionId, {
      accessToken: data.body.access_token,
      refreshToken: data.body.refresh_token,
      expiresAt: Date.now() + data.body.expires_in * 1000
    });
  }

  public async refreshTokenIfNeeded(sessionId: string): Promise<boolean> {
    const credentials = tokenService.getToken(sessionId);
    if (!credentials) return false;

    // Check if token needs refreshing
    if (Date.now() > credentials.expiresAt - 60000) {
      try {
        // Set the refresh token and refresh access token
        this.spotifyApi.setRefreshToken(credentials.refreshToken);
        const data = await this.spotifyApi.refreshAccessToken();

        // Update stored credentials
        tokenService.setToken(sessionId, {
          accessToken: data.body.access_token,
          refreshToken: credentials.refreshToken,
          expiresAt: Date.now() + data.body.expires_in * 1000
        });

        // Set the new access token
        this.spotifyApi.setAccessToken(data.body.access_token);
        return true;
      } catch (error) {
        console.error('Token refresh error:', error);
        return false;
      }
    } else {
      // Set the access token for this request
      this.spotifyApi.setAccessToken(credentials.accessToken);
      return true;
    }
  }

  public async getCurrentlyPlaying(sessionId: string): Promise<{isPlaying: boolean; trackName?: string; artists?: string; albumName?: string;}> {
    const credentials = tokenService.getToken(sessionId)

    if (!credentials) {
      console.error('No token found for session', sessionId);
      return {isPlaying: false};
    }

    this.spotifyApi.setAccessToken(credentials.accessToken);

    // Get the user's currently playing track
    const data = await this.spotifyApi.getMyCurrentPlaybackState();
    
    if (data.body && data.body.item) {
      const track = data.body.item;
      const artists = track.artists.map(artist => artist.name).join(', ');
      
      return {
        isPlaying: data.body.is_playing,
        trackName: track.name,
        artists,
        albumName: track.album.name
      };
    }
    
    return {isPlaying: false};
  }

  public async playTrack(sessionId: string): Promise<void> {
    const credentials = tokenService.getToken(sessionId)

    if (!credentials) {
      console.error('No token found for session', sessionId);
    }

    this.spotifyApi.setAccessToken(credentials.accessToken);
    await this.spotifyApi.play();
  }

  public async pauseTrack(sessionId: string): Promise<void> {
    const credentials = tokenService.getToken(sessionId)

    if (!credentials) {
      console.error('No token found for session', sessionId);
    }

    this.spotifyApi.setAccessToken(credentials.accessToken);
    await this.spotifyApi.pause();
  }

  public async nextTrack(sessionId: string): Promise<void> {
    const credentials = tokenService.getToken(sessionId)

    if (!credentials) {
      console.error('No token found for session', sessionId);
    }

    this.spotifyApi.setAccessToken(credentials.accessToken);
    await this.spotifyApi.skipToNext();
  }

  public async previousTrack(sessionId: string): Promise<void> {
    const credentials = tokenService.getToken(sessionId)

    if (!credentials) {
      console.error('No token found for session', sessionId);
    }

    this.spotifyApi.setAccessToken(credentials.accessToken);
    await this.spotifyApi.skipToPrevious();
  }

  public async getDevice(sessionId: string): Promise<SpotifyApi.UserDevice[]> {
    const credentials = tokenService.getToken(sessionId);

    if (!credentials) {
      console.error('No token found for session', sessionId);
    }

    this.spotifyApi.setAccessToken(credentials.accessToken);
    const devices = (await this.spotifyApi.getMyDevices()).body.devices;

    return devices;
  }

  public async setDevice(sessionId: string, deviceId: string[]): Promise<void> {
    const credentials = tokenService.getToken(sessionId);

    if (!credentials) {
      console.error('No token found for session', sessionId);
    }

    this.spotifyApi.setAccessToken(credentials.accessToken);
    await this.spotifyApi.transferMyPlayback(deviceId);
  }
}

export const spotifyService = new SpotifyService();