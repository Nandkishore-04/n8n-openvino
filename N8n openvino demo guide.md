# n8n + OpenVINO Model Server — Smart Document Processing Pipeline
### A GSoC 2026 Proof of Concept by Nandkishore

> **Purpose of this document:** This is a step-by-step guide to build a working demo that integrates n8n (no-code workflow automation) with OpenVINO Model Server (OVMS) to create an AI-powered Smart Document Processing Pipeline running locally on Intel hardware (CPU/GPU/NPU).

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture](#2-architecture)
3. [Prerequisites & Tools](#3-prerequisites--tools)
4. [Environment Setup](#4-environment-setup)
5. [OpenVINO Model Server Setup](#5-openvino-model-server-setup)
6. [Model Preparation](#6-model-preparation)
7. [Custom n8n Node Development](#7-custom-n8n-node-development)
8. [Podman Compose Deployment](#8-podman-compose-deployment)
9. [Building the Smart Document Pipeline](#9-building-the-smart-document-pipeline)
10. [Testing the Pipeline](#10-testing-the-pipeline)
11. [AUTO Plugin & Device Switching](#11-auto-plugin--device-switching)
12. [Additional Workflow Templates](#12-additional-workflow-templates)
13. [Project Structure](#13-project-structure)
14. [Open Questions for Mentors](#14-open-questions-for-mentors)

---

## 1. Project Overview

### What We're Building

A production-ready integration between:

- **n8n** — visual workflow automation platform (open source, self-hosted)
- **OpenVINO Model Server (OVMS)** — Intel's high-performance AI model serving solution

The primary demo is a **Smart Document Processing Pipeline** that:

1. Watches a local folder for incoming documents (PDFs, images, scanned forms)
2. Extracts text and tables using a document understanding model on **NPU** (power efficient)
3. Classifies and extracts entities using an **LLM on GPU** (high performance)
4. Stores results locally and sends notifications
5. Uses OpenVINO **AUTO plugin** for intelligent device switching

### Why This Matters

- **No cloud dependency** — everything runs locally on Intel AI PCs
- **Privacy preserving** — documents never leave your machine
- **Hardware optimized** — intelligently uses NPU/GPU/CPU based on availability
- **Accessible** — non-developers can build AI pipelines visually in n8n

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        n8n Canvas (Visual)                      │
│                                                                 │
│  [Folder Watch] → [File Router] → [OVMS Node] → [OVMS Node]   │
│                                      (NPU)         (GPU)        │
│                                        ↓              ↓         │
│                                   [Storage]    [Notification]   │
└─────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────┐
│                  OpenVINO Model Server (OVMS)                   │
│                                                                 │
│   Model 1: Document Understanding (NPU) ← text/table extract   │
│   Model 2: LLM Classifier (GPU)         ← classify + entities  │
│                                                                 │
│              AUTO Plugin manages device routing                 │
└─────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────┐
│                      Intel Hardware Layer                       │
│                                                                 │
│         NPU (Efficient)    GPU (Performant)    CPU (Fallback)  │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
PDF/Image arrives in /incoming folder
        ↓
n8n Folder Watcher detects new file
        ↓
File type routed (PDF vs Image vs Scanned)
        ↓
OVMS Node → Document Understanding Model (NPU)
        ↓ returns: raw extracted text + tables
OVMS Node → LLM Classifier (GPU)
        ↓ returns: { type, date, amount, sender, summary }
        ↓
PostgreSQL storage + Email/Webhook notification
```

---

## 3. Prerequisites & Tools

### Hardware Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| CPU | Intel Core i5 (8th gen+) | Intel Core Ultra (AI PC) |
| RAM | 8GB | 16GB+ |
| Storage | 20GB free | 50GB free |
| GPU | Intel integrated | Intel Arc / Core Ultra GPU |
| NPU | Optional | Intel Core Ultra NPU |

> **Note:** The pipeline runs on CPU-only machines too. NPU/GPU just make it faster and more efficient. AUTO plugin handles fallback automatically.

### Software Requirements

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 18+ LTS | n8n runtime + custom node development |
| npm | 9+ | Package management |
| Python | 3.10+ | Model preparation, OVMS scripts |
| Podman | 4.0+ | Container runtime (Docker alternative) |
| podman-compose | 1.0+ | Multi-container orchestration |
| Git | Any | Version control |
| n8n | Latest | Workflow automation |

### Recommended IDE

- **VS Code** with extensions:
  - ESLint
  - Prettier
  - Docker (works with Podman too)
  - REST Client (for testing OVMS endpoints)

---

## 4. Environment Setup

### 4.1 Install Node.js

```bash
# Using nvm (recommended)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc
nvm install 18
nvm use 18
node --version   # should print v18.x.x
npm --version    # should print 9.x.x
```

### 4.2 Install Python

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install python3.10 python3.10-venv python3-pip -y
python3 --version   # should print 3.10.x

# Create a virtual environment for this project
python3 -m venv ~/ovms-env
source ~/ovms-env/bin/activate
```

### 4.3 Install Podman

```bash
# Ubuntu/Debian
sudo apt install podman -y
podman --version   # should print 4.x.x

# Install podman-compose
pip install podman-compose

# Test Podman works
podman run hello-world
```

### 4.4 Install n8n Globally

```bash
npm install -g n8n
n8n --version   # verify installation

# Start n8n (for testing later)
n8n start
# Open http://localhost:5678 in browser
```

### 4.5 Clone / Initialize Project Repository

```bash
mkdir n8n-openvino
cd n8n-openvino
git init

# Create base folder structure
mkdir -p nodes/OpenVinoModelServer
mkdir -p credentials
mkdir -p deployment/models
mkdir -p workflows
mkdir -p docs
mkdir -p test
```

---

## 5. OpenVINO Model Server Setup

### 5.1 Pull OVMS Container Image

```bash
# Pull the latest OVMS image
podman pull openvino/model_server:latest

# Verify it works
podman run --rm openvino/model_server:latest --help
```

### 5.2 Understand OVMS Configuration

OVMS uses a JSON config file to know which models to serve:

```json
// deployment/config.json
{
  "model_config_list": [
    {
      "config": {
        "name": "document-understanding",
        "base_path": "/models/document-understanding",
        "target_device": "NPU",
        "batch_size": "1",
        "plugin_config": {
          "NUM_STREAMS": "1"
        }
      }
    },
    {
      "config": {
        "name": "llm-classifier",
        "base_path": "/models/llm-classifier",
        "target_device": "GPU",
        "batch_size": "auto"
      }
    }
  ]
}
```

> **AUTO Plugin:** Replace `"NPU"` or `"GPU"` with `"AUTO"` to let OpenVINO decide the best device at runtime. More on this in Section 11.

### 5.3 Run OVMS Manually (Testing)

```bash
# Run OVMS with CPU only first (no GPU/NPU needed for initial test)
podman run -d \
  --name ovms-test \
  -p 9000:9000 \
  -p 9001:9001 \
  -v ./deployment/models:/models \
  -v ./deployment/config.json:/config.json \
  openvino/model_server:latest \
  --config_path /config.json \
  --port 9000 \
  --rest_port 9001

# Check it's running
podman logs ovms-test

# Test the REST endpoint
curl http://localhost:9001/v1/config
```

### 5.4 OVMS API Endpoints You'll Use

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/v1/config` | GET | List loaded models and their status |
| `/v1/models/{model_name}` | GET | Get model metadata |
| `/v1/models/{model_name}:predict` | POST | Run inference |
| `/v2/models/{model_name}/infer` | POST | KServe v2 inference (preferred) |

---

## 6. Model Preparation

### 6.1 Install OpenVINO & Optimum

```bash
source ~/ovms-env/bin/activate

# Install OpenVINO
pip install openvino openvino-genai

# Install Optimum Intel for model export
pip install optimum[openvino] transformers
```

### 6.2 Document Understanding Model (for NPU)

We'll use **PaddleOCR** or **TrOCR** for document text extraction, converted to OpenVINO IR format.

```bash
# Option A: Use a pre-converted model from OpenVINO Model Zoo
# Download a document understanding model
pip install huggingface_hub
python3 << 'EOF'
from huggingface_hub import snapshot_download

# Download a lightweight OCR/document model
snapshot_download(
    repo_id="microsoft/trocr-small-printed",
    local_dir="./deployment/models/document-understanding-raw"
)
EOF

# Convert to OpenVINO IR format
optimum-cli export openvino \
  --model microsoft/trocr-small-printed \
  --task image-to-text \
  ./deployment/models/document-understanding

# Verify conversion
ls ./deployment/models/document-understanding/
# Should see: openvino_model.xml, openvino_model.bin
```

### 6.3 LLM Classifier Model (for GPU)

```bash
# Use a small but capable LLM for classification
# TinyLlama is a good balance of speed and capability
optimum-cli export openvino \
  --model TinyLlama/TinyLlama-1.1B-Chat-v1.0 \
  --weight-format int4 \
  --trust-remote-code \
  ./deployment/models/llm-classifier

# int4 quantization makes it faster and uses less memory
```

### 6.4 Model Directory Structure

After preparation, your models directory should look like:

```
deployment/
└── models/
    ├── document-understanding/
    │   ├── openvino_model.xml
    │   ├── openvino_model.bin
    │   └── tokenizer/
    └── llm-classifier/
        ├── openvino_model.xml
        ├── openvino_model.bin
        └── tokenizer/
```

---

## 7. Custom n8n Node Development

### 7.1 Initialize the Node Package

```bash
cd n8n-openvino

# Initialize npm package
npm init -y

# Install n8n node development dependencies
npm install --save-dev \
  typescript \
  @types/node \
  n8n-workflow \
  n8n-core \
  @typescript-eslint/parser \
  eslint

# Install runtime dependencies
npm install axios node-fetch
```

### 7.2 TypeScript Configuration

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2019",
    "module": "commonjs",
    "lib": ["ES2019"],
    "outDir": "./dist",
    "rootDir": "./",
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["nodes/**/*", "credentials/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### 7.3 Package.json Configuration

```json
// package.json
{
  "name": "n8n-nodes-openvino",
  "version": "0.1.0",
  "description": "n8n custom node for OpenVINO Model Server integration",
  "keywords": ["n8n-community-node-package", "openvino", "ai", "intel"],
  "license": "Apache-2.0",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "lint": "eslint nodes --ext .ts",
    "prepublishOnly": "npm run build"
  },
  "n8n": {
    "n8nNodesApiVersion": 1,
    "credentials": [
      "dist/credentials/OpenVinoModelServerApi.credentials.js"
    ],
    "nodes": [
      "dist/nodes/OpenVinoModelServer/OpenVinoModelServer.node.js"
    ]
  }
}
```

### 7.4 Credentials File

```typescript
// credentials/OpenVinoModelServerApi.credentials.ts
import {
  IAuthenticateGeneric,
  ICredentialType,
  INodeProperties,
} from 'n8n-workflow';

export class OpenVinoModelServerApi implements ICredentialType {
  name = 'openVinoModelServerApi';
  displayName = 'OpenVINO Model Server API';
  documentationUrl = 'https://github.com/openvinotoolkit/model_server';

  properties: INodeProperties[] = [
    {
      displayName: 'Server URL',
      name: 'serverUrl',
      type: 'string',
      default: 'http://localhost:9001',
      placeholder: 'http://localhost:9001',
      description: 'Base URL of the OpenVINO Model Server REST API',
    },
    {
      displayName: 'gRPC Host',
      name: 'grpcHost',
      type: 'string',
      default: 'localhost',
      description: 'Host for gRPC connection to OVMS',
    },
    {
      displayName: 'gRPC Port',
      name: 'grpcPort',
      type: 'number',
      default: 9000,
      description: 'Port for gRPC connection to OVMS',
    },
  ];

  authenticate: IAuthenticateGeneric = {
    type: 'generic',
    properties: {},
  };
}
```

### 7.5 Main Node File

```typescript
// nodes/OpenVinoModelServer/OpenVinoModelServer.node.ts
import {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  NodeOperationError,
} from 'n8n-workflow';

export class OpenVinoModelServer implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'OpenVINO Model Server',
    name: 'openVinoModelServer',
    icon: 'file:openvino.svg',
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["operation"]}} - {{$parameter["modelName"]}}',
    description: 'Run AI inference via OpenVINO Model Server with GPU/NPU acceleration',
    defaults: {
      name: 'OpenVINO Model Server',
    },
    inputs: ['main'],
    outputs: ['main'],
    credentials: [
      {
        name: 'openVinoModelServerApi',
        required: true,
      },
    ],
    properties: [
      // Operation selection
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        options: [
          {
            name: 'Predict',
            value: 'predict',
            description: 'Run inference on a model',
            action: 'Run inference on a model',
          },
          {
            name: 'Get Model Status',
            value: 'status',
            description: 'Check if a model is loaded and ready',
            action: 'Check model status',
          },
          {
            name: 'List Models',
            value: 'list',
            description: 'List all loaded models',
            action: 'List all loaded models',
          },
        ],
        default: 'predict',
      },

      // Model name
      {
        displayName: 'Model Name',
        name: 'modelName',
        type: 'string',
        default: '',
        required: true,
        displayOptions: {
          show: {
            operation: ['predict', 'status'],
          },
        },
        description: 'Name of the model as configured in OVMS',
        placeholder: 'document-understanding',
      },

      // Device selection
      {
        displayName: 'Target Device',
        name: 'device',
        type: 'options',
        options: [
          {
            name: 'AUTO (Recommended)',
            value: 'AUTO',
            description: 'OpenVINO AUTO plugin selects best device dynamically',
          },
          {
            name: 'NPU',
            value: 'NPU',
            description: 'Neural Processing Unit — best for efficient inference',
          },
          {
            name: 'GPU',
            value: 'GPU',
            description: 'Graphics Processing Unit — best for heavy models',
          },
          {
            name: 'CPU',
            value: 'CPU',
            description: 'Central Processing Unit — universal fallback',
          },
        ],
        default: 'AUTO',
        displayOptions: {
          show: {
            operation: ['predict'],
          },
        },
        description: 'Hardware device to run inference on',
      },

      // Input data
      {
        displayName: 'Input Data',
        name: 'inputData',
        type: 'json',
        default: '{}',
        displayOptions: {
          show: {
            operation: ['predict'],
          },
        },
        description: 'JSON input data to send to the model',
      },

      // API Version
      {
        displayName: 'API Version',
        name: 'apiVersion',
        type: 'options',
        options: [
          { name: 'KServe v2 (Recommended)', value: 'v2' },
          { name: 'TensorFlow Serving v1', value: 'v1' },
        ],
        default: 'v2',
        displayOptions: {
          show: {
            operation: ['predict'],
          },
        },
      },

      // Advanced options
      {
        displayName: 'Additional Options',
        name: 'additionalOptions',
        type: 'collection',
        placeholder: 'Add Option',
        default: {},
        options: [
          {
            displayName: 'Timeout (ms)',
            name: 'timeout',
            type: 'number',
            default: 30000,
            description: 'Request timeout in milliseconds',
          },
          {
            displayName: 'Model Version',
            name: 'modelVersion',
            type: 'number',
            default: 0,
            description: 'Specific model version (0 = latest)',
          },
        ],
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const operation = this.getNodeParameter('operation', 0) as string;
    const credentials = await this.getCredentials('openVinoModelServerApi');
    const serverUrl = credentials.serverUrl as string;

    const results: INodeExecutionData[] = [];

    for (let i = 0; i < items.length; i++) {
      try {
        let responseData: any;

        if (operation === 'list') {
          // List all models
          responseData = await this.helpers.request({
            method: 'GET',
            url: `${serverUrl}/v1/config`,
            json: true,
          });

        } else if (operation === 'status') {
          // Get model status
          const modelName = this.getNodeParameter('modelName', i) as string;
          responseData = await this.helpers.request({
            method: 'GET',
            url: `${serverUrl}/v1/models/${modelName}`,
            json: true,
          });

        } else if (operation === 'predict') {
          // Run inference
          const modelName = this.getNodeParameter('modelName', i) as string;
          const device = this.getNodeParameter('device', i) as string;
          const apiVersion = this.getNodeParameter('apiVersion', i) as string;
          const inputData = this.getNodeParameter('inputData', i) as object;
          const additionalOptions = this.getNodeParameter('additionalOptions', i) as any;
          const timeout = additionalOptions.timeout || 30000;
          const modelVersion = additionalOptions.modelVersion || 0;

          // Build endpoint URL based on API version
          let endpoint: string;
          let requestBody: object;

          if (apiVersion === 'v2') {
            // KServe v2 format
            endpoint = modelVersion > 0
              ? `${serverUrl}/v2/models/${modelName}/versions/${modelVersion}/infer`
              : `${serverUrl}/v2/models/${modelName}/infer`;

            requestBody = {
              inputs: [
                {
                  name: 'input',
                  shape: [1],
                  datatype: 'BYTES',
                  data: [JSON.stringify(inputData)],
                }
              ]
            };
          } else {
            // TensorFlow Serving v1 format
            endpoint = `${serverUrl}/v1/models/${modelName}:predict`;
            requestBody = {
              instances: [inputData],
            };
          }

          responseData = await this.helpers.request({
            method: 'POST',
            url: endpoint,
            headers: {
              'Content-Type': 'application/json',
              // Pass device hint as header — OVMS can use this
              'X-Target-Device': device,
            },
            body: JSON.stringify(requestBody),
            timeout,
            json: true,
          });

          // Attach metadata to response
          responseData = {
            ...responseData,
            _meta: {
              model: modelName,
              device,
              timestamp: new Date().toISOString(),
            },
          };
        }

        results.push({ json: responseData });

      } catch (error: any) {
        if (this.continueOnFail()) {
          results.push({
            json: {
              error: error.message,
              statusCode: error.statusCode,
            },
          });
          continue;
        }
        throw new NodeOperationError(this.getNode(), error, { itemIndex: i });
      }
    }

    return [results];
  }
}
```

### 7.6 Build the Node

```bash
# Compile TypeScript to JavaScript
npm run build

# Link the node to n8n locally for testing
npm link
cd ~/.n8n
mkdir -p custom
cd custom
npm link n8n-nodes-openvino

# Restart n8n to pick up the new node
n8n start
```

After restarting n8n, open `http://localhost:5678` and search for "OpenVINO" in the node panel — your custom node should appear.

---

## 8. Podman Compose Deployment

### 8.1 Full podman-compose.yml

```yaml
# deployment/podman-compose.yml
version: '3.8'

services:

  # ─── OpenVINO Model Server ───────────────────────────────────────
  ovms:
    image: openvino/model_server:latest
    container_name: ovms
    restart: unless-stopped
    ports:
      - "9000:9000"   # gRPC
      - "9001:9001"   # REST
    volumes:
      - ./models:/models:ro
      - ./config.json:/config.json:ro
    command: >
      --config_path /config.json
      --port 9000
      --rest_port 9001
      --log_level INFO
    # GPU passthrough (uncomment if GPU available)
    # devices:
    #   - /dev/dri:/dev/dri
    # group_add:
    #   - video
    #   - render
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9001/v1/config"]
      interval: 30s
      timeout: 10s
      retries: 3

  # ─── n8n Workflow Engine ─────────────────────────────────────────
  n8n:
    image: n8nio/n8n:latest
    container_name: n8n
    restart: unless-stopped
    ports:
      - "5678:5678"
    environment:
      - N8N_BASIC_AUTH_ACTIVE=true
      - N8N_BASIC_AUTH_USER=admin
      - N8N_BASIC_AUTH_PASSWORD=admin123
      - WEBHOOK_URL=http://localhost:5678/
      - N8N_CUSTOM_EXTENSIONS=/home/node/.n8n/custom
      - DB_TYPE=postgresdb
      - DB_POSTGRESDB_HOST=postgres
      - DB_POSTGRESDB_PORT=5432
      - DB_POSTGRESDB_DATABASE=n8n
      - DB_POSTGRESDB_USER=n8n
      - DB_POSTGRESDB_PASSWORD=n8npassword
      - OVMS_URL=http://ovms:9001
    volumes:
      - n8n_data:/home/node/.n8n
      - ./custom-nodes:/home/node/.n8n/custom
      - ./incoming:/data/incoming      # folder watcher source
      - ./processed:/data/processed    # processed documents
    depends_on:
      postgres:
        condition: service_healthy
      ovms:
        condition: service_healthy

  # ─── PostgreSQL Database ─────────────────────────────────────────
  postgres:
    image: postgres:15-alpine
    container_name: postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: n8n
      POSTGRES_USER: n8n
      POSTGRES_PASSWORD: n8npassword
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./sql/init.sql:/docker-entrypoint-initdb.d/init.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U n8n"]
      interval: 10s
      timeout: 5s
      retries: 5

  # ─── Redis (for n8n queue mode) ──────────────────────────────────
  redis:
    image: redis:7-alpine
    container_name: redis
    restart: unless-stopped
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 3

volumes:
  n8n_data:
  postgres_data:
  redis_data:
```

### 8.2 Database Initialization Script

```sql
-- deployment/sql/init.sql

-- Table to store processed document results
CREATE TABLE IF NOT EXISTS processed_documents (
    id SERIAL PRIMARY KEY,
    filename VARCHAR(255) NOT NULL,
    file_type VARCHAR(50),
    document_type VARCHAR(100),
    extracted_text TEXT,
    entities JSONB,
    processing_device VARCHAR(50),
    processing_time_ms INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Table to track pipeline executions
CREATE TABLE IF NOT EXISTS pipeline_executions (
    id SERIAL PRIMARY KEY,
    workflow_id VARCHAR(255),
    status VARCHAR(50),
    input_file VARCHAR(255),
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    error_message TEXT
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_documents_filename ON processed_documents(filename);
CREATE INDEX IF NOT EXISTS idx_documents_type ON processed_documents(document_type);
CREATE INDEX IF NOT EXISTS idx_documents_created ON processed_documents(created_at);
```

### 8.3 Start the Full Stack

```bash
cd deployment

# Create required folders
mkdir -p incoming processed models custom-nodes sql

# Start all services
podman-compose up -d

# Watch logs
podman-compose logs -f

# Check all services are healthy
podman-compose ps
```

Open `http://localhost:5678` — n8n should be running and ready.

---

## 9. Building the Smart Document Pipeline

This is the core demo. We'll build it step by step.

### 9.1 Pipeline Overview

```
[Local Folder Watch]
        ↓
[File Type Switch]
   ├── PDF  → [PDF Text Extractor]
   ├── Image → [Image Preprocessor]
   └── Other → [Error Handler]
        ↓
[OVMS Node: Document Understanding on NPU]
   inputs:  preprocessed document
   outputs: raw extracted text, table data
        ↓
[OVMS Node: LLM Classifier on GPU]
   inputs:  extracted text
   prompt:  "Classify this document. Extract: type, date, amount, sender, summary"
   outputs: { type, date, amount, sender, summary }
        ↓
[Data Formatter]
        ↓
[PostgreSQL: Save result]
        ↓
[Email/Webhook Notification]
```

### 9.2 Node-by-Node Workflow JSON

Save this as `workflows/document-pipeline.json` and import into n8n:

```json
{
  "name": "Smart Document Processing Pipeline",
  "nodes": [
    {
      "parameters": {
        "path": "/data/incoming",
        "events": ["add"],
        "options": {
          "usePolling": true,
          "pollingInterval": 5000
        }
      },
      "name": "Watch Incoming Folder",
      "type": "n8n-nodes-base.localFileTrigger",
      "position": [100, 300]
    },
    {
      "parameters": {
        "dataPropertyName": "data",
        "options": {}
      },
      "name": "Read File",
      "type": "n8n-nodes-base.readBinaryFile",
      "position": [300, 300]
    },
    {
      "parameters": {
        "mode": "rules",
        "rules": {
          "rules": [
            {
              "value2": "pdf",
              "operation": "contains",
              "value1": "={{ $json.fileName.toLowerCase() }}"
            },
            {
              "value2": "jpg,jpeg,png,tiff,bmp",
              "operation": "contains",
              "value1": "={{ $json.fileName.split('.').pop().toLowerCase() }}"
            }
          ]
        }
      },
      "name": "Route by File Type",
      "type": "n8n-nodes-base.switch",
      "position": [500, 300]
    },
    {
      "parameters": {
        "operation": "predict",
        "modelName": "document-understanding",
        "device": "NPU",
        "apiVersion": "v2",
        "inputData": "={{ { image_data: $binary.data.toString('base64'), file_name: $json.fileName } }}"
      },
      "name": "Extract Text (NPU)",
      "type": "n8n-nodes-openvino.openVinoModelServer",
      "position": [750, 300],
      "credentials": {
        "openVinoModelServerApi": {
          "id": "1",
          "name": "OVMS Local"
        }
      }
    },
    {
      "parameters": {
        "operation": "predict",
        "modelName": "llm-classifier",
        "device": "GPU",
        "apiVersion": "v2",
        "inputData": "={{ { prompt: 'Analyze this document and return JSON with fields: document_type, date, amount, sender, summary. Document text: ' + $json.outputs[0].data[0] } }}"
      },
      "name": "Classify & Extract (GPU)",
      "type": "n8n-nodes-openvino.openVinoModelServer",
      "position": [1000, 300],
      "credentials": {
        "openVinoModelServerApi": {
          "id": "1",
          "name": "OVMS Local"
        }
      }
    },
    {
      "parameters": {
        "operation": "insert",
        "table": "processed_documents",
        "columns": "filename,file_type,document_type,extracted_text,entities,processing_device",
        "additionalFields": {}
      },
      "name": "Save to Database",
      "type": "n8n-nodes-base.postgres",
      "position": [1250, 300]
    },
    {
      "parameters": {
        "subject": "Document Processed: {{ $json.document_type }}",
        "message": "File {{ $json.filename }} has been processed.\n\nType: {{ $json.document_type }}\nDate: {{ $json.date }}\nSummary: {{ $json.summary }}",
        "options": {}
      },
      "name": "Send Notification",
      "type": "n8n-nodes-base.emailSend",
      "position": [1500, 300]
    }
  ],
  "connections": {
    "Watch Incoming Folder": { "main": [[{ "node": "Read File", "type": "main", "index": 0 }]] },
    "Read File": { "main": [[{ "node": "Route by File Type", "type": "main", "index": 0 }]] },
    "Route by File Type": { "main": [[{ "node": "Extract Text (NPU)", "type": "main", "index": 0 }]] },
    "Extract Text (NPU)": { "main": [[{ "node": "Classify & Extract (GPU)", "type": "main", "index": 0 }]] },
    "Classify & Extract (GPU)": { "main": [[{ "node": "Save to Database", "type": "main", "index": 0 }]] },
    "Save to Database": { "main": [[{ "node": "Send Notification", "type": "main", "index": 0 }]] }
  }
}
```

### 9.3 Import and Activate the Workflow

1. Open n8n at `http://localhost:5678`
2. Click **"Add Workflow"** → **"Import from file"**
3. Select `workflows/document-pipeline.json`
4. Configure credentials (OVMS URL, email SMTP settings)
5. Click **"Activate"** toggle

### 9.4 Test the Pipeline

```bash
# Drop a test document into the incoming folder
cp /path/to/test-invoice.pdf ./incoming/

# Watch n8n execution logs
# Go to n8n UI → Executions tab

# Check database for results
podman exec -it postgres psql -U n8n -c "SELECT * FROM processed_documents;"
```

---

## 10. Testing the Pipeline

### 10.1 Test OVMS Endpoints Directly

```bash
# Check what models are loaded
curl http://localhost:9001/v1/config | python3 -m json.tool

# Check a specific model's status
curl http://localhost:9001/v1/models/document-understanding | python3 -m json.tool

# Test inference with a sample input
curl -X POST http://localhost:9001/v2/models/document-understanding/infer \
  -H "Content-Type: application/json" \
  -d '{
    "inputs": [{
      "name": "input",
      "shape": [1],
      "datatype": "BYTES",
      "data": ["sample text to process"]
    }]
  }' | python3 -m json.tool
```

### 10.2 Test the Custom n8n Node in Isolation

In n8n:
1. Create a new workflow
2. Add a **Manual Trigger** node
3. Add your **OpenVINO Model Server** node
4. Set operation to **"List Models"**
5. Click **"Execute Node"**

You should see all loaded OVMS models returned as JSON.

### 10.3 End-to-End Test Script

```python
# test/e2e_test.py
import requests
import json
import time
import shutil
import os

OVMS_URL = "http://localhost:9001"
N8N_URL = "http://localhost:5678"
INCOMING_DIR = "./incoming"

def test_ovms_health():
    """Check OVMS is running and models are loaded"""
    response = requests.get(f"{OVMS_URL}/v1/config")
    assert response.status_code == 200
    config = response.json()
    print("✅ OVMS is healthy")
    print(f"   Loaded models: {list(config.keys())}")
    return True

def test_document_pipeline():
    """Drop a file and verify it gets processed"""
    test_file = "test/sample-invoice.pdf"
    
    # Copy file to incoming directory
    shutil.copy(test_file, INCOMING_DIR)
    print(f"✅ Dropped {test_file} into incoming folder")
    
    # Wait for pipeline to process (max 60 seconds)
    print("⏳ Waiting for pipeline to process...")
    time.sleep(30)
    
    # Check database for result
    # (In a real test, query postgres here)
    print("✅ Pipeline test complete — check n8n Executions tab")

if __name__ == "__main__":
    test_ovms_health()
    test_document_pipeline()
```

```bash
# Run tests
source ~/ovms-env/bin/activate
python3 test/e2e_test.py
```

---

## 11. AUTO Plugin & Device Switching

### 11.1 What is the AUTO Plugin?

Instead of hardcoding a device, the AUTO plugin:
1. Queries which devices are available on the system
2. Benchmarks available models on each device
3. Routes inference to the best device dynamically
4. Switches devices if load changes or a device becomes unavailable

### 11.2 Configure AUTO in OVMS

```json
// deployment/config.json (AUTO version)
{
  "model_config_list": [
    {
      "config": {
        "name": "document-understanding",
        "base_path": "/models/document-understanding",
        "target_device": "AUTO:NPU,GPU,CPU",
        "plugin_config": {
          "PERFORMANCE_HINT": "LATENCY",
          "AUTO_DEVICE_LIST": "NPU,GPU,CPU"
        }
      }
    },
    {
      "config": {
        "name": "llm-classifier",
        "base_path": "/models/llm-classifier",
        "target_device": "AUTO:GPU,CPU",
        "plugin_config": {
          "PERFORMANCE_HINT": "THROUGHPUT"
        }
      }
    }
  ]
}
```

### 11.3 Device Priority Logic

```
AUTO:NPU,GPU,CPU means:
  1. Try NPU first (most efficient for this model)
  2. If NPU unavailable or busy → try GPU
  3. If GPU unavailable → fall back to CPU

PERFORMANCE_HINT options:
  - LATENCY     → minimize time per request (good for interactive use)
  - THROUGHPUT  → maximize requests per second (good for batch processing)
```

### 11.4 Expose Device Info in n8n Node Response

The node should return which device was actually used, so users can see it in the workflow:

```typescript
// Add to execute() response
responseData = {
  ...responseData,
  _meta: {
    model: modelName,
    requestedDevice: device,
    actualDevice: responseData.model_version_status?.[0]?.device || 'unknown',
    timestamp: new Date().toISOString(),
    latencyMs: Date.now() - startTime,
  },
};
```

---

## 12. Additional Workflow Templates

### Template 1: Conversational AI with RAG

**Use case:** A chatbot that answers questions from your local documents.

```
[Webhook: User Message]
        ↓
[OVMS Node: Text Embedding (CPU)]
   → converts question to vector embedding
        ↓
[Postgres: Vector Similarity Search]
   → finds most relevant document chunks
        ↓
[OVMS Node: LLM (GPU)]
   → generates answer using retrieved context
        ↓
[Webhook Response: Answer]
```

### Template 2: Multimodal Customer Service

**Use case:** Process customer photos + text complaints automatically.

```
[Webhook: Customer Submission]
   (contains image + text description)
        ↓
[OVMS Node: Image Classifier (NPU)]
   → identifies product/issue in image
        ↓
[OVMS Node: Sentiment Analysis (CPU)]
   → measures urgency/frustration level
        ↓
[Switch: Route by Priority]
   HIGH → immediate human escalation
   LOW  → auto-response + ticket creation
        ↓
[CRM Integration + Email]
```

### Template 3: Automated Content Generation

**Use case:** Generate product descriptions from product images.

```
[Webhook or Folder Watch: Product Image]
        ↓
[OVMS Node: Vision Language Model (GPU)]
   → generates draft description
        ↓
[OVMS Node: Grammar/Quality Check (CPU)]
   → refines and validates text
        ↓
[HTTP Request: Push to CMS/Database]
```

---

## 13. Project Structure

```
n8n-openvino/
│
├── nodes/
│   └── OpenVinoModelServer/
│       ├── OpenVinoModelServer.node.ts    ← main node logic
│       ├── OpenVinoModelServer.node.json  ← node metadata
│       └── openvino.svg                   ← node icon
│
├── credentials/
│   └── OpenVinoModelServerApi.credentials.ts
│
├── deployment/
│   ├── podman-compose.yml                 ← full stack deployment
│   ├── config.json                        ← OVMS model config
│   ├── models/                            ← converted OpenVINO models
│   │   ├── document-understanding/
│   │   └── llm-classifier/
│   ├── custom-nodes/                      ← compiled node (linked here)
│   ├── incoming/                          ← drop documents here
│   ├── processed/                         ← processed documents
│   └── sql/
│       └── init.sql                       ← DB schema
│
├── workflows/
│   ├── document-pipeline.json             ← main demo workflow
│   ├── rag-chatbot.json                   ← template 1
│   ├── customer-service.json              ← template 2
│   └── content-generation.json            ← template 3
│
├── test/
│   ├── e2e_test.py
│   ├── sample-invoice.pdf
│   └── sample-form.png
│
├── docs/
│   ├── getting-started.md
│   ├── node-reference.md
│   └── workflow-patterns.md
│
├── package.json
├── tsconfig.json
└── README.md
```

---

## 14. Open Questions for Mentors

*These are areas where I'd love mentor guidance before finalizing the implementation approach:*

### Architecture Questions

1. **REST vs gRPC for the n8n node:** gRPC offers better performance and streaming support, but REST is simpler to implement and debug. For the initial node, should I prioritize gRPC or REST? Or support both with a toggle?

2. **Device selection scope:** Should `target_device` be a per-node configuration (each OVMS node in a workflow specifies its own device) or a global workflow setting? A global setting is simpler for users but less flexible.

3. **Model version management:** OVMS supports multiple model versions. Should the node expose version selection, or always use the latest version by default?

### Technical Questions

4. **Document Understanding Model choice:** For the NPU-targeted document understanding task, which model do you recommend? I was considering TrOCR or PaddleOCR converted to OpenVINO IR format, but am open to suggestions on what works best on NPU.

5. **LLM serving via OVMS:** For LLM serving, should I use OVMS's built-in OpenAI-compatible endpoint (which OVMS supports for LLMs) or the standard v2 inference API? The OpenAI-compatible endpoint would make it easier to swap models but may have limitations.

6. **AUTO plugin in containers:** Does GPU/NPU passthrough work reliably with Podman on Ubuntu? I've seen `/dev/dri` mounting for GPU, but NPU passthrough seems less documented — is there a recommended approach?

### Scope Questions

7. **n8n community node vs built-in node:** Should this be published as an n8n community node (npm package) or submitted as a built-in node to the n8n repo? Community node is faster to iterate on, but built-in has more visibility.

8. **Workflow templates format:** For the additional workflow templates, should I export them as n8n JSON files (importable via UI) or build them programmatically using n8n's API? JSON files are simpler for users.

---

## Getting Started (Quick Reference)

```bash
# 1. Clone the repo
git clone https://github.com/Nandkishore-04/n8n-openvino
cd n8n-openvino

# 2. Install dependencies
npm install

# 3. Start the full stack
cd deployment && podman-compose up -d

# 4. Build and link the custom node
npm run build
npm link
cd ~/.n8n/custom && npm link n8n-nodes-openvino

# 5. Open n8n
open http://localhost:5678

# 6. Import the demo workflow
# n8n UI → Add Workflow → Import from file → workflows/document-pipeline.json

# 7. Drop a test document
cp test/sample-invoice.pdf deployment/incoming/

# 8. Watch the magic happen in n8n Executions tab
```

---

*This document is a living guide — it will be updated as the implementation progresses and as feedback is received from mentors.*

**Author:** Nandkishore  
**Project:** GSoC 2026 — No-Code AI Workflow Automation with n8n and OpenVINO Model Server  
**Mentors:** Praveen Kundurthy, Max Domeika  
**Repository:** https://github.com/Nandkishore-04/n8n-openvino