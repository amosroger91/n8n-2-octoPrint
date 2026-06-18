import type { AuthUser } from '../auth/types';

function esc(s: string): string {
	return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

const STYLE = `
:root{--bg:#0d1117;--panel:#161b22;--border:#30363d;--text:#e6edf3;--muted:#8b949e;--accent:#13c100;--bad:#f85149;--warn:#d29922}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 system-ui,Segoe UI,Roboto,sans-serif}
a{color:var(--accent)}
.wrap{max-width:1000px;margin:0 auto;padding:24px}
header{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px}
header h1{font-size:18px;margin:0}
header .sub{color:var(--muted);font-size:13px}
.btn{background:var(--panel);border:1px solid var(--border);color:var(--text);padding:7px 12px;border-radius:8px;cursor:pointer;text-decoration:none;font-size:13px}
.btn:hover{border-color:var(--accent)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin-bottom:18px}
.card{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:16px}
.card h2{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:0 0 10px}
.big{font-size:26px;font-weight:600}
.row{display:flex;justify-content:space-between;padding:4px 0;color:var(--muted)}
.row b{color:var(--text);font-weight:500}
.dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px;vertical-align:middle}
.ok{background:var(--accent)}.no{background:var(--bad)}.idle{background:var(--muted)}
.bar{height:8px;background:#21262d;border-radius:6px;overflow:hidden;margin-top:8px}
.bar>i{display:block;height:100%;background:var(--accent);width:0}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--border)}
th{color:var(--muted);font-weight:500}
.badge{display:inline-block;padding:2px 8px;border-radius:20px;font-size:12px;background:#21262d;color:var(--muted)}
.badge.printing{background:rgba(19,193,0,.15);color:var(--accent)}
.badge.done{background:rgba(19,193,0,.15);color:var(--accent)}
.badge.failed,.badge.cancelled{background:rgba(248,81,73,.15);color:var(--bad)}
.badge.slicing,.badge.uploading,.badge.claimed{background:rgba(210,153,34,.15);color:var(--warn)}
.muted{color:var(--muted)}
.login{max-width:360px;margin:12vh auto}
.login .card{padding:24px}
input{width:100%;background:#0d1117;border:1px solid var(--border);color:var(--text);padding:10px;border-radius:8px;margin:6px 0;font-size:14px}
.login .btn{width:100%;justify-content:center;text-align:center;margin-top:8px;background:var(--accent);color:#06210a;border:none;font-weight:600}
.err{background:rgba(248,81,73,.12);color:var(--bad);border:1px solid var(--bad);padding:8px 12px;border-radius:8px;margin-bottom:12px;font-size:13px}
.oauth{margin-top:14px;border-top:1px solid var(--border);padding-top:14px}
`;

export function loginPage(opts: {
	passwordProviders: { id: string; label: string }[];
	oauthProviders: { id: string; label: string }[];
	error?: string;
}): string {
	const pwForm = opts.passwordProviders.length
		? `<form method="POST" action="/login">
        <input name="username" placeholder="Username" autocomplete="username" autofocus>
        <input name="password" type="password" placeholder="Password" autocomplete="current-password">
        <button class="btn" type="submit">Sign in</button>
      </form>`
		: '';
	const oauth = opts.oauthProviders.length
		? `<div class="oauth">${opts.oauthProviders
				.map((p) => `<a class="btn" style="display:block;text-align:center;margin-top:8px" href="/auth/${esc(p.id)}">Continue with ${esc(p.label)}</a>`)
				.join('')}</div>`
		: '';
	return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>print-orchestrator · sign in</title><style>${STYLE}</style></head>
<body><div class="login"><div class="card">
<h1 style="margin:0 0 4px">print-orchestrator</h1>
<p class="muted" style="margin:0 0 16px">Sign in to view the dashboard</p>
${opts.error ? `<div class="err">${esc(opts.error)}</div>` : ''}
${pwForm}${oauth}
</div></div></body></html>`;
}

export function dashboardPage(user: AuthUser): string {
	return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>print-orchestrator</title><style>${STYLE}</style></head>
<body><div class="wrap">
<header>
  <div><h1>print-orchestrator</h1><div class="sub" id="sub">loading…</div></div>
  <div><span class="muted" style="margin-right:12px">${esc(user.name)}</span>
  <form method="POST" action="/logout" style="display:inline"><button class="btn" type="submit">Sign out</button></form></div>
</header>
<div class="grid">
  <div class="card"><h2>Printer</h2>
    <div class="big"><span class="dot idle" id="p-dot"></span><span id="p-state">—</span></div>
    <div class="row"><span>OctoPrint</span><b id="p-version">—</b></div>
    <div class="row"><span>Address</span><b id="p-url" class="muted"></b></div>
    <div class="bar"><i id="p-bar"></i></div>
    <div class="row"><span>Progress</span><b id="p-pct">—</b></div>
  </div>
  <div class="card"><h2>Queue</h2>
    <div class="row"><span>Active</span><b id="q-active">0</b></div>
    <div class="row"><span>Waiting</span><b id="q-waiting">0</b></div>
    <div class="row"><span>Completed</span><b id="q-completed">0</b></div>
    <div class="row"><span>Failed</span><b id="q-failed">0</b></div>
  </div>
  <div class="card"><h2>Pipeline</h2>
    <div class="row"><span>Slicer</span><b id="c-slicer">—</b></div>
    <div class="row"><span>n8n polling</span><b id="c-n8n">—</b></div>
    <div class="row"><span>Concurrency</span><b id="c-conc">—</b></div>
    <div class="row"><span>Printer ID</span><b id="c-pid">—</b></div>
  </div>
</div>
<div class="card"><h2>Recent jobs</h2>
  <table><thead><tr><th>Job</th><th>Status</th><th>Progress</th><th>Updated</th></tr></thead>
  <tbody id="jobs"><tr><td colspan="4" class="muted">No jobs yet.</td></tr></tbody></table>
</div>
</div>
<script>
function ago(iso){if(!iso)return'';const s=Math.max(0,(Date.now()-new Date(iso).getTime())/1000);if(s<60)return Math.floor(s)+'s ago';if(s<3600)return Math.floor(s/60)+'m ago';return Math.floor(s/3600)+'h ago';}
function setDot(el,cls){el.className='dot '+cls;}
async function refresh(){
  let s;try{const r=await fetch('/api/status',{headers:{Accept:'application/json'}});if(r.status===401){location.href='/login';return;}s=await r.json();}catch(e){return;}
  document.getElementById('sub').textContent='updated '+new Date(s.generatedAt).toLocaleTimeString();
  const pr=s.printer;
  document.getElementById('p-state').textContent=pr.state;
  document.getElementById('p-version').textContent=pr.reachable?('v'+(pr.version||'?')):'unreachable';
  document.getElementById('p-url').textContent=pr.url;
  setDot(document.getElementById('p-dot'),!pr.reachable?'no':/printing/i.test(pr.state)?'ok':'idle');
  const pct=pr.completion==null?null:Math.round(pr.completion*10)/10;
  document.getElementById('p-pct').textContent=pct==null?'—':(pct+'%');
  document.getElementById('p-bar').style.width=(pct||0)+'%';
  document.getElementById('q-active').textContent=s.queue.active;
  document.getElementById('q-waiting').textContent=s.queue.waiting;
  document.getElementById('q-completed').textContent=s.queue.completed;
  document.getElementById('q-failed').textContent=s.queue.failed;
  document.getElementById('c-slicer').textContent=s.config.slicerConfigured?('on · '+s.config.slicerProfile):'off';
  document.getElementById('c-n8n').textContent=s.config.n8nPolling?'on':'off';
  document.getElementById('c-conc').textContent=s.config.concurrency;
  document.getElementById('c-pid').textContent=s.printerId;
  const tb=document.getElementById('jobs');
  if(!s.jobs.length){tb.innerHTML='<tr><td colspan="4" class="muted">No jobs yet.</td></tr>';}
  else{tb.innerHTML='';for(const j of s.jobs){const tr=document.createElement('tr');
    const c1=document.createElement('td');c1.textContent=j.id;
    const c2=document.createElement('td');const b=document.createElement('span');b.className='badge '+j.status;b.textContent=j.status;c2.appendChild(b);
    const c3=document.createElement('td');c3.textContent=j.progress==null?'—':(j.progress+'%');
    const c4=document.createElement('td');c4.className='muted';c4.textContent=ago(j.at);
    tr.append(c1,c2,c3,c4);tb.appendChild(tr);}}
}
refresh();setInterval(refresh,3000);
</script>
</body></html>`;
}
