import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

/**
 * Direct connection to an OctoPrint instance's REST API.
 * Used by the OctoPrint action node in "Direct" mode and for the credential
 * test. The bridge (octoprint2n8n) holds its own copy of these values in env.
 */
export class OctoPrintApi implements ICredentialType {
	name = 'octoPrintApi';

	displayName = 'OctoPrint API';

	documentationUrl = 'https://github.com/amosroger91/n8n-2-octoPrint';

	properties: INodeProperties[] = [
		{
			displayName: 'OctoPrint Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'http://octopi.local',
			placeholder: 'http://192.168.1.50',
			required: true,
			description: 'Base URL of the OctoPrint server, without a trailing /api',
		},
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'OctoPrint API key. Settings → API (global) or Settings → Application Keys (per app).',
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
				'X-Api-Key': '={{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/api/version',
			skipSslCertificateValidation: '={{$credentials.allowUnauthorizedCerts}}',
		},
	};
}
