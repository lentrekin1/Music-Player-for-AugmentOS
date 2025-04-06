# Music Player - Music Player for AugmentOS

Music Player is an app that allows for integration with spotify to control your music with Augment OS. Allowing you to see your current playing song or change music through glasses that are compatible with Augment OS.

## Usage

### Installation

1. Set up environment variables:

   ```
   AUGMENTOS_API_KEY=your_augment_api_key
   AUGMENTOS_WS_URL=wss://staging.augmentos.org/tpa-ws #(optional)
   SPOTIFY_CLIENT_ID=your_spotify_client_id
   SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
   WEB_URL=http://localhost #(optional: switch with ngrok if using)
   WEB_PORT=4040 #(optional)
   REDIRECT_URI=http://localhost:4040/callback #(optional: switch with ngrok if using)
   AUTH_PORT=4041 #(optional)
   TOKEN_ENCRYPTION_KEY= #32bit key
   NODE_env= #logging
   ```
2. Install dependencies:

   ```
   bun install
   ```
3. Build and start the server:

   ```
   bun run index.ts
   ```

### Voice Commands

- "What\'s playing", "Now playing", "Current song" - Display Now Playing music with artist and album
- "Next song", "skip song" - Plays the next song in queue
- "Previous song", "Rewind" - Plays the previous in queue
- "Play" - Starts or resumes music
- "Pause" - Stop or pauses music

## Development

### Adding Controls

1. Add touch controls for playing, skipping, & rewinding songs
2. Play music on last device or selection of device
3. Pick playlist

### Planned

1. Apple Music integration
