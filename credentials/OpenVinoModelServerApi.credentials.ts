import {
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class OpenVinoModelServerApi implements ICredentialType {
	name = 'openVinoModelServerApi';
	displayName = 'OpenVINO Model Server API';
	documentationUrl = 'https://docs.openvino.ai/latest/ovms_what_is_openvino_model_server.html';

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
			description: 'Host for gRPC connection (for future use)',
		},
		{
			displayName: 'gRPC Port',
			name: 'grpcPort',
			type: 'number',
			default: 9000,
			description: 'Port for gRPC connection (for future use)',
		},
	];
}
