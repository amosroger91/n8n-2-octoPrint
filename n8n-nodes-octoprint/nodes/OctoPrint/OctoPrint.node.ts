import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeConnectionType,
} from 'n8n-workflow';

import { octoprintApiRequest } from './GenericFunctions';

// Use the string literal (compiles to 'main') so the package works regardless
// of whether the host n8n exports NodeConnectionType (enum) or NodeConnectionTypes.
const MAIN = 'main' as NodeConnectionType;

function encodePath(filePath: string): string {
	return filePath
		.replace(/^\/+/, '')
		.split('/')
		.map((segment) => encodeURIComponent(segment))
		.join('/');
}

export class OctoPrint implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'OctoPrint',
		name: 'octoPrint',
		icon: 'file:octoprint.svg',
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Send commands to an OctoPrint 3D printer',
		defaults: {
			name: 'OctoPrint',
		},
		inputs: [MAIN],
		outputs: [MAIN],
		credentials: [
			{
				name: 'octoPrintBridgeApi',
				required: true,
				displayOptions: { show: { connection: ['bridge'] } },
			},
			{
				name: 'octoPrintApi',
				required: true,
				displayOptions: { show: { connection: ['direct'] } },
			},
		],
		properties: [
			{
				displayName: 'Connection',
				name: 'connection',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Via octoprint2n8n Bridge',
						value: 'bridge',
						description: 'Relay the command through the bridge (recommended)',
					},
					{
						name: 'Direct to OctoPrint',
						value: 'direct',
						description: 'Call the OctoPrint REST API directly (n8n must reach OctoPrint)',
					},
				],
				default: 'bridge',
			},
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Job', value: 'job' },
					{ name: 'Printer', value: 'printer' },
					{ name: 'File', value: 'file' },
					{ name: 'System', value: 'system' },
				],
				default: 'job',
			},

			// ----------------------------------------------------------------- Job
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['job'] } },
				options: [
					{ name: 'Get', value: 'get', action: 'Get the current job', description: 'Get information about the current print job' },
					{ name: 'Start', value: 'start', action: 'Start the print', description: 'Start printing the currently selected file' },
					{ name: 'Pause', value: 'pause', action: 'Pause the print' },
					{ name: 'Resume', value: 'resume', action: 'Resume the print' },
					{ name: 'Toggle Pause', value: 'toggle', action: 'Toggle pause resume' },
					{ name: 'Cancel', value: 'cancel', action: 'Cancel the print' },
					{ name: 'Restart', value: 'restart', action: 'Restart the print', description: 'Restart the currently paused print from the beginning' },
				],
				default: 'get',
			},

			// ------------------------------------------------------------- Printer
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['printer'] } },
				options: [
					{ name: 'Get State', value: 'getState', action: 'Get printer state', description: 'Get temperatures, SD state and printer flags' },
					{ name: 'Set Tool Temperature', value: 'setToolTemperature', action: 'Set tool temperature' },
					{ name: 'Set Bed Temperature', value: 'setBedTemperature', action: 'Set bed temperature' },
					{ name: 'Home', value: 'home', action: 'Home axes' },
					{ name: 'Jog', value: 'jog', action: 'Jog the print head' },
				],
				default: 'getState',
			},
			{
				displayName: 'Tool',
				name: 'tool',
				type: 'string',
				default: 'tool0',
				description: 'Which tool/extruder to target, e.g. tool0',
				displayOptions: { show: { resource: ['printer'], operation: ['setToolTemperature'] } },
			},
			{
				displayName: 'Temperature (°C)',
				name: 'temperature',
				type: 'number',
				default: 0,
				description: 'Target temperature in °C. Use 0 to turn the heater off.',
				displayOptions: { show: { resource: ['printer'], operation: ['setToolTemperature', 'setBedTemperature'] } },
			},
			{
				displayName: 'Axes',
				name: 'axes',
				type: 'multiOptions',
				options: [
					{ name: 'X', value: 'x' },
					{ name: 'Y', value: 'y' },
					{ name: 'Z', value: 'z' },
				],
				default: ['x', 'y', 'z'],
				displayOptions: { show: { resource: ['printer'], operation: ['home'] } },
			},
			{
				displayName: 'X',
				name: 'x',
				type: 'number',
				default: 0,
				displayOptions: { show: { resource: ['printer'], operation: ['jog'] } },
			},
			{
				displayName: 'Y',
				name: 'y',
				type: 'number',
				default: 0,
				displayOptions: { show: { resource: ['printer'], operation: ['jog'] } },
			},
			{
				displayName: 'Z',
				name: 'z',
				type: 'number',
				default: 0,
				displayOptions: { show: { resource: ['printer'], operation: ['jog'] } },
			},

			// ---------------------------------------------------------------- File
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['file'] } },
				options: [
					{ name: 'List', value: 'list', action: 'List files', description: 'List files stored in OctoPrint or on the SD card' },
					{ name: 'Select', value: 'select', action: 'Select a file', description: 'Select a file and optionally start printing it' },
					{ name: 'Delete', value: 'delete', action: 'Delete a file' },
				],
				default: 'list',
			},
			{
				displayName: 'Location',
				name: 'location',
				type: 'options',
				options: [
					{ name: 'Local', value: 'local' },
					{ name: 'SD Card', value: 'sdcard' },
				],
				default: 'local',
				displayOptions: { show: { resource: ['file'] } },
			},
			{
				displayName: 'Recursive',
				name: 'recursive',
				type: 'boolean',
				default: false,
				description: 'Whether to list files in sub-folders too',
				displayOptions: { show: { resource: ['file'], operation: ['list'] } },
			},
			{
				displayName: 'File Path',
				name: 'path',
				type: 'string',
				default: '',
				placeholder: 'benchy.gcode or folder/benchy.gcode',
				required: true,
				displayOptions: { show: { resource: ['file'], operation: ['select', 'delete'] } },
			},
			{
				displayName: 'Print After Select',
				name: 'print',
				type: 'boolean',
				default: false,
				description: 'Whether to immediately start printing the selected file',
				displayOptions: { show: { resource: ['file'], operation: ['select'] } },
			},

			// -------------------------------------------------------------- System
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['system'] } },
				options: [
					{ name: 'Get Version', value: 'getVersion', action: 'Get version' },
					{ name: 'Get Connection', value: 'getConnection', action: 'Get connection state' },
					{ name: 'Connect', value: 'connect', action: 'Connect to the printer' },
					{ name: 'Disconnect', value: 'disconnect', action: 'Disconnect from the printer' },
				],
				default: 'getVersion',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;

				let method: 'GET' | 'POST' | 'DELETE' = 'GET';
				let path = '';
				let body: IDataObject = {};
				const qs: IDataObject = {};

				if (resource === 'job') {
					if (operation === 'get') {
						method = 'GET';
						path = 'job';
					} else {
						method = 'POST';
						path = 'job';
						if (operation === 'start') body = { command: 'start' };
						else if (operation === 'cancel') body = { command: 'cancel' };
						else if (operation === 'restart') body = { command: 'restart' };
						else if (operation === 'pause') body = { command: 'pause', action: 'pause' };
						else if (operation === 'resume') body = { command: 'pause', action: 'resume' };
						else if (operation === 'toggle') body = { command: 'pause', action: 'toggle' };
					}
				} else if (resource === 'printer') {
					if (operation === 'getState') {
						method = 'GET';
						path = 'printer';
					} else if (operation === 'setToolTemperature') {
						method = 'POST';
						path = 'printer/tool';
						const tool = this.getNodeParameter('tool', i) as string;
						const temperature = this.getNodeParameter('temperature', i) as number;
						body = { command: 'target', targets: { [tool]: temperature } };
					} else if (operation === 'setBedTemperature') {
						method = 'POST';
						path = 'printer/bed';
						const temperature = this.getNodeParameter('temperature', i) as number;
						body = { command: 'target', target: temperature };
					} else if (operation === 'home') {
						method = 'POST';
						path = 'printer/printhead';
						const axes = this.getNodeParameter('axes', i) as string[];
						body = { command: 'home', axes };
					} else if (operation === 'jog') {
						method = 'POST';
						path = 'printer/printhead';
						body = {
							command: 'jog',
							x: this.getNodeParameter('x', i) as number,
							y: this.getNodeParameter('y', i) as number,
							z: this.getNodeParameter('z', i) as number,
						};
					}
				} else if (resource === 'file') {
					const location = this.getNodeParameter('location', i) as string;
					if (operation === 'list') {
						method = 'GET';
						path = `files/${location}`;
						if (this.getNodeParameter('recursive', i) as boolean) qs.recursive = true;
					} else if (operation === 'select') {
						method = 'POST';
						path = `files/${location}/${encodePath(this.getNodeParameter('path', i) as string)}`;
						body = { command: 'select', print: this.getNodeParameter('print', i) as boolean };
					} else if (operation === 'delete') {
						method = 'DELETE';
						path = `files/${location}/${encodePath(this.getNodeParameter('path', i) as string)}`;
					}
				} else if (resource === 'system') {
					if (operation === 'getVersion') {
						method = 'GET';
						path = 'version';
					} else if (operation === 'getConnection') {
						method = 'GET';
						path = 'connection';
					} else if (operation === 'connect') {
						method = 'POST';
						path = 'connection';
						body = { command: 'connect' };
					} else if (operation === 'disconnect') {
						method = 'POST';
						path = 'connection';
						body = { command: 'disconnect' };
					}
				}

				const response = await octoprintApiRequest.call(this, method, path, body, qs);
				const json: IDataObject =
					response === undefined || response === null || response === ''
						? { success: true }
						: typeof response === 'object'
							? (response as IDataObject)
							: { result: response };

				returnData.push({ json, pairedItem: { item: i } });
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
					continue;
				}
				throw error;
			}
		}

		return [returnData];
	}
}
