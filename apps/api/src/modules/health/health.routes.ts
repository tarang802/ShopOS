import { Router } from 'express';
import { live, ready, status } from './health.controller';

export const healthRouter = Router();

healthRouter.get('/', status);
healthRouter.get('/live', live);
healthRouter.get('/ready', ready);
