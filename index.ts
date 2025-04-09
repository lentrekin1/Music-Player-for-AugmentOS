import {server} from './src/server';
import { logEnvironment } from './src/config/environment';

// Log environment variables
logEnvironment();

server.start().catch(error => {
  console.error('Failed to start server:', error);
  process.exit(1);
});