import http from 'http';
import { logger } from './logger';
import { MetricsCollector } from './metrics';

export class MetricsServer {
  private server: http.Server | null = null;
  private metricsCollector: MetricsCollector;
  private port: number;

  constructor(metricsCollector: MetricsCollector, port: number = 3001) {
    this.metricsCollector = metricsCollector;
    this.port = port;
  }

  start(): void {
    this.server = http.createServer((req, res) => {
      // CORS headers for web dashboards
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      const url = req.url || '';
      
      try {
        switch (url) {
          case '/health':
            this.handleHealth(res);
            break;
          case '/metrics':
            this.handleMetrics(res);
            break;
          case '/metrics/prometheus':
            this.handlePrometheusMetrics(res);
            break;
          case '/metrics/summary':
            this.handleSummary(res);
            break;
          case '/metrics/detailed':
            this.handleDetailed(res);
            break;
          case '/metrics/recent':
            this.handleRecent(res);
            break;
          default:
            this.handle404(res);
        }
      } catch (error) {
        logger.error('Error handling metrics request:', error);
        this.handleError(res, error);
      }
    });

    this.server.listen(this.port, () => {
      logger.info(`Metrics server listening on port ${this.port}`);
      logger.info('Available endpoints:');
      logger.info(`  - http://localhost:${this.port}/health - Health check`);
      logger.info(`  - http://localhost:${this.port}/metrics - Basic metrics`);
      logger.info(`  - http://localhost:${this.port}/metrics/prometheus - Prometheus format`);
      logger.info(`  - http://localhost:${this.port}/metrics/summary - Summary statistics`);
      logger.info(`  - http://localhost:${this.port}/metrics/detailed - Detailed breakdown`);
      logger.info(`  - http://localhost:${this.port}/metrics/recent - Recent activity`);
    });

    this.server.on('error', (error) => {
      logger.error('Metrics server error:', error);
    });
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
      logger.info('Metrics server stopped');
    }
  }

  private handleHealth(res: http.ServerResponse): void {
    const health = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      version: require('../../package.json').version
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(health, null, 2));
  }

  private handleMetrics(res: http.ServerResponse): void {
    const summary = this.metricsCollector.getSummary();
    const recent = this.metricsCollector.getRecentActivity();

    const metrics = {
      timestamp: new Date().toISOString(),
      summary,
      recent,
      endpoints: {
        detailed: '/metrics/detailed',
        prometheus: '/metrics/prometheus',
        recent: '/metrics/recent'
      }
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(metrics, null, 2));
  }

  private handlePrometheusMetrics(res: http.ServerResponse): void {
    const prometheusMetrics = this.metricsCollector.exportPrometheusMetrics();
    
    res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
    res.end(prometheusMetrics);
  }

  private handleSummary(res: http.ServerResponse): void {
    const summary = this.metricsCollector.getSummary();
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      timestamp: new Date().toISOString(),
      ...summary
    }, null, 2));
  }

  private handleDetailed(res: http.ServerResponse): void {
    const detailed = this.metricsCollector.getDetailedMetrics();
    
    // Convert Sets and Maps to arrays for JSON serialization
    const serializable = {
      ...detailed,
      uniqueDiscordUsers: Array.from(detailed.uniqueDiscordUsers),
      uniqueIRCUsers: Array.from(detailed.uniqueIRCUsers),
      channelActivity: Object.fromEntries(detailed.channelActivity),
      userActivity: Object.fromEntries(detailed.userActivity),
      timestamp: new Date().toISOString()
    };
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(serializable, null, 2));
  }

  private handleRecent(res: http.ServerResponse): void {
    const recent = this.metricsCollector.getRecentActivity();
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      timestamp: new Date().toISOString(),
      ...recent
    }, null, 2));
  }

  private handle404(res: http.ServerResponse): void {
    const notFound = {
      error: 'Not Found',
      message: 'Endpoint not found',
      availableEndpoints: [
        '/health',
        '/metrics',
        '/metrics/prometheus',
        '/metrics/summary',
        '/metrics/detailed',
        '/metrics/recent'
      ]
    };

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(notFound, null, 2));
  }

  private handleError(res: http.ServerResponse, error: any): void {
    const errorResponse = {
      error: 'Internal Server Error',
      message: 'An error occurred while processing the request',
      timestamp: new Date().toISOString()
    };

    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(errorResponse, null, 2));
  }
}