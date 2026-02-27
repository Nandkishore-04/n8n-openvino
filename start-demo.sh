#!/bin/bash
# Start the n8n + OpenVINO demo stack
# Usage: ./start-demo.sh

set -e

echo ""
echo "  n8n + OpenVINO Model Server Demo"
echo "  ================================"
echo ""

# Check Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "  ERROR: Docker is not running. Please start Docker Desktop first."
    exit 1
fi

# Build and start
echo "  Starting services..."
cd deployment
docker compose up -d --build

echo ""
echo "  Waiting for services to be ready..."
sleep 10

# Health checks
echo ""
echo "  Service Status:"
echo "  ---------------"

if curl -s http://localhost:9001/health > /dev/null 2>&1; then
    echo "  [OK] Mock OVMS Server  -> http://localhost:9001"
else
    echo "  [!!] Mock OVMS Server  -> NOT READY (may need more time)"
fi

if curl -s http://localhost:5678/healthz > /dev/null 2>&1; then
    echo "  [OK] n8n Workflow UI   -> http://localhost:5678"
else
    echo "  [!!] n8n Workflow UI   -> NOT READY (may need more time)"
fi

echo ""
echo "  Next Steps:"
echo "  1. Open http://localhost:5678 in your browser"
echo "  2. Create owner account (first time only)"
echo "  3. Add OVMS credential: Server URL = http://ovms:9001"
echo "  4. Import workflow from: workflows/document-pipeline.json"
echo "  5. Click 'Test Workflow' to run the pipeline"
echo ""
