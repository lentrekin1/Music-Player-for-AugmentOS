import {TpaServer, TpaSession } from '@augmentos/sdk';
import SpotifyWebApi from 'spotify-web-api-node';
import {SpotifyCredentials} from '../src/types';
import dotenv from 'dotenv'
import fs from 'fs';
import path from 'path';
import { setTimeout } from "timers/promises";

class MusicPlayer extends TpaServer {
  private spotifyApi: SpotifyWebApi;
  private userTokens: Map<string, SpotifyCredentials> = new Map();

  constructor(config: any) {
    super(config);

    // Initialize Spotify Api with app credentials
    this.spotifyApi = new SpotifyWebApi({
      clientId: process.env.SPOTIFY_CLIENT_ID || 'YOUR_CLIENT_ID',
      clientSecret: process.env.SPOTIFY_CLIENT_SECRET || 'YOUR_CLIENT_SECRET',
      redirectUri: process.env.REDIRECT_URI || 'http://localhost:4040/callback'
    });

    this.loadTokens();

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
        'user-read-playback-state',
        'user-modify-playback-state'
      ], state);

      res.redirect(authUrl);
    });

    // Handle callback from Spotify
    app.get('/callback', async(req, res) => {
      const {code, state}= req.query;
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

        this.saveTokens();

        res.send('Authentication successful! You can close this window and return to your glasses.');

        // If there's a session active, display now playing information
        const session = this.activeSessions.get(sessionId);
        if (session) {
          this.updateNowPlaying(session, sessionId, 'current');
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

  private saveTokens(): void {
    // Convert Map to an object that can be serialized
    const tokensObj = Object.fromEntries(this.userTokens);
    
    // Create a data directory if it doesn't exist
    const dataDir = path.join(__dirname, '../data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    // Write tokens to a JSON file
    fs.writeFileSync(
      path.join(dataDir, 'spotify_tokens.json'), 
      JSON.stringify(tokensObj, null, 2)
    );
    console.log('Tokens saved to file');
  }
  
  private loadTokens(): void {
    try {
      const filePath = path.join(__dirname, '../data/spotify_tokens.json');
      if (fs.existsSync(filePath)) {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const tokensObj = JSON.parse(fileContent);
        
        // Convert the plain object back to a Map
        this.userTokens = new Map(Object.entries(tokensObj));
        console.log(`Loaded ${this.userTokens.size} tokens from storage`);
      } else {
        console.log('No saved tokens found');
      }
    } catch (error) {
      console.error('Error loading tokens:', error);
      // Keep the current empty Map if there's an error
    }
  }

  // Add this method to MusicPlayer class
  private removeUserToken(sessionId: string): void {
    if (this.userTokens.has(sessionId)) {
      this.userTokens.delete(sessionId);
      this.saveTokens();
      console.log(`Removed token for session ${sessionId}`);
    }
  }

  // Called when new user connects to app
  protected async onSession(session: TpaSession, sessionId: string, userId: string): Promise<void> {
    console.log(`New session started: ${sessionId} for user: ${userId}`);

    // Check if user is already authenticated with spotify
    if (this.userTokens.has(sessionId)) {
      // User is authenticated, start showing now playing info
      this.updateNowPlaying(session, sessionId, 'current');
    } else {
      // User needs to authenticate
      console.log(`${process.env.WEB_URL || `http://localhost:${process.env.WEB_PORT}`}/login/${sessionId}`)
      session.layouts.showDoubleTextWall(
        'Please visit the following URL on your phone or computer to connect your Spotify account:',
        `${process.env.WEB_URL  || `http://localhost:${process.env.WEB_PORT}`}/login/${sessionId}`
      );
    }

    // Handle cleanup when session ends
    const cleanup = [
      // Listen for user command via transcription
      session.events.onTranscription((data) => {
        const current = ['current.', 'what\'s playing', 'now playing', 'current song']
        const next = ['next.', 'next song', 'skip song'];
        const back = ['back.', 'previous.', 'previous song', 'rewind.'];
        const play = ['play.', 'play music', 'play song'];
        const pause = ['pause.', 'pause music', 'pause song'];

        console.log(data);
        for (const item of current) {
          if (data.isFinal && data.text.toLowerCase().includes(item)) {
            this.updateNowPlaying(session, sessionId, 'current');
          }
        }
        for (const item of next) {
          if (data.isFinal && data.text.toLowerCase().includes(item)) {
            this.updateNowPlaying(session, sessionId, 'next');
          }
        }
        for (const item of back) {
          if (data.isFinal && data.text.toLowerCase().includes(item)) {
            this.updateNowPlaying(session, sessionId, 'back');
          }
        }
        for (const item of play) {
          if (data.isFinal && data.text.toLowerCase().includes(item)) {
            this.updateNowPlaying(session, sessionId, 'play');
          }
        }
        for (const item of pause) {
          if (data.isFinal && data.text.toLowerCase().includes(item)) {
            this.updateNowPlaying(session, sessionId, 'pause');
          }
        }
      }),

      // session.events.onButtonPress((data) => {
      //   console.log(data)
      //   if (data.pressType === 'long') {
      //     this.updateNowPlaying(session, sessionId);
      //   }
      // }),


      // Handle errors
      session.events.onError((error) => {
        console.error('Error:', error);
        session.layouts.showTextWall(`Error: ${error.message}`);
      })
    ];

    // Register cleanup handlers
    cleanup.forEach(handler => this.addCleanupHandler(handler));
  }

  // Update the now playing information
  private async updateNowPlaying(session: TpaSession, sessionId: string, type: string): Promise<void> {
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

        this.saveTokens();

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
      // Switch statement for different actions in the spotify player
      switch (type) {
        case 'current':
          await setTimeout(500)
          this.displayCurrentlyPlaying(session)
          break;
          console.error
        case 'next':
          await this.spotifyApi.skipToNext();
          this.updateNowPlaying(session, sessionId, 'current');
          break;
        
        case 'back':
          await this.spotifyApi.skipToPrevious();
          this.updateNowPlaying(session, sessionId, 'current');
          break;
        
        case 'play':
          try {
            await this.spotifyApi.play()
            this.updateNowPlaying(session, sessionId, 'current')
            break;  
          } catch(error) {
            console.error('Music play error:', error);
            session.layouts.showTextWall('Error playing music.');
            break;
          }

        case 'pause':
          try {
            await this.spotifyApi.pause()
            this.updateNowPlaying(session, sessionId, 'current')
            break;  
          } catch(error) {
            console.error('Music pause error:', error);
            session.layouts.showTextWall('Error pausing music.', {durationMs: 5000});
            break;
          }
        
        // This should not be called unless theres an error or an implementation of a new type and no case
        default:
          console.error(`Error: updateNowPlaying switch has ${type} type`);
          break;
      }
    } catch (error) {
      console.error('Spotify API error:', error);
      session.layouts.showTextWall('Error connecting to spotify. Please try again.');
    }
  }

  private async displayCurrentlyPlaying(session: TpaSession): Promise<void> {
    // Get the user's currently playing track
    const data = await this.spotifyApi.getMyCurrentPlaybackState();
    if (data.body && data.body.item) {
      const track = data.body.item;
      const artists = track.artists.map(artist => artist.name).join(', ');
      const isPlaying = data.body.is_playing;

      // Debug display (will clean up later)
      console.log(
        `${isPlaying ? 'Now Playing' : 'Paused'}\n\n` +
        `Song: ${track.name}\n` +
        `Artist: ${artists}\n` +
        `Album: ${track.album.name}`
      )

      // Display the now playing information
      session.layouts.showTextWall(
        `${isPlaying ? 'Now Playing' : 'Paused'}\n\n` +
        `Song: ${track.name}\n` +
        `Artist: ${artists}\n` +
        `Album: ${track.album.name}`,
        {durationMs: 5000} // Show for 5 seconds
      );
    } else {
      // Nothing is playing
      console.log('No track currently playing on spotify')
      session.layouts.showTextWall('No track currently playing on spotify', {durationMs: 5000});
    }
  }
}

const tpa = new MusicPlayer({
  packageName: 'org.gikaeh.music-player-for-augment-os',
  apiKey: process.env.AUGMENTOS_API_KEY || '',
  port: process.env.WEB_PORT || 4040,
  augmentOSWebsocketUrl: process.env.AUGMENTOS_WS_URL || 'wss://staging.augmentos.org/tpa-ws'
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