#!/bin/bash
TOKEN="3bb7f7fd36b218c1f88aba647ed9ad96"
URI="http://localhost:3300"

echo "=== Pre-exec ==="
curl -s -H "Authorization: Bearer $TOKEN" -X POST "$URI/pipeline/pre" \
  -H 'Content-Type: application/json' \
  -d '{"toolName":"write_file","parameters":{"path":"demo.ts","content":"export const x=1"}}' | python3 -m json.tool 2>/dev/null || curl -s -H "Authorization: Bearer $TOKEN" -X POST "$URI/pipeline/pre" -H 'Content-Type: application/json' -d '{"toolName":"write_file","parameters":{"path":"demo.ts","content":"export const x=1"}}'

echo ""
echo "=== Post-exec ==="
SNAP='{"id":"snap_test","scope":"file","fileHashes":{"demo.ts":"abc"}}'
curl -s -H "Authorization: Bearer $TOKEN" -X POST "$URI/pipeline/post" \
  -H 'Content-Type: application/json' \
  -d "{\"toolName\":\"write_file\",\"toolParameters\":{\"path\":\"demo.ts\"},\"toolResult\":\"ok\",\"snapshot\":$SNAP,\"startTime\":$(date +%s%3N),\"endTime\":$(date +%s%3N),\"retryCount\":0,\"wasSelfCorrected\":false,\"hadTimeout\":false,\"userAccepted\":true,\"userProvidedEdit\":false,\"resultWasUsed\":true}"

echo ""
echo "=== Report ==="
curl -s -H "Authorization: Bearer $TOKEN" "$URI/pipeline/report"

echo ""
echo "=== Audit ==="
curl -s -H "Authorization: Bearer $TOKEN" "$URI/audit?limit=3" | python3 -m json.tool 2>/dev/null || curl -s -H "Authorization: Bearer $TOKEN" "$URI/audit?limit=3"
