import { handle } from 'hono/aws-lambda';
import { initDatabase } from './config/database';
import app from './app';

const dbReady = initDatabase();
const lambdaHandler = handle(app);

export const handler = async (event: any, context: any) => {
  await dbReady;
  return lambdaHandler(event, context);
};
