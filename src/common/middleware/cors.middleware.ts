import type { NextFunction, Request, Response } from 'express';

const ALLOWED_METHODS = [
  'GET',
  'HEAD',
  'PUT',
  'PATCH',
  'POST',
  'DELETE',
  'OPTIONS',
].join(', ');
const ALLOWED_HEADERS = ['Content-Type', 'Authorization', 'X-Api-Key'].join(
  ', ',
);

/**
 * Returns an Express middleware that applies split-CORS rules:
 * - Gateway proxy routes (/api/*): fully open to any cross-origin client.
 * - All other routes (auth, health): restricted to {@link corsOrigins},
 *   with credentials allowed.
 */
export function createCorsMiddleware(
  corsOrigins: string[],
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.path.startsWith('/api/')) {
      const origin = req.headers.origin;
      if (origin) {
        if (corsOrigins.includes(origin)) {
          // Known origin: reflect with credentials allowed.
          res.setHeader('Access-Control-Allow-Origin', origin);
          res.setHeader('Access-Control-Allow-Credentials', 'true');
          res.setHeader('Vary', 'Origin');
        } else {
          // Unknown origin: gateway proxy routes are fully open, use wildcard.
          // Wildcard cannot be combined with Access-Control-Allow-Credentials.
          res.setHeader('Access-Control-Allow-Origin', '*');
        }
      } else {
        // Non-browser (server-to-server) request: no Origin header, wildcard is safe.
        res.setHeader('Access-Control-Allow-Origin', '*');
      }
      res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS);
      res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }
    } else {
      const origin = req.headers.origin;
      if (origin && corsOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS);
        res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
        if (req.method === 'OPTIONS') {
          res.status(204).end();
          return;
        }
      }
    }
    next();
  };
}
