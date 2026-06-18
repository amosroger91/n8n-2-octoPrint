import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

/**
 * Connection to an octoprint2n8n bridge. The action node uses this in "Bridge"
 * mode to relay commands to OctoPrint, and the trigger node uses the shared
 * secret to verify HMAC signatures on incoming events.
 */
export class OctoPrintBridgeApi implements ICredentialType {
	name = 'octoPrintBridgeApi';

	displayName = 'OctoPrint Bridge (octoprint2n8n)';

	documentationUrl = 'https://github.com/amosroger91/n8n-2-octoPrint';

	properties: INodeProperties[] = [
		{
			displayName: 'Bridge Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'http://localhost:5252',
			placeholder: 'http://octoprint2n8n:5252',
			required: true,
			description: 'Base URL where the octoprint2n8n bridge is reachable from n8n',
		},
		{
			displayName: 'Shared Secret',
			name: 'sharedSecret',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description: 'Must match BRIDGE_SHARED_SECRET in the bridge. Authenticates commands and signs events.',
		},
		{
			displayName: 'Ignore SSL Issues',
			name: 'allowUnauthorizedCerts',
			type: 'boolean',
			default: false,
			description: 'Whether to connect even if the TLS certificate cannot be verified',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.sharedSecret}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/api/v1/health',
			skipSslCertificateValidation: '={{$credentials.allowUnauthorizedCerts}}',
		},
	};
}
