import {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IDataObject,
	NodeOperationError,
} from 'n8n-workflow';

export class OpenVinoModelServer implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'OpenVINO Model Server',
		name: 'openVinoModelServer',
		icon: 'file:openvino.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}} — {{$parameter["modelName"]}}',
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

		// ─── UI Properties ─────────────────────────────────────────────
		// Each property becomes a field in the node's settings panel.
		// "displayOptions.show" controls conditional visibility.
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
						description: 'List all available models on the server',
						action: 'List all available models',
					},
				],
				default: 'predict',
			},

			// --- Model Name (shown for predict & status) ---
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
				placeholder: 'document-understanding',
				description: 'Name of the model as configured in OVMS config.json',
			},

			// --- Target Device (the key feature: NPU/GPU/CPU/AUTO) ---
			{
				displayName: 'Target Device',
				name: 'device',
				type: 'options',
				options: [
					{
						name: 'AUTO (Recommended)',
						value: 'AUTO',
						description: 'Let OpenVINO AUTO plugin select the best device dynamically',
					},
					{
						name: 'NPU',
						value: 'NPU',
						description: 'Neural Processing Unit — power-efficient inference',
					},
					{
						name: 'GPU',
						value: 'GPU',
						description: 'Graphics Processing Unit — high-performance inference',
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

			// --- API Version ---
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
				description: 'OVMS supports both KServe v2 and TF Serving v1 inference APIs',
			},

			// --- Input Data ---
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
				description: 'JSON payload to send to the model for inference',
			},

			// --- Advanced Options (collapsible section) ---
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
						description: 'Specific model version to use (0 = latest)',
					},
				],
			},
		],
	};

	// ─── Execution Logic ─────────────────────────────────────────────
	//
	// KEY CONCEPT: In n8n, "this" inside execute() is NOT the class instance.
	// It's an IExecuteFunctions object injected by the n8n runtime.
	// That's why we inline all logic here instead of calling class methods.
	//
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

				// ── PREDICT (INFERENCE) ──────────────────────────────
				} else {
					const modelName = this.getNodeParameter('modelName', i) as string;
					const device = this.getNodeParameter('device', i) as string;
					const apiVersion = this.getNodeParameter('apiVersion', i) as string;
					const inputData = this.getNodeParameter('inputData', i);
					const additionalOptions = this.getNodeParameter(
						'additionalOptions', i,
					) as IDataObject;
					const timeout = (additionalOptions.timeout as number) ?? 30000;
					const modelVersion = (additionalOptions.modelVersion as number) ?? 0;

					const startTime = Date.now();

					// Build request based on API version
					let endpoint: string;
					let requestBody: IDataObject;

					if (apiVersion === 'v2') {
						// KServe v2 inference protocol
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
						// TensorFlow Serving v1 protocol
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

					// Attach metadata so users see which device processed their request
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
