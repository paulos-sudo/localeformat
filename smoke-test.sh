#!/usr/bin/env bash
set -u
cd "$(dirname "$0")/.."
node scripts/mock-facilitator.mjs > /tmp/lf-mock.log 2>&1 &
MOCK_PID=$!
sleep 1.5
FACILITATOR_URL=http://localhost:4090 node src/server.js > /tmp/lf-server.log 2>&1 &
SRV_PID=$!
sleep 2.5
echo "### boot"; head -2 /tmp/lf-server.log
echo; echo "### 1) /health (free)"; curl -s -w "\nHTTP %{http_code}\n" localhost:4022/health
echo; echo "### 2) /v1/locales (free, count)"; curl -s localhost:4022/v1/locales | head -c 120; echo
echo; echo "### 3) /openapi.json valid?"; curl -s localhost:4022/openapi.json | python3 -c "import json,sys; d=json.load(sys.stdin); print('paths:', len(d['paths']), '| x-guidance:', bool(d['info'].get('x-guidance')), '| payment-info verify:', bool(d['paths']['/v1/verify']['get'].get('x-payment-info')))"
echo; echo "### 4) unpaid /v1/currency → 402"; curl -s -o /dev/null -w "HTTP %{http_code}\n" "localhost:4022/v1/currency?amount=1234.56&currency=EUR&locale=de-DE"
echo; echo "### 5) full x402 flow (mock)"; node scripts/mock-client.mjs "http://localhost:4022/v1/verify?type=currency&formatted=%E2%82%AC1,234.56&amount=1234.56&currency=EUR&locale=de-DE"
kill $SRV_PID $MOCK_PID 2>/dev/null; wait 2>/dev/null
echo; echo "smoke done"
