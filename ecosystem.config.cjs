/**
 * Sentinel AgentOS PM2 Ecosystem Configuration
 *
 * Usage:
 *   export SENTINEL_TOKEN="your-secret-token"
 *   pm2 start ecosystem.config.cjs
 *   pm2 save
 *   pm2 startup
 */
module.exports = {
  apps: [
    {
      name: 'sentinel-agentos',
      script: './dist/server.js',
      args: '--port 3300',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        SENTINEL_PORT: '3300',
        SENTINEL_TOKEN: process.env.SENTINEL_TOKEN || '',
        SENTINEL_HOST: '0.0.0.0',
      },
      // Restart if memory > 200MB or crashes
      max_memory_restart: '200M',
      // Logging
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/sentinel-error.log',
      out_file: './logs/sentinel-out.log',
      merge_logs: true,
      // Auto-restart on crash
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      // Health check
      wait_ready: false,
      kill_timeout: 5000,
    },
  ],
};
