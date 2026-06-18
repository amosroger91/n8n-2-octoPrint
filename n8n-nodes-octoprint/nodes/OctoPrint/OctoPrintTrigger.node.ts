import type {
	IDataObject,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
	NodeConnectionType,
} from 'n8n-workflow';
import { createHmac, timingSafeEqual } from 'crypto';

// String literal (compiles to 'main') for cross-version compatibility.
const MAIN = 'main' as NodeConnectionType;

/**
 * Receives events forwarded by the octoprint2n8n bridge and starts the workflow.
 *
 * Copy this node's *Production* webhook URL into the bridge's `N8N_WEBHOOK_URL`.
 * If you set a `BRIDGE_SHARED_SECRET` on the bridge, enable "Verify Signature"
 * here and attach an OctoPrint Bridge credential with the same secret.
 */
export class OctoPrintTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'OctoPrint Trigger',
		name: 'octoPrintTrigger',
		icon: 'file:octoprint.svg',
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["events"].join(", ")}}',
		description: 'Starts the workflow when the octoprint2n8n bridge forwards an OctoPrint event',
		defaults: {
			name: 'OctoPrint Trigger',
		},
		inputs: [],
		outputs: [MAIN],
		credentials: [
			{
				name: 'octoPrintBridgeApi',
				required: true,
				displayOptions: { show: { verifySignature: [true] } },
			},
		],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: '={{$parameter["path"]}}',
				// Use the path verbatim (e.g. /webhook/octoprint) instead of
				// prefixing it with the node's webhookId.
				isFullPath: true,
			},
		],
		properties: [
			{
				displayName: 'Webhook Path',
				name: 'path',
				type: 'string',
				default: 'octoprint',
				required: true,
				description: 'Path segment for this trigger\'s webhook URL',
			},
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				options: [
					{ name: '*  (All Events)', value: '*' },
					{ name: 'Print Started', value: 'PrintStarted' },
					{ name: 'Print Done', value: 'PrintDone' },
					{ name: 'Print Failed', value: 'PrintFailed' },
					{ name: 'Print Paused', value: 'PrintPaused' },
					{ name: 'Print Resumed', value: 'PrintResumed' },
					{ name: 'Print Cancelled', value: 'PrintCancelled' },
					{ name: 'Progress (Synthetic)', value: 'Progress' },
					{ name: 'State Change (Synthetic)', value: 'StateChange' },
					{ name: 'Snapshot (Synthetic)', value: 'Snapshot' },
					{ name: 'Connected', value: 'Connected' },
					{ name: 'Disconnected', value: 'Disconnected' },
					{ name: 'Error', value: 'Error' },
					{ name: 'File Selected', value: 'FileSelected' },
				],
				default: ['*'],
				description: 'Which events should start the workflow. Use * for all.',
			},
			{
				displayName: 'Verify Signature',
				name: 'verifySignature',
				type: 'boolean',
				default: false,
				description:
					'Whether to reject events whose HMAC signature does not match the shared secret',
			},
			{
				displayName: 'Max Signature Age (Seconds)',
				name: 'maxAge',
				type: 'number',
				default: 300,
				description: 'Reject signed events older than this, to prevent replay',
				displayOptions: { show: { verifySignature: [true] } },
			},
		],
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const body = (this.getBodyData() ?? {}) as IDataObject;
		const headers = this.getHeaderData() as IDataObject;
		const res = this.getResponseObject();

		const events = this.getNodeParameter('events') as string[];
		const verifySignature = this.getNodeParameter('verifySignature') as boolean;

		const eventName = (body.event as string) ?? 'unknown';

		if (verifySignature) {
			const credentials = await this.getCredentials('octoPrintBridgeApi');
			const secret = credentials.sharedSecret as string;
			const maxAge = this.getNodeParameter('maxAge') as number;

			const timestamp = String(body.timestamp ?? '');
			const nonce = String(body.nonce ?? '');
			const instanceId = String(body.instanceId ?? '');
			const provided = String(headers['x-octoprint-signature'] ?? '');

			const expected =
				'v1=' +
				createHmac('sha256', secret)
					.update(`v1:${timestamp}:${nonce}:${eventName}:${instanceId}`)
					.digest('hex');

			const signatureOk = safeEqual(provided, expected);
			const parsedTs = Date.parse(timestamp);
			const ageOk =
				!Number.isNaN(parsedTs) && Math.abs(Date.now() - parsedTs) <= maxAge * 1000;

			if (!signatureOk || !ageOk) {
				res.status(401).json({ error: 'invalid or stale signature' });
				return { noWebhookResponse: true };
			}
		}

		if (!(events.includes('*') || events.includes(eventName))) {
			res.status(200).json({ received: true, skipped: eventName });
			return { noWebhookResponse: true };
		}

		return {
			workflowData: [this.helpers.returnJsonArray([body])],
		};
	}
}

function safeEqual(a: string, b: string): boolean {
	const aBuf = Buffer.from(a);
	const bBuf = Buffer.from(b);
	if (aBuf.length !== bBuf.length) return false;
	return timingSafeEqual(aBuf, bBuf);
}
