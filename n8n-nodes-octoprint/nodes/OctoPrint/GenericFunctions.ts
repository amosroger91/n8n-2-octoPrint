import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

/**
 * Make a request to OctoPrint, either directly or via the octoprint2n8n bridge.
 *
 * `octoPath` is the OctoPrint REST path *without* the leading `/api/`
 * (e.g. `job`, `printer/tool`, `files/local/benchy.gcode`). In bridge mode it
 * is forwarded to `/api/v1/proxy/<octoPath>`; in direct mode to `/api/<octoPath>`.
 */
export async function octoprintApiRequest(
	this: IExecuteFunctions | ILoadOptionsFunctions,
	method: IHttpRequestMethods,
	octoPath: string,
	body: IDataObject = {},
	qs: IDataObject = {},
): Promise<any> {
	const connection = this.getNodeParameter('connection', 0, 'bridge') as 'bridge' | 'direct';

	const credentialName = connection === 'direct' ? 'octoPrintApi' : 'octoPrintBridgeApi';
	const credentials = await this.getCredentials(credentialName);

	const baseUrl = (credentials.baseUrl as string).replace(/\/+$/, '');
	const path =
		connection === 'direct'
			? `/api/${octoPath}`
			: `/api/v1/proxy/${octoPath}`;

	const options: IHttpRequestOptions = {
		method,
		url: `${baseUrl}${path}`,
		json: true,
		skipSslCertificateValidation: credentials.allowUnauthorizedCerts as boolean,
	};

	if (Object.keys(body).length > 0) {
		options.body = body;
	}
	if (Object.keys(qs).length > 0) {
		options.qs = qs;
	}

	try {
		return await this.helpers.httpRequestWithAuthentication.call(this, credentialName, options);
	} catch (error) {
		throw new NodeApiError(this.getNode(), error as JsonObject);
	}
}
