import { Logger } from '@nestjs/common';

const logger = new Logger('RouteMapLoader');

/**
 * If ROUTE_MAP_URL is set and ROUTE_MAP is not, fetches the route map JSON from
 * the given URL and writes it into process.env.ROUTE_MAP so that the synchronous
 * gateway config factory can consume it as usual.
 *
 * Call this before NestFactory.create() in main.ts.
 */
export async function preloadRouteMapFromUrl(): Promise<void> {
  if (process.env.ROUTE_MAP) {
    // ROUTE_MAP is already set – nothing to do.
    return;
  }

  const url = process.env.ROUTE_MAP_URL;
  if (!url) {
    // Neither variable is set; gateway.config.ts will throw with a clear message.
    return;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error(`ROUTE_MAP_URL is not a valid URL: "${url}"`);
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error(
      `ROUTE_MAP_URL must use http or https protocol, got "${parsedUrl.protocol}"`,
    );
  }

  logger.log(`Fetching route map from ROUTE_MAP_URL: ${url}`);

  let response: Response;
  try {
    response = await fetch(url);
  } catch (err) {
    throw new Error(`Failed to reach ROUTE_MAP_URL "${url}": ${String(err)}`, {
      cause: err,
    });
  }

  if (!response.ok) {
    throw new Error(
      `ROUTE_MAP_URL "${url}" responded with HTTP ${response.status} ${response.statusText}`,
    );
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    logger.warn(
      `ROUTE_MAP_URL response Content-Type is "${contentType}"; expected "application/json"`,
    );
  }

  const body = await response.text();
  process.env.ROUTE_MAP = body;

  logger.log('Route map successfully loaded from ROUTE_MAP_URL');
}
