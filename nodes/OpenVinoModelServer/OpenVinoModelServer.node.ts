import {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IDataObject,
	NodeOperationError,
} from 'n8n-workflow';

// ─── Built-in Tool Executor ─────────────────────────────────────────
// Executes tools that the LLM agent can call during the agentic loop.
// Each tool is a simple function that returns a result.
async function executeBuiltInTool(
	toolName: string,
	args: Record<string, unknown>,
	helpers: IExecuteFunctions['helpers'],
	classicOvmsUrl: string,
): Promise<unknown> {
	switch (toolName) {
		case 'analyze_sentiment': {
			const text = (args.text as string) || '';
			const response = await helpers.httpRequest({
				method: 'POST',
				url: `${classicOvmsUrl}/v1/models/text-classifier:predict`,
				headers: { 'Content-Type': 'application/json' },
				body: { instances: [{ text }] },
				timeout: 30000,
			});
			const parsed = typeof response === 'string' ? JSON.parse(response) : response;
			return parsed.predictions?.[0] || parsed;
		}

		case 'get_current_time': {
			return { current_time: new Date().toISOString(), timezone: 'UTC' };
		}

		case 'calculate': {
			const { expression } = args as { expression: string };
			try {
				const sanitized = String(expression).replace(/[^0-9+\-*/().%\s]/g, '');
				const result = Function(`"use strict"; return (${sanitized})`)();
				return { expression, result };
			} catch {
				return { expression, error: 'Invalid expression' };
			}
		}

		case 'list_models': {
			const response = await helpers.httpRequest({
				method: 'GET',
				url: `${classicOvmsUrl}/v1/config`,
				timeout: 10000,
			});
			return typeof response === 'string' ? JSON.parse(response) : response;
		}

		case 'lookup_knowledge_base': {
			const query = (args.query as string) || '';
			const queryLower = query.toLowerCase();
			const KB_ENTRIES = [
				{ id: 'KB001', topic: 'refund', title: 'Refund Policy', content: 'Full refund within 30 days of purchase. Contact support with your order ID. Refunds processed in 3-5 business days.' },
				{ id: 'KB002', topic: 'shipping', title: 'Shipping Delays', content: 'Current processing time is 3-5 business days. Expedited shipping available for +$9.99. Track your order at orders.example.com.' },
				{ id: 'KB003', topic: 'broken', title: 'Defective Product Replacement', content: 'We offer free replacement for defective items within 90 days. Please send a photo of the damage to support@example.com with your order ID.' },
				{ id: 'KB004', topic: 'setup', title: 'Installation & Setup Guide', content: 'Download latest drivers from intel.com/drivers. Run the setup wizard. If issues persist, try disabling antivirus temporarily during installation.' },
				{ id: 'KB005', topic: 'performance', title: 'Performance Optimization', content: 'Enable hardware acceleration in Settings > Advanced. Update firmware to latest version. Ensure adequate ventilation for optimal performance.' },
				{ id: 'KB006', topic: 'account', title: 'Account & Billing', content: 'Manage your subscription at account.example.com. Cancel anytime with no penalty. Contact billing@example.com for invoice requests.' },
				{ id: 'KB007', topic: 'warranty', title: 'Warranty Information', content: '2-year manufacturer warranty covers hardware defects. Extended warranty available for purchase within 30 days of original order.' },
			];
			const matches = KB_ENTRIES.filter(e =>
				queryLower.includes(e.topic) ||
				e.title.toLowerCase().includes(queryLower) ||
				queryLower.split(/\s+/).some(word => word.length > 3 && e.content.toLowerCase().includes(word)),
			);
			return {
				query,
				results: matches.length > 0 ? matches : KB_ENTRIES.slice(0, 2),
				matchCount: matches.length,
				source: 'internal_knowledge_base',
			};
		}

		case 'draft_response': {
			const sentiment = (args.sentiment as string) || 'NEUTRAL';
			const customerMessage = (args.customer_message as string) || '';
			const kbContext = (args.kb_context as string) || '';
			const templates: Record<string, string> = {
				NEGATIVE: `We sincerely apologize for your experience. ${kbContext || 'Our team is investigating this issue.'} We want to make this right — a support specialist will follow up within 24 hours.`,
				POSITIVE: `Thank you so much for your kind feedback! We're thrilled to hear you're enjoying the product. Your support means a lot to our team.`,
				NEUTRAL: `Thank you for reaching out to us. ${kbContext || 'We appreciate your feedback and want to ensure you have the best experience.'} Please don't hesitate to contact us if you need further assistance.`,
			};
			return {
				draft: templates[sentiment.toUpperCase()] || templates['NEUTRAL'],
				sentiment,
				original_message: customerMessage.substring(0, 200),
				needs_human_review: sentiment.toUpperCase() === 'NEGATIVE',
			};
		}

		case 'create_ticket': {
			const customerMessage = (args.customer_message as string) || '';
			const priority = (args.priority as string) || 'MEDIUM';
			const sentiment = (args.sentiment as string) || 'UNKNOWN';
			const sentimentUpper = sentiment.toUpperCase();
			const draftTemplates: Record<string, string> = {
				NEGATIVE: `We sincerely apologize for your experience. We want to make this right — a support specialist will follow up within 24 hours.`,
				POSITIVE: `Thank you so much for your kind feedback! We're thrilled to hear you're enjoying the product.`,
				NEUTRAL: `Thank you for reaching out. We appreciate your feedback and want to ensure you have the best experience.`,
			};
			const draftResponse = (args.draft_response as string) || draftTemplates[sentimentUpper] || draftTemplates['NEUTRAL'];
			const ticketId = `TKT-${Date.now().toString(36).toUpperCase()}`;
			return {
				ticket_id: ticketId,
				priority: priority.toUpperCase(),
				sentiment,
				customer_message: customerMessage.substring(0, 500),
				draft_response: draftResponse.substring(0, 500),
				status: 'OPEN',
				assigned_to: priority.toUpperCase() === 'HIGH' ? 'senior_support' : 'general_support',
				created_at: new Date().toISOString(),
			};
		}

		default:
			return { error: `Unknown tool: ${toolName}` };
	}
}

