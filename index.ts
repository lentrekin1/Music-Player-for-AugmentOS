import { MusicPlayerServer } from './src/server';
import { logEnvironment } from './src/config/environment';

// Log environment variables
logEnvironment();

// Create and start the server
const server = new MusicPlayerServer();
server.start().catch(error => {
  console.error('Failed to start server:', error);
  process.exit(1);
});