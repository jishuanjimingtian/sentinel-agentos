#!/bin/bash
set -e
cd /opt/sentinel-agentos

# Generate API token
TOKEN=$(openssl rand -hex 16)
echo "========================================"
echo "Token: $TOKEN"
echo "========================================"

# Create directories
mkdir -p logs

# Create .env file
cat > .env <<EOENV
SENTINEL_TOKEN=$TOKEN
EOENV

# Start with pm2
SENTINEL_TOKEN=$TOKEN pm2 start ecosystem.config.cjs
pm2 save

echo ""
echo "=== Starting health check ==="
sleep 2
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3300/health
echo ""
echo "=== Status report ==="
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3300/pipeline/report
echo ""
echo ""
echo "=== Sentinel AgentOS deployed! ==="
echo "Health:   curl -H 'Authorization: Bearer $TOKEN' http://localhost:3300/health"
echo "Status:   curl -H 'Authorization: Bearer $TOKEN' http://localhost:3300/pipeline/report"
echo "Save this token: $TOKEN"
