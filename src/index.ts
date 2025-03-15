import { TpaServer, TpaSession } from '@augmentos/sdk';
import SpotifyWebApi from 'spotify-web-api-node';
import express from 'express';
import { SpotifyCredentials } from '../src/types';
import dotenv from 'dotenv'

class MusicPlayer extends TpaServer {
  private spotifyApi: SpotifyWebApi;
  private userTokens: Map<string, SpotifyCredentials> = new Map();
  private nowPlayingIntervals: Map<string, NodeJS.Timeout> = new Map();

  constructor(config: any) {
    super(config);

    // Initialize Spotify Api with app credentials
    this.spotifyApi = new SpotifyWebApi({
      clientId: process.env.SPOTIFY_CLIENT_ID || 'YOUR_CLIENT_ID',
      clientSecret: process.env.SPOTIFY_CLIENT_SECRET || 'YOUR_CLIENT_SECRET',
      redirectUri: process.env.REDIRECT_URI || 'http://localhost:4040/callback'
    });

    // Set up express server for auth callback
    const app = this.getExpressApp();

    // Handle spotify auth
    app.get('/login/:sessionId', (req, res) => {
      const sessionId = req.params.sessionId;
      // State value to verify callback is true
      const state = sessionId;
      // Generate auth URL with necessary scopes (Spotify web-api scopes)
      const authUrl = this.spotifyApi.createAuthorizeURL([
        'user-read-currently-playing',
        'user-read-playback-state'
      ], state);

      res.redirect(authUrl);
    });

    // Handle callback from Spotify
    app.get('/callback', async(req, res) => {
      const { code, state } = req.query;
      const sessionId = state as string;

      try {
        // Exchange authorization code for access token
        const data = await this.spotifyApi.authorizationCodeGrant(code as string)

        // Store user tokens for this session
        this.userTokens.set(sessionId, {
          accessToken: data.body.access_token,
          refreshToken: data.body.refresh_token,
          expiresAt: Date.now() + data.body.expires_in * 1000
        });

        res.send('Authentication successful! You can close this window and return to your glasses.');

        // If there's a session active, display now playing information
        const session = this.activeSessions.get(sessionId);
        if (session) {
          this.startNowPlayingUpdates(session, sessionId);
        }
      } catch (error) {
        console.error('Authentication error:', error);
        res.send('Authentication failed. Please try again.');
      }
    });

    // Starts the express server
    app.listen(process.env.AUTH_PORT, () => {
      console.log(`Authentication server running on port ${process.env.AUTH_PORT}`);
    });
  }

  // Called when new user connects to app
  protected async onSession(session: TpaSession, sessionId: string, userId: string): Promise<void> {
    console.log(`New session started: ${sessionId} for user: ${userId}`);

    // Check if user is already authenticated with spotify
    if (this.userTokens.has(sessionId)) {
      // User is authenticated, start showing now playing info
      this.startNowPlayingUpdates(session, sessionId);
    } else {
      // User needs to authenticate
      console.log(`${process.env.WEB_URL}/login/${sessionId}`)
      session.layouts.showTextWall(
        'Please visit the following URL on your phone or computer to connect your Spotify account:\n\n' +
        `${process.env.WEB_URL}/login/${sessionId}`
      );
    }

    // Handle cleanup when session ends
    const cleanup = [
      // Listen for user command via transcription
      session.events.onTranscription((data) => {
        if (data.isFinal && data.text.toLowerCase().includes('refresh spotify')) {
          this.updateNowPlaying(session, sessionId);
        }
      }),

      // Handle errors
      session.events.onError((error) => {
        console.error('Error:', error);
        session.layouts.showTextWall(`Error: ${error.message}`);
      })
    ];

    // Register cleanup handlers
    cleanup.forEach(handler => this.addCleanupHandler(handler));
  }