export class OpenVinoModelServer implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'OpenVINO Model Server',
		name: 'openVinoModelServer',
		icon: 'file:openvino.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}} — {{$parameter["modelName"] || $parameter["llmModel"] || ""}}',
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
			// --- Operation Selector ---
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Predict',
						value: 'predict',
						description: 'Run inference on a classic model',
						action: 'Run inference on a model',
					},
					{
						name: 'Chat Completion',
						value: 'chatCompletion',
						description: 'Send a chat message to an LLM on OVMS',
						action: 'Send chat completion request',
					},
					{
						name: 'Agent Loop',
						value: 'agentLoop',
						description: 'Run an agentic loop with tool calling',
						action: 'Run agentic tool-calling loop',
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
						description: 'List all available models on the server',
						action: 'List all available models',
					},
				],
				default: 'predict',
			},

			// ─── Classic Model Fields ───────────────────────────────────

			{
				displayName: 'Model Name',
				name: 'modelName',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { operation: ['predict', 'status'] } },
				placeholder: 'text-classifier',
				description: 'Name of the model as configured in OVMS config.json',
			},
			{
				displayName: 'Target Device',
				name: 'device',
				type: 'options',
				options: [
					{ name: 'AUTO (Recommended)', value: 'AUTO', description: 'Let OpenVINO AUTO plugin select the best device' },
					{ name: 'NPU', value: 'NPU', description: 'Neural Processing Unit — power-efficient inference' },
					{ name: 'GPU', value: 'GPU', description: 'Graphics Processing Unit — high-performance inference' },
					{ name: 'CPU', value: 'CPU', description: 'Central Processing Unit — universal fallback' },
				],
				default: 'AUTO',
				displayOptions: { show: { operation: ['predict'] } },
				description: 'Hardware device to run inference on',
			},
			{
				displayName: 'API Version',
				name: 'apiVersion',
				type: 'options',
				options: [
					{ name: 'KServe v2 (Recommended)', value: 'v2' },
					{ name: 'TensorFlow Serving v1', value: 'v1' },
				],
				default: 'v2',
				displayOptions: { show: { operation: ['predict'] } },
				description: 'OVMS supports both KServe v2 and TF Serving v1 inference APIs',
			},
			{
				displayName: 'Input Data',
				name: 'inputData',
				type: 'json',
				default: '{}',
				displayOptions: { show: { operation: ['predict'] } },
				description: 'JSON payload to send to the model for inference',
			},
			{
				displayName: 'Additional Options',
				name: 'additionalOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: { show: { operation: ['predict'] } },
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
						description: 'Specific model version to use (0 = latest)',
					},
				],
			},

			// ─── LLM / Agentic Fields ──────────────────────────────────

			{
				displayName: 'LLM Server URL',
				name: 'llmServerUrl',
				type: 'string',
				default: 'http://ovms-llm:8000',
				displayOptions: { show: { operation: ['chatCompletion', 'agentLoop'] } },
				description: 'URL of the OVMS LLM service (OpenAI-compatible)',
			},
			{
				displayName: 'LLM Model',
				name: 'llmModel',
				type: 'string',
				default: 'OpenVINO/Qwen2.5-1.5B-Instruct-int4-ov',
				displayOptions: { show: { operation: ['chatCompletion', 'agentLoop'] } },
				description: 'Model name as recognized by OVMS LLM',
			},
			{
				displayName: 'System Prompt',
				name: 'systemPrompt',
				type: 'string',
				typeOptions: { rows: 4 },
				default: 'You are a helpful assistant.',
				displayOptions: { show: { operation: ['chatCompletion', 'agentLoop'] } },
				description: 'System prompt for the LLM',
			},
			{
				displayName: 'User Message',
				name: 'userMessage',
				type: 'string',
				typeOptions: { rows: 3 },
				default: '',
				required: true,
				displayOptions: { show: { operation: ['chatCompletion', 'agentLoop'] } },
				description: 'The user message to send to the LLM',
			},
			{
				displayName: 'Tools Definition',
				name: 'toolsDefinition',
				type: 'json',
				default: '[]',
				displayOptions: { show: { operation: ['agentLoop'] } },
				description: 'JSON array of tool definitions in OpenAI function-calling format',
			},
			{
				displayName: 'Max Iterations',
				name: 'maxIterations',
				type: 'number',
				default: 5,
				displayOptions: { show: { operation: ['agentLoop'] } },
				description: 'Maximum number of LLM-tool-call rounds before stopping',
			},
			{
				displayName: 'Temperature',
				name: 'temperature',
				type: 'number',
				default: 0.1,
				displayOptions: { show: { operation: ['chatCompletion', 'agentLoop'] } },
				description: 'Sampling temperature (0 = deterministic, 1 = creative)',
			},
			{
				displayName: 'Max Tokens',
				name: 'maxTokens',
				type: 'number',
				default: 512,
				displayOptions: { show: { operation: ['chatCompletion', 'agentLoop'] } },
				description: 'Maximum tokens in the LLM response',
			},
		],
	};

	// ─── Execution Logic ─────────────────────────────────────────────
	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const operation = this.getNodeParameter('operation', 0) as string;
		const credentials = await this.getCredentials('openVinoModelServerApi');
		const serverUrl = (credentials.serverUrl as string).replace(/\/$/, '');

		const results: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				let responseData: IDataObject;

				// ── LIST MODELS ──────────────────────────────────────
				if (operation === 'list') {
					const response = await this.helpers.httpRequest({
						method: 'GET',
						url: `${serverUrl}/v1/config`,
					});
					responseData = (typeof response === 'string'
						? JSON.parse(response)
						: response) as IDataObject;

				// ── GET MODEL STATUS ─────────────────────────────────
				} else if (operation === 'status') {
					const modelName = this.getNodeParameter('modelName', i) as string;
					const response = await this.helpers.httpRequest({
						method: 'GET',
						url: `${serverUrl}/v1/models/${modelName}`,
					});
					responseData = (typeof response === 'string'
						? JSON.parse(response)
						: response) as IDataObject;

				// ── PREDICT (CLASSIC INFERENCE) ──────────────────────
				} else if (operation === 'predict') {
					const modelName = this.getNodeParameter('modelName', i) as string;
					const device = this.getNodeParameter('device', i) as string;
					const apiVersion = this.getNodeParameter('apiVersion', i) as string;
					const inputData = this.getNodeParameter('inputData', i);
					const additionalOptions = this.getNodeParameter('additionalOptions', i) as IDataObject;
					const timeout = (additionalOptions.timeout as number) ?? 30000;
					const modelVersion = (additionalOptions.modelVersion as number) ?? 0;

					const startTime = Date.now();

					let endpoint: string;
					let requestBody: IDataObject;

					if (apiVersion === 'v2') {
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
								},
							],
						};
					} else {
						endpoint = `${serverUrl}/v1/models/${modelName}:predict`;
						requestBody = {
							instances: [inputData],
						};
					}

					const response = await this.helpers.httpRequest({
						method: 'POST',
						url: endpoint,
						headers: {
							'Content-Type': 'application/json',
							'X-Target-Device': device,
						},
						body: requestBody,
						timeout,
					});

					const latencyMs = Date.now() - startTime;
					const parsed = (typeof response === 'string'
						? JSON.parse(response)
						: response) as IDataObject;

					responseData = {
						...parsed,
						_meta: {
							model: modelName,
							requestedDevice: device,
							actualDevice: (parsed.actual_device as string) ?? device,
							apiVersion,
							latencyMs,
							timestamp: new Date().toISOString(),
						},
					};

				// ── CHAT COMPLETION (LLM) ────────────────────────────
				} else if (operation === 'chatCompletion') {
					const llmServerUrl = (this.getNodeParameter('llmServerUrl', i) as string).replace(/\/$/, '');
					const llmModel = this.getNodeParameter('llmModel', i) as string;
					const systemPrompt = this.getNodeParameter('systemPrompt', i) as string;
					const userMessage = this.getNodeParameter('userMessage', i) as string;
					const temperature = this.getNodeParameter('temperature', i) as number;
					const maxTokens = this.getNodeParameter('maxTokens', i) as number;

					const startTime = Date.now();
					const response = await this.helpers.httpRequest({
						method: 'POST',
						url: `${llmServerUrl}/v3/chat/completions`,
						headers: { 'Content-Type': 'application/json' },
						body: {
							model: llmModel,
							messages: [
								{ role: 'system', content: systemPrompt },
								{ role: 'user', content: userMessage },
							],
							temperature,
							max_tokens: maxTokens,
						},
						timeout: 120000,
					});

					const parsed = (typeof response === 'string'
						? JSON.parse(response)
						: response) as IDataObject;
					const latencyMs = Date.now() - startTime;

					responseData = {
						...parsed,
						_meta: {
							operation: 'chatCompletion',
							model: llmModel,
							latencyMs,
							timestamp: new Date().toISOString(),
						},
					};

				// ── AGENT LOOP (LLM + TOOL CALLING) ──────────────────
				} else {
					const llmServerUrl = (this.getNodeParameter('llmServerUrl', i) as string).replace(/\/$/, '');
					const llmModel = this.getNodeParameter('llmModel', i) as string;
					const systemPrompt = this.getNodeParameter('systemPrompt', i) as string;
					const userMessage = this.getNodeParameter('userMessage', i) as string;
					const toolsDefinition = this.getNodeParameter('toolsDefinition', i);
					const maxIterations = this.getNodeParameter('maxIterations', i) as number;
					const temperature = this.getNodeParameter('temperature', i) as number;
					const maxTokens = this.getNodeParameter('maxTokens', i) as number;

					const tools = typeof toolsDefinition === 'string'
						? JSON.parse(toolsDefinition)
						: toolsDefinition;

					const messages: IDataObject[] = [
						{ role: 'system', content: systemPrompt },
						{ role: 'user', content: userMessage },
					];

					const iterationLog: IDataObject[] = [];
					let finalContent = '';
					const startTime = Date.now();

					for (let iter = 0; iter < maxIterations; iter++) {
						const response = await this.helpers.httpRequest({
							method: 'POST',
							url: `${llmServerUrl}/v3/chat/completions`,
							headers: { 'Content-Type': 'application/json' },
							body: {
								model: llmModel,
								messages,
								tools: tools.length > 0 ? tools : undefined,
								tool_choice: tools.length > 0 ? 'auto' : undefined,
								temperature,
								max_tokens: maxTokens,
							},
							timeout: 120000,
						});

						const parsed = typeof response === 'string' ? JSON.parse(response) : response;
						const choice = parsed.choices?.[0];
						const assistantMessage = choice?.message;

						if (!assistantMessage) {
							finalContent = 'No response from LLM';
							break;
						}

						messages.push(assistantMessage);

						// Check if the LLM wants to call tools
						if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
							for (const toolCall of assistantMessage.tool_calls) {
								const fnName = toolCall.function.name;
								let fnArgs: Record<string, unknown>;
								try {
									fnArgs = JSON.parse(toolCall.function.arguments);
								} catch {
									fnArgs = {};
								}

								let toolResult: unknown;
								try {
									toolResult = await executeBuiltInTool(fnName, fnArgs, this.helpers, serverUrl);
								} catch (toolError: unknown) {
									const errMsg = toolError instanceof Error ? toolError.message : String(toolError);
									toolResult = { error: `Tool execution failed: ${errMsg}` };
								}

								iterationLog.push({
									iteration: iter + 1,
									tool: fnName,
									args: fnArgs as IDataObject,
									result: toolResult as IDataObject,
								});

								messages.push({
									role: 'tool',
									tool_call_id: toolCall.id,
									content: JSON.stringify(toolResult),
								});
							}

							// Nudge small models to continue calling tools instead of stopping early
							const lastTool = assistantMessage.tool_calls[assistantMessage.tool_calls.length - 1].function.name;
							if (lastTool !== 'create_ticket') {
								messages.push({
									role: 'user',
									content: 'Tool result received. Continue to the next step. Call the next tool now.',
								});
							}
						} else {
							// LLM gave a final answer (no tool calls)
							finalContent = assistantMessage.content || '';
							// If content is empty/short and we haven't created a ticket yet,
							// nudge the model to continue instead of stopping
							const hasTicket = iterationLog.some(
								(entry) => (entry.tool as string) === 'create_ticket',
							);
							if (!hasTicket && finalContent.length < 20) {
								messages.push({
									role: 'user',
									content: 'You have not called create_ticket yet. Call create_ticket now to complete the triage.',
								});
								finalContent = '';
								continue;
							}
							break;
						}
					}

					const totalLatencyMs = Date.now() - startTime;

					responseData = {
						finalAnswer: finalContent,
						iterations: iterationLog as unknown as IDataObject,
						totalIterations: iterationLog.length,
						conversationLength: messages.length,
						_meta: {
							operation: 'agentLoop',
							model: llmModel,
							totalLatencyMs,
							timestamp: new Date().toISOString(),
						},
					} as IDataObject;
				}

				results.push({ json: responseData });

			} catch (error: unknown) {
				if (this.continueOnFail()) {
					const message = error instanceof Error ? error.message : String(error);
					results.push({ json: { error: message } });
					continue;
				}
				throw new NodeOperationError(
					this.getNode(),
					error instanceof Error ? error : new Error(String(error)),
					{ itemIndex: i },
				);
			}
		}

		return [results];
	}
}
