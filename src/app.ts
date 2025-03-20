import express from 'express';
import { authRoutes } from './controllers/auth-controller';
import { config } from './config/environment';

export function createExpressApp() {
  const app = express();
  
  // Add authentication routes
  app.use('/', authRoutes);
  
  return app;
}