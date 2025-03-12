import { TpaServer, TpaSession } from '@augmentos/sdk';
import SpotifyWebApi from 'spotify-web-api-node';
import express from 'express';
import { createServer } from 'http';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Spotify API credentials
const clientId = process.env.SPOTIFY_CLIENT_ID;
const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
const redirectUri = process.env.REDIRECT_URI || 'http://localhost:3000/callback';

// Store user tokens
const userTokens = new Map<string, {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}>();

class SpotifyTPA extends TpaServer {
  private spotifyApi: SpotifyWebApi;
  private tokenRefreshIntervals: Map<string, NodeJS.Timeout> = new Map();

  constructor(config: any) {
    super(config);
    
    this.spotifyApi = new SpotifyWebApi({
      clientId,
      clientSecret,
      redirectUri
    });
    
    // Setup additional routes for OAuth flow
    this.setupOAuthRoutes();
  }

  private setupOAuthRoutes() {
    const app = express();
    const server = createServer(app);
    
    // Login route
    app.get('/login', (req, res) => {
      const state = Math.random().toString(36).substring(2, 15);
      const scopes = [
        'user-read-private',
        'user-read-email',
        'user-read-currently-playing',
        'user-read-playback-state',
        'user-modify-playback-state'
      ];
      
      const authorizeURL = this.spotifyApi.createAuthorizeURL(scopes, state);
      res.redirect(authorizeURL);
    });
    
    // Callback route
    app.get('/callback', async (req, res) => {
      const { code } = req.query;
      
      try {
        const data = await this.spotifyApi.authorizationCodeGrant(code as string);
        const { access_token, refresh_token, expires_in } = data.body;
        
        // For demo purposes, we're using a fixed userId
        // In a real app, you'd map this to the authenticated user
        const userId = 'demo-user';
        
        userTokens.set(userId, {
          accessToken: access_token,
          refreshToken: refresh_token,
          expiresAt: Date.now() + expires_in * 1000
        });
        
        // Setup token refresh interval
        this.setupTokenRefresh(userId);
        
        res.send('Authentication successful! You can now close this window and use the app on your AugmentOS device.');
      } catch (error) {
        console.error('Error during authorization:', error);
        res.status(500).send('Authentication failed');
      }
    });
    
    // Start the server
    const port = 3001; // Different from TPA server port
    server.listen(port, () => {
      console.log(`OAuth server running on port ${port}`);
      console.log(`Visit http://localhost:${port}/login to authenticate with Spotify`);
    });
  }
  
  private setupTokenRefresh(userId: string) {
    // Clear any existing interval
    if (this.tokenRefreshIntervals.has(userId)) {
      clearInterval(this.tokenRefreshIntervals.get(userId));
    }
    
    // Set up refresh interval (refresh tokens 5 minutes before they expire)
    const userToken = userTokens.get(userId);
    if (userToken) {
      const refreshTime = (userToken.expiresAt - Date.now() - 5 * 60 * 1000);
      
      const interval = setInterval(async () => {
        try {
          const userData = userTokens.get(userId);
          if (!userData) return;
          
          this.spotifyApi.setRefreshToken(userData.refreshToken);
          const data = await this.spotifyApi.refreshAccessToken();
          
          userTokens.set(userId, {
            accessToken: data.body.access_token,
            refreshToken: userData.refreshToken,
            expiresAt: Date.now() + data.body.expires_in * 1000
          });
          
          console.log(`Refreshed token for user ${userId}`);
        } catch (error) {
          console.error('Error refreshing token:', error);
        }
      }, refreshTime > 0 ? refreshTime : 0);
      
      this.tokenRefreshIntervals.set(userId, interval);
    }
  }

  protected async onSession(session: TpaSession, sessionId: string, userId: string): Promise<void> {
    session.layouts.showTextWall("Spotify TPA Ready!");
    
    // Check if user is authenticated
    const userData = userTokens.get(userId);
    if (!userData) {
      session.layouts.showReferenceCard(
        "Authentication Required",
        "Please visit http://localhost:3001/login on your computer to connect your Spotify account."
      );
      return;
    }
    
    // Set access token
    this.spotifyApi.setAccessToken(userData.accessToken);
    
    // Initial now playing info
    await this.updateNowPlaying(session);
    
    // Set up event handlers
    const cleanup = [
      // Periodically update the now playing information
      setInterval(async () => {
        await this.updateNowPlaying(session);
      }, 5000),
      
      // Handle head position for navigation
      session.events.onHeadPosition(async (data) => {
        if (data.position === 'up') {
          // Skip to next track
          try {
            await this.spotifyApi.skipToNext();
            session.layouts.showTextWall("Skipped to next track", { durationMs: 2000 });
            
            // Wait a moment for Spotify to update
            setTimeout(async () => {
              await this.updateNowPlaying(session);
            }, 500);
          } catch (error) {
            console.error('Error skipping track:', error);
            session.layouts.showReferenceCard("Error", "Failed to skip track");
          }
        } else if (data.position === 'down') {
          // Skip to previous track
          try {
            await this.spotifyApi.skipToPrevious();
            session.layouts.showTextWall("Skipped to previous track", { durationMs: 2000 });
            
            // Wait a moment for Spotify to update
            setTimeout(async () => {
              await this.updateNowPlaying(session);
            }, 500);
          } catch (error) {
            console.error('Error skipping to previous track:', error);
            session.layouts.showReferenceCard("Error", "Failed to skip to previous track");
          }
        }
      }),
      
      // Handle button press for play/pause
      session.events.onButtonPress(async (data) => {
        if (data.type === 'single') {
          try {
            const playbackState = await this.spotifyApi.getMyCurrentPlaybackState();
            
            if (playbackState.body && playbackState.body.is_playing) {
              await this.spotifyApi.pause();
              session.layouts.showTextWall("Paused", { durationMs: 2000 });
            } else {
              await this.spotifyApi.play();
              session.layouts.showTextWall("Playing", { durationMs: 2000 });
            }
            
            // Wait a moment for Spotify to update
            setTimeout(async () => {
              await this.updateNowPlaying(session);
            }, 500);
          } catch (error) {
            console.error('Error toggling playback:', error);
            session.layouts.showReferenceCard("Error", "Failed to toggle playback");
          }
        }
      }),
      
      // Handle voice commands
      session.events.onTranscription(async (data) => {
        if (data.isFinal) {
          const text = data.text.toLowerCase();
          
          if (text.includes('play') || text.includes('resume')) {
            try {
              await this.spotifyApi.play();
              session.layouts.showTextWall("Playing", { durationMs: 2000 });
              setTimeout(() => this.updateNowPlaying(session), 500);
            } catch (error) {
              console.error('Error starting playback:', error);
            }
          } else if (text.includes('pause') || text.includes('stop')) {
            try {
              await this.spotifyApi.pause();
              session.layouts.showTextWall("Paused", { durationMs: 2000 });
              setTimeout(() => this.updateNowPlaying(session), 500);
            } catch (error) {
              console.error('Error pausing playback:', error);
            }
          } else if (text.includes('next') || text.includes('skip')) {
            try {
              await this.spotifyApi.skipToNext();
              session.layouts.showTextWall("Skipped to next track", { durationMs: 2000 });
              setTimeout(() => this.updateNowPlaying(session), 500);
            } catch (error) {
              console.error('Error skipping track:', error);
            }
          } else if (text.includes('previous') || text.includes('back')) {
            try {
              await this.spotifyApi.skipToPrevious();
              session.layouts.showTextWall("Skipped to previous track", { durationMs: 2000 });
              setTimeout(() => this.updateNowPlaying(session), 500);
            } catch (error) {
              console.error('Error skipping to previous track:', error);
            }
          }
        }
      }),
      
      // Handle errors
      session.events.onError((error) => {
        console.error('Session error:', error);
        session.layouts.showReferenceCard("Error", error.message);
      })
    ];
    
    // Add cleanup handlers
    cleanup.forEach(handler => {
      if (typeof handler === 'function') {
        this.addCleanupHandler(handler);
      } else if (handler) {
        // For intervals
        this.addCleanupHandler(() => clearInterval(handler));
      }
    });
  }
  
  protected async onStop(sessionId: string): Promise<void> {
    console.log(`Session ${sessionId} stopped`);
  }
  
  private async updateNowPlaying(session: TpaSession) {
    try {
      const data = await this.spotifyApi.getMyCurrentPlayingTrack();
      
      if (data.body && data.body.item) {
        const track = data.body.item;
        const artists = (track as any).artists.map((a: any) => a.name).join(', ');
        const trackName = (track as any).name;
        const isPlaying = data.body.is_playing;
        
        // Display now playing information
        session.layouts.showReferenceCard(
          `${isPlaying ? '▶️ Now Playing' : '⏸️ Paused'}`,
          `${trackName}\nby ${artists}\n\n👆 Next Track\n👇 Previous Track\n👉 Press Button to Play/Pause`
        );
      } else {
        session.layouts.showReferenceCard(
          "Spotify",
          "No track currently playing\n\nPlay music on Spotify to see track information here."
        );
      }
    } catch (error) {
      console.error('Error fetching now playing:', error);
      session.layouts.showReferenceCard(
        "Error",
        "Failed to fetch now playing information. Please ensure Spotify is connected."
      );
    }
  }
}

// Start the server
const app = new SpotifyTPA({
  packageName: 'org.example.spotify',
  apiKey: process.env.AUGMENTOS_API_KEY || 'your_api_key',
  port: 3000,
  augmentOSWebsocketUrl: process.env.AUGMENTOS_WS_URL || 'wss://staging.augmentos.org/tpa-ws'
});

app.start().catch(console.error);