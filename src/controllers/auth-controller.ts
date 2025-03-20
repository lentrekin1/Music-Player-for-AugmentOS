import { Router, Request, Response } from 'express';
import { spotifyService } from '../services/spotify-service';
import { activeSessions } from '../server';
import { displayCurrentlyPlaying } from '../handlers/session-handler';

const router = Router();

// Handle spotify auth
router.get('/login/:sessionId', (req: Request, res: Response) => {
  const sessionId = req.params.sessionId;
  const authUrl = spotifyService.createAuthorizationUrl(sessionId);
  res.redirect(authUrl);
});

// Handle callback from Spotify
router.get('/callback', async (req: Request, res: Response) => {
  const { code, state } = req.query;
  const sessionId = state as string;

  try {
    // Exchange authorization code for access token
    await spotifyService.handleAuthorizationCallback(code as string, sessionId);

    res.send('Authentication successful! You can close this window and return to your glasses.');

    // If there's a session active, display now playing information
    const session = activeSessions.get(sessionId);
    if (session) {
      await displayCurrentlyPlaying(session, sessionId);
    }
  } catch (error) {
    console.error('Authentication error:', error);
    res.send('Authentication failed. Please try again.');
  }
});

export const authRoutes = router;