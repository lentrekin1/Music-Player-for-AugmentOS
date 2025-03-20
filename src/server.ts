import { TpaServer, TpaSession } from '@augmentos/sdk';
import { createExpressApp } from './app';
import { config } from './config/environment';
import { tokenService } from './services/token-service';
import { setupSessionHandlers, displayCurrentlyPlaying } from './handlers/session-handler';

// Keep track of active sessions
export const activeSessions = new Map<string, TpaSession>();

export class MusicPlayerServer extends TpaServer {
  // Use a different name to avoid collision with parent class
  private sessionHandlers: Array<() => void> = [];

  constructor() {
    super({
      packageName: config.augmentOS.packageName,
      apiKey: config.augmentOS.apiKey,
      port: config.server.port,
      augmentOSWebsocketUrl: config.augmentOS.websocketUrl
    });

    // Get the Express app for adding custom routes
    const app = this.getExpressApp();
    
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

    // Check if user is already authenticated with Spotify
    if (tokenService.hasToken(sessionId)) {
      // User is authenticated, start showing now playing info
      await displayCurrentlyPlaying(session, sessionId);
    } else {
      // User needs to authenticate
      const loginUrl = `${config.server.webUrl}/login/${sessionId}`;
      console.log(loginUrl);
      session.layouts.showDoubleTextWall(
        'Please visit the following URL on your phone or computer to connect your Spotify account:',
        loginUrl
      );
    }

    // Set up event handlers for this session and get the cleanup handlers
    const handlers = setupSessionHandlers(session, sessionId);
    
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
}