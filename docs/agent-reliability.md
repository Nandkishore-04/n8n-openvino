# Agent Reliability & How It Works

## How the Agent Works

1. A customer message arrives via **webhook** (`POST /support`)
2. n8n passes it to the **OVMS Support Agent** node
3. The node sends the message + tool definitions to **Qwen2.5-1.5B** running on OVMS
4. The LLM decides which tool to call first (e.g., `analyze_sentiment`)
5. n8n executes the tool and feeds the result back to the LLM
6. The LLM reads the result and decides the next action — call another tool or give a final answer
7. This loop continues until the LLM gives a final answer or hits the max iteration cap

The key point: **the LLM decides the path at runtime**. A negative message triggers 4 tool calls; a positive message triggers fewer. This is not a hardcoded pipeline — the agent reasons about each result before choosing the next step.

## Reliability Challenges with Small Models

Qwen2.5-1.5B is a small model (1.5B parameters). During development, we encountered these issues:

| Problem | What Happened | How We Fixed It |
|---|---|---|
| **Agent stops after 1 tool call** | Model would call `analyze_sentiment`, then give a text summary instead of continuing | Added a **nudge system** — after each tool result, a message is injected: "Continue to the next step. Call the next tool now." |
| **Agent skips `create_ticket`** | Model would complete sentiment + KB + draft but stop before creating a ticket | Added a **completion check** — if the agent tries to stop without calling `create_ticket`, it gets nudged: "You have not called create_ticket yet." |
| **Model asks for confirmation** | Instead of executing tools, the model would ask "Would you like me to proceed?" | Made the system prompt directive: "Execute ALL steps automatically. Do NOT ask questions. Do NOT stop early." |
| **Empty/short final answers** | Model returns empty content as a "final answer" mid-loop | Code detects short answers (<20 chars) without a ticket and re-nudges instead of stopping |

### The Nudge System (Code-Level)

The nudge system is implemented in the agent loop (`OpenVinoModelServer.node.ts`):

```
After each tool result:
  → If last tool was NOT create_ticket:
      inject: "Tool result received. Continue to the next step."

If LLM gives text (no tool calls):
  → If no create_ticket in history AND text is short:
      inject: "You have not called create_ticket yet."
      continue the loop (don't break)
  → Otherwise:
      accept as final answer, break
```

This is specifically designed for small models. Larger models (7B+) would likely not need nudging.

## Conditional Branching

The agent takes different paths based on sentiment analysis results:

| Customer Sentiment | Tool Call Sequence | Priority | Assigned To |
|---|---|---|---|
| **NEGATIVE** (>85% confidence) | sentiment → KB lookup → draft response → create ticket | HIGH | senior_support |
| **POSITIVE** (>85% confidence) | sentiment → create ticket | LOW | general_support |
| **UNCERTAIN** (<85% confidence) | sentiment → KB lookup → create ticket | MEDIUM | general_support |

## Error Handling

| Error Type | How It's Handled |
|---|---|
| Malformed tool call JSON | Caught with try/catch, empty args used |
| Unknown tool name | Returns `{error: "Unknown tool: <name>"}` back to LLM |
| Tool execution failure (OVMS down) | Error message fed back to LLM as tool result |
| LLM returns no response | Loop breaks, returns "No response from LLM" |
| Max iterations reached (8) | Loop stops, returns whatever results collected |

## Safety Measures

- **Max iteration cap**: 8 (prevents infinite loops)
- **LLM call timeout**: 120 seconds
- **Tool call timeout**: 30 seconds (OVMS), 10 seconds (list queries)
- **Calculate tool sanitization**: only allows `0-9 + - * / ( ) . %`

## Available Tools

