import {TpaServer, TpaSession} from '@augmentos/sdk';
import {createExpressApp} from './app';
import axios from 'axios';
import {config} from './config/environment';
import {tokenService} from './services/token-service';
import {setupSessionHandlers, displayCurrentlyPlaying} from './handlers/session-handler';

// Keep track of active sessions
export const activeSessions = new Map<string, TpaSession>();

export class MusicPlayerServer extends TpaServer {
  // Use a different name to avoid collision with parent class
  private sessionHandlers: Array<() => void> = [];
  private appSettings = {
    isHeadsUpDisplay: undefined,
    isVoiceCommands: undefined
  };

  constructor() {
    super({
      packageName: config.augmentOS.packageName,
      apiKey: config.augmentOS.apiKey,
      port: config.server.port
    });

    // Get the Express app for adding custom routes
    const app = this.getExpressApp();

    app.post('/settings', async (req: Request, res: Response) => {
      try {
        const {userIdForSettings, settings} = req.body;

        console.log(req.body);
        
        if (!userIdForSettings || !Array.isArray(settings)) {
          return res.send({error: 'Missing userId or settings array in payload'});
        }
    
        const result = await this.updateSettings(userIdForSettings, settings);
        res.json(result);
      } catch (error) {
        console.error('Error in settings endpoint:', error);
        res.send({error: 'Internal server error updating settings'})
      }
    });
    
    // Merge with our app that has auth routes set up
    const customApp = createExpressApp();
    app.use(customApp);

    // Start auth server on separate port if provided
    if (config.server.authPort) {
      app.listen(config.server.authPort, () => {
        console.log(`Authentication server running on port ${config.server.authPort}`);
      });
    }
  }

  // Called when new user connects to app
  protected async onSession(session: TpaSession, sessionId: string, userId: string): Promise<void> {
    console.log(`New session started: ${sessionId} for user: ${userId}`);
    
    // Store session to access it later
    activeSessions.set(sessionId, session);

    await this.fetchAndApplySettings(session, userId);

    // Check if user is already authenticated with Spotify
    if (tokenService.hasToken(sessionId)) {
      // User is authenticated, start showing now playing info
      await displayCurrentlyPlaying(session, sessionId);
    } else {
      // User needs to authenticate
      const loginUrl = `${config.server.webUrl}/login/${sessionId}`;
      console.log(loginUrl);
      session.layouts.showTextWall(
        `Please visit the following URL on your phone or computer to connect your Spotify account: ${loginUrl}`,
        {durationMs: 5000}
      );
    }

    // Set up event handlers for this session and get the cleanup handlers
    const handlers = setupSessionHandlers(session, sessionId, this.appSettings);
    
    // Use the parent class's addCleanupHandler method instead of managing our own array
    handlers.forEach(handler => this.addCleanupHandler(handler));
  }

  protected async onStop(sessionId: string, userId: string, reason: string): Promise<void> {
    console.log(`Session stopped: ${sessionId} for user: ${userId}. Reason: ${reason}`);
    
    // The parent class will automatically handle the cleanup handlers
    // We just need to remove our session from the active sessions map
    activeSessions.delete(sessionId);
    
    // Call the parent class's onStop method to ensure proper cleanup
    await super.onStop(sessionId, userId, reason);
  }

  private async fetchAndApplySettings(session: TpaSession, userId: string): Promise<void> {
    try {
      const response = await axios.get(`http://cloud.augmentos.org/tpasettings/user/${config.augmentOS.packageName}`, {
        headers: {Authorization: `Bearer ${userId}`}
      });

      const settings = response.data.settings;
      console.log(`Fetched settings for user ${userId}:`, settings);

      this.appSettings.isHeadsUpDisplay = settings.find((s: any) => s.key === 'heads_up_display');
      this.appSettings.isVoiceCommands = settings.find((s: any) => s.key === 'voice_commands');
      console.log(`Applied settings for user ${userId}: headsUpDisplay=${this.appSettings.isHeadsUpDisplay.value}, voiceCommands=${this.appSettings.isVoiceCommands.value}`);
    } catch (error){
      console.error(`Error fetching settings for user ${userId}:`, error);
    }
  }

  public async updateSettings(userId: string, settings: any[]): Promise<any> {
    try {
      console.log('Received settings update for user: ', userId);

      this.appSettings.isHeadsUpDisplay = settings.find(s => s.key === 'heads_up_display');
      this.appSettings.isVoiceCommands = settings.find(s => s.key === 'voice_commands');

      return {
        status: 'Settings updated successfully',
        headsUpDisplay: this.appSettings.isHeadsUpDisplay,
        voiceCommands: this.appSettings.isVoiceCommands
      };
    } catch (error){
      console.error('Error updating settings', error);
    }
  }
}