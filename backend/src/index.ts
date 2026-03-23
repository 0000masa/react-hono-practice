import { serve } from '@hono/node-server';
import app from './app';
import { env } from './config/env';
import { ensureBucket } from './config/storage';

async function main() {
  try {
    await ensureBucket();
    console.log('S3 bucket initialized.');
  } catch (error) {
    console.warn('Failed to initialize S3 bucket (will retry on use):', error);
  }

  serve(
    {
      fetch: app.fetch,
      port: env.PORT,
    },
    (info) => {
      console.log(`Server is running on http://localhost:${info.port}`);
    },
  );
}

main();