  // Starts periodic updates of now playing information
  private startNowPlayingUpdates(session: TpaSession, sessionId: string): void {
    // Clear any existing interval
    if (this.nowPlayingIntervals.has(sessionId)) {
      clearInterval(this.nowPlayingIntervals.get(sessionId));
    }

    // Initial load of now playing
    this.updateNowPlaying(session, sessionId);

    // Periodic updates of now playing every 1 min (60000 ms) (Uncomment if you want periodic now playing showing)
    // const interval = setInterval(() => {
    //   this.updateNowPlaying(session, sessionId);
    // }, 60000);

    // this.nowPlayingIntervals.set(sessionId, interval);

    // Add cleanup when session ends
    this.addCleanupHandler(() => {
      if (this.nowPlayingIntervals.get(sessionId)) {
        clearInterval(this.nowPlayingIntervals.get(sessionId));
        this.nowPlayingIntervals.delete(sessionId);
      }
    });
  }

  // Update the now playing information
  private async updateNowPlaying(session: TpaSession, sessionId: string): Promise<void> {
    const credentials = this.userTokens.get(sessionId);
    // No credentials kill function (No one logged in)
    if (!credentials) {
      return;
    }

    // Check if token needs refreshing
    if (Date.now() > credentials.expiresAt - 60000) {
      try {
        // Set the refresh token and refresh access token
        this.spotifyApi.setRefreshToken(credentials.refreshToken);
        const data = await this.spotifyApi.refreshAccessToken();

        // Update stored credentials
        this.userTokens.set(sessionId, {
          accessToken: data.body.access_token,
          refreshToken: credentials.refreshToken,
          expiresAt: Date.now() + data.body.expires_in * 1000
        });

        // Set the new access token
        this.spotifyApi.setAccessToken(data.body.access_token);
      } catch (error) {
        console.error('Token refresh error:', error);
        session.layouts.showTextWall('Error refreshing Spotify connection. Please reconnect your account.');
        return;
      }
    } else {
      // Set the access token for this request
      this.spotifyApi.setAccessToken(credentials.accessToken);
    }

    try {
      // Get the user's currently playing track
      const data = await this.spotifyApi.getMyCurrentPlaybackState();

      if (data.body && data.body.item) {
        const track = data.body.item;
        const artists = track.artists.map(artist => artist.name).join(', ');
        const isPlaying = data.body.is_playing;

        // Display the ow playing information
        session.layouts.showTextWall(
          `${isPlaying ? 'Now Playing' : 'Paused'}\n\n` +
          `Song: ${track.name}\n` +
          `Artist: ${artists}\n` +
          `Album: ${track.album.name}`,
          { durationMs: 5000 }  // Show for 5 seconds
        );
      } else {
        // Nothing is playing
        session.layouts.showTextWall('No track currently playing on spotify');
      }
    } catch (error) {
      console.error('Spotify API error:', error);
      session.layouts.showTextWall('Error connecting to spotify. Please try again.');
    }
  }
}

const tpa = new MusicPlayer({
  packageName: 'org.gikaeh.music-player-for-augment-os',
  apiKey: process.env.AUGMENTOS_API_KEY || '',
  port: process.env.WEB_PORT || 4040,
  augmentOSWebsocketUrl: process.env.UGMENTOS_WS_URL || 'wss://staging.augmentos.org/tpa-ws'
});

// Load env variables
dotenv.config();

console.log('=== Environment Variables ===');
console.log(`URL: ${process.env.WEB_URL || '(not set, using default http://localhost:PORT)'}`);
console.log(`PORT: ${process.env.WEB_PORT || '(not set, using default 4040)'}`);
console.log(`AUGMENTOS_API_KEY: ${process.env.AUGMENTOS_API_KEY ? 'Set' : 'Not set'}`);
console.log(`AUGMENTOS_WS_URL: ${process.env.AUGMENTOS_WS_URL || '(using default)'}`);
console.log(`REDIRECT_URI: ${process.env.REDIRECT_URI ? 'Set' : 'Not set'}`);

tpa.start().catch(console.error);