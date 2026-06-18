// Tiny HTTP slice API around headless OrcaSlicer.
//   POST /slice   multipart: file=<STL/3MF>  profile=<name>  [material=<PLA|PETG|...>]
//      -> 200 text/plain gcode   (the orchestrator parses stats from the gcode)
//   GET  /health  -> {"status":"ok"}
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import busboy from 'busboy';

const PORT = Number(process.env.PORT || 8080);
const ORCA_BIN = process.env.ORCA_BIN || '/opt/orcaslicer/AppRun';
const PROFILE_ROOT = process.env.PROFILE_ROOT || '/opt/orcaslicer/resources/profiles';
const DATADIR = process.env.ORCA_DATADIR || '/data/orca';
// Profile selection (defaults target the Ender 3 V3 SE 0.4mm). Override via env.
// NB: pin the nozzle ("Ender3V3SE 0.4") — there are ~18 "0.20mm Standard" Creality
// process profiles, and an unpinned match would grab the wrong printer/nozzle.
const MACHINE_RE = new RegExp(process.env.MACHINE_MATCH || 'Ender-3 V3 SE 0\\.4 nozzle', 'i');
const PROCESS_RE = new RegExp(process.env.PROCESS_MATCH || '0\\.20mm Standard.*Ender3V3SE 0\\.4', 'i');

function log(m) {
	console.log(`${new Date().toISOString()} [slicer] ${m}`);
}

async function walk(dir) {
	let out = [];
	for (const e of await readdir(dir, { withFileTypes: true })) {
		const p = path.join(dir, e.name);
		if (e.isDirectory()) out = out.concat(await walk(p));
		else out.push(p);
	}
	return out;
}

let profileCache;
async function findProfiles(material) {
	if (!profileCache) profileCache = await walk(PROFILE_ROOT);
	const pick = (kind, re) => profileCache.find((f) => f.includes(`/${kind}/`) && re.test(path.basename(f)));
	const machine = pick('machine', MACHINE_RE);
	const proc = pick('process', PROCESS_RE);
	// Prefer the printer-vendor generic (Creality) for the right temps/flow, then
	// fall back to any vendor's generic of that material.
	const petg = /petg/i.test(material || '');
	const filament =
		pick('filament', petg ? /Creality Generic PETG\.json$/i : /Creality Generic PLA\.json$/i) ||
		pick('filament', petg ? /Generic PETG/i : /Generic PLA/i);
	if (!machine || !proc || !filament) {
		throw new Error(`profile not found (machine=${!!machine} process=${!!proc} filament=${!!filament}) under ${PROFILE_ROOT}`);
	}
	return { machine, proc, filament };
}

/** OrcaSlicer leaves layer_change_gcode empty with relative-E on (-> "Add G92 E0"); patch a copy. */
async function patchMachine(machinePath, workDir) {
	const json = JSON.parse(await readFile(machinePath, 'utf8'));
	if (!json.layer_change_gcode || (Array.isArray(json.layer_change_gcode) ? !json.layer_change_gcode.join('').trim() : !String(json.layer_change_gcode).trim())) {
		json.layer_change_gcode = 'G92 E0\n';
	}
	const patched = path.join(workDir, 'machine.json');
	await writeFile(patched, JSON.stringify(json));
	return patched;
}

function runOrca(args) {
	return new Promise((resolve, reject) => {
		const p = spawn(ORCA_BIN, args, { env: { ...process.env, QT_QPA_PLATFORM: 'offscreen', HOME: DATADIR } });
		let buf = '';
		p.stdout.on('data', (d) => (buf += d));
		p.stderr.on('data', (d) => (buf += d));
		p.on('error', reject);
		p.on('close', (code) => (code === 0 ? resolve(buf) : reject(new Error(`orca exit ${code}: ${buf.slice(-600)}`))));
	});
}

async function slice(stlPath, material, workDir) {
	const { machine, proc, filament } = await findProfiles(material);
	const patchedMachine = await patchMachine(machine, workDir);
	const outDir = path.join(workDir, 'out');
	log(`slicing with\n  machine=${path.basename(machine)}\n  process=${path.basename(proc)}\n  filament=${path.basename(filament)}`);
	await runOrca([
		'--load-settings', `${patchedMachine};${proc}`,
		'--load-filaments', filament,
		'--arrange', '1', '--orient', '1', '--slice', '0',
		'--outputdir', outDir, '--datadir', DATADIR, stlPath,
	]);
	const files = await readdir(outDir).catch(() => []);
	const gfile = files.find((f) => /\.gcode$/i.test(f));
	if (!gfile) throw new Error('no gcode produced');
	return readFile(path.join(outDir, gfile));
}

function handleSlice(req, res) {
	const bb = busboy({ headers: req.headers, limits: { fileSize: 256 * 1024 * 1024 } });
	let workDir;
	let stlPath;
	const fields = {};
	const chunks = [];
	bb.on('file', (_name, stream, info) => {
		stlPath = info.filename || 'model.stl';
		stream.on('data', (c) => chunks.push(c));
	});
	bb.on('field', (n, v) => (fields[n] = v));
	bb.on('close', async () => {
		try {
			if (!chunks.length) throw new Error('no file uploaded (field "file")');
			workDir = await mkdtemp(path.join(tmpdir(), 'slice-'));
			const stl = path.join(workDir, path.basename(stlPath));
			await writeFile(stl, Buffer.concat(chunks));
			const gcode = await slice(stl, fields.material, workDir);
			res.writeHead(200, { 'Content-Type': 'text/plain', 'X-Slicer': 'orcaslicer' });
			res.end(gcode);
			log(`done -> ${gcode.length} bytes`);
		} catch (err) {
			log(`ERROR: ${err.message}`);
			res.writeHead(500, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: err.message }));
		} finally {
			if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => {});
		}
	});
	bb.on('error', (e) => {
		res.writeHead(400);
		res.end(JSON.stringify({ error: String(e) }));
	});
	req.pipe(bb);
}

http
	.createServer((req, res) => {
		if (req.method === 'GET' && req.url === '/health') {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end('{"status":"ok"}');
		} else if (req.method === 'POST' && (req.url === '/slice' || req.url?.startsWith('/slice?'))) {
			handleSlice(req, res);
		} else {
			res.writeHead(404);
			res.end();
		}
	})
	.listen(PORT, () => log(`slice API on :${PORT} (orca: ${ORCA_BIN})`));
