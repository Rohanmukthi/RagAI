import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { apiRouter } from './server/routes.js';
import { safeStorage } from './server/storage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

process.on('unhandledRejection', (reason, promise) => {
  console.warn('Unhandled Rejection at:', promise, 'reason:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

async function startServer() {
  const app = express();

  // Dev server must run on port 3000 per environment constraints
  const PORT = 3000;

  // 6. Enable CORS for frontend and external requests
  app.use(
    cors({
      origin: '*',
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    })
  );

  // Middleware for JSON & URL-encoded bodies
  app.use(express.json({ limit: '25mb' }));
  app.use(express.urlencoded({ extended: true, limit: '25mb' }));

  // Root JSON handler when explicitly requesting application/json
  app.get('/', (req, res, next) => {
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.json({
        service: 'University Academic Policy & Student Support Assistant API',
        version: '1.0.0',
        phase: 'Phase 1 - Backend Foundation Active',
        status: 'operational',
        endpoints: [
          'GET /api/health',
          'GET /api/documents',
          'POST /api/documents/upload',
          'POST /api/documents/ingest',
          'POST /api/chat',
        ],
      });
    }
    next();
  });

  // Mount Health endpoint at root /health and /api/health
  app.get('/health', (req, res) => {
    const docs = safeStorage.listDocuments();
    res.json({
      status: 'healthy',
      service: 'University Academic Policy & Student Support Assistant API',
      phase: 'Phase 1 - Backend Foundation Active',
      rag_status: 'not_implemented',
      documents_count: docs.length,
      timestamp: new Date().toISOString(),
    });
  });

  // Mount API router at /api
  app.use('/api', apiRouter);

  // Vite development middleware or static production serving
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  // Start listening immediately
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`University Academic Policy & Student Support Assistant API active on port ${PORT}`);
  });

  return server;
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