| Tool | What It Does | Backend |
|---|---|---|
| `analyze_sentiment` | Classifies POSITIVE/NEGATIVE with confidence score | DistilBERT on Classic OVMS |
| `lookup_knowledge_base` | Searches 7 FAQ articles by keyword matching | Built-in (simulated DB) |
| `draft_response` | Generates templated reply based on sentiment + KB context | Built-in |
| `create_ticket` | Creates ticket with ID, priority, assignment | Built-in |
| `calculate` | Evaluates math expressions | Built-in (sanitized) |
| `get_current_time` | Returns current UTC timestamp | Built-in |
| `list_models` | Lists models loaded in OVMS | Classic OVMS API |

## Combined Workflow — n8n Built-in AI Agent + Custom OVMS Node

In addition to the standalone custom agent, there is a **combined workflow** (`POST /support-v2`) that pairs the custom OVMS node with n8n's built-in AI Agent node.

### Architecture

```
Webhook → Custom OVMS Node (DistilBERT sentiment) → n8n AI Agent (Qwen2.5 reasoning) → Respond
```

- **Custom OVMS node** runs sentiment classification — fast (~30ms), deterministic, no LLM overhead
- **n8n AI Agent** receives the sentiment result and handles reasoning, KB lookup, and ticket creation using its built-in tool system

### Sub-nodes Connected to the AI Agent

| Sub-node | Role | Connection Type |
|---|---|---|
| **OpenAI Chat Model (OVMS)** | LLM brain — Qwen2.5-1.5B via gateway `/v1` proxy | `ai_languageModel` |
| **Window Buffer Memory** | Stores agent's internal reasoning loop per execution | `ai_memory` |
| **Sentiment Analysis** | Workflow Tool — calls sub-workflow that uses custom OVMS node for DistilBERT inference | `ai_tool` |
| **Knowledge Base Lookup** | Code Tool — searches mock FAQ articles by keyword | `ai_tool` |
| **Create Ticket** | Code Tool — creates prioritized support ticket | `ai_tool` |
| **Calculator** | Pre-built n8n tool for math operations | `ai_tool` |

### Gateway /v1 Proxy

n8n's OpenAI Chat Model node calls `/v1/chat/completions` and `/v1/models`, but OVMS uses `/v3/`. The gateway proxies these requests:
- `GET /v1/models` → `GET /v3/models` on OVMS-LLM
- `POST /v1/chat/completions` → `POST /v3/chat/completions` on OVMS-LLM

### Known Limitation: Small Model + Built-in AI Agent

The n8n built-in AI Agent does **not** have the custom nudge system. With Qwen2.5-1.5B:
- The agent often generates text responses directly instead of calling the code tools
- It receives the sentiment data correctly but skips the KB lookup and create_ticket tool calls
- It produces reasonable text output (mentions correct priority, drafts a response) but doesn't actually execute the tools

This is the key comparison point: **the custom OVMS node with the nudge system reliably completes 4 tool calls, while the built-in AI Agent with the same small model tends to skip tools**. Larger models (7B+) would likely perform better with the built-in agent.

### Custom Agent vs Built-in AI Agent

| Aspect | Custom OVMS Agent (`/support`) | Built-in AI Agent (`/support-v2`) |
|---|---|---|
| Tool calling reliability | High (nudge system forces completion) | Lower (small model skips tools) |
| Memory support | No | Yes (Window Buffer Memory) |
| Tool ecosystem | Custom tools only | Code Tools + pre-built tools + workflow-as-a-tool |
| Configuration | System prompt + tool JSON in node params | Visual sub-node connections in n8n canvas |
| Extensibility | Requires code changes | Drag-and-drop new tools in n8n UI |
| Best for | Small models that need guidance | Larger models or quick prototyping |

## Performance (Intel i7-1255U, 16GB RAM)

| Metric | Value |
|---|---|
| Single LLM call | 5-15 seconds |
| Sentiment analysis (DistilBERT) | 20-40ms |
| Full triage loop (4 tool calls) | 40-60 seconds |
| Memory usage (full stack) | ~6-8 GB |
