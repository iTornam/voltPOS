// VoltPOS Remote — Cloudflare Worker (one file: API + the owner's web page)
//
// Storage (Workers KV, binding "VOLT"):
//   acct:<CODE>            -> { name, salt, hash, iter, shops:[{id,name,keyHash}], created }
//   snap:<CODE>:<shopId>   -> { receivedAt, snapshot }      (latest snapshot only)
//   sess:<token>           -> { code }                      (expires after 8 hours)
//   fail:<CODE>            -> failed-login counter          (expires after 15 minutes)
// Secrets: ADMIN_TOKEN (wrangler secret) - needed to create accounts.
//
// What the shops send: totals, recent sales, stock levels. Never PINs, never phone numbers.

const VIEWER_HTML = "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n<meta name=\"robots\" content=\"noindex,nofollow\">\n<meta name=\"theme-color\" content=\"#0e1117\">\n<title>VoltPOS Remote</title>\n<style>\n:root{--bg:#0e1117;--surface:#161b25;--surface2:#1e2533;--border:#2a3345;--text:#e8ecf4;--muted:#8592ad;--accent:#f5c400;--success:#3db87a;--danger:#e05252;--warn:#e8a33d;--font:system-ui,-apple-system,\"Segoe UI\",Roboto,sans-serif;--mono:ui-monospace,Menlo,Consolas,monospace}\n*{box-sizing:border-box;margin:0;padding:0}\nbody{background:var(--bg);color:var(--text);font-family:var(--font);font-size:14px;line-height:1.5;min-height:100vh}\nbutton,input{font-family:inherit;font-size:inherit;color:inherit}\n.wrap{max-width:980px;margin:0 auto;padding:14px}\n.brand{font-weight:700;letter-spacing:.04em;color:var(--accent)}.brand span{color:var(--muted)}\n.card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px}\n.btn{background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:8px 14px;cursor:pointer}\n.btn:hover{border-color:var(--accent)}.btn.primary{background:var(--accent);border-color:var(--accent);color:#111;font-weight:600}\n.input{width:100%;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:11px 12px}\n.input:focus{outline:none;border-color:var(--accent)}\n.muted{color:var(--muted)}.mono{font-family:var(--mono)}.err{color:var(--danger);min-height:20px;font-size:13px}\n/* login */\n.login{max-width:360px;margin:12vh auto 0;display:flex;flex-direction:column;gap:12px}\n.login h1{font-size:22px}\n/* top bar */\n.top{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;flex-wrap:wrap}\n.top .who{font-size:13px;color:var(--muted)}\n.tabs{display:flex;gap:8px;overflow-x:auto;padding-bottom:4px;margin-bottom:12px}\n.tab{white-space:nowrap;background:var(--surface);border:1px solid var(--border);border-radius:999px;padding:7px 14px;cursor:pointer;display:flex;align-items:center;gap:7px}\n.tab.on{border-color:var(--accent);color:var(--accent)}\n.dot{width:9px;height:9px;border-radius:50%;background:var(--muted);display:inline-block}\n.dot.ok{background:var(--success)}.dot.warn{background:var(--warn)}.dot.bad{background:var(--danger)}\n.status{display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:12px}\n/* grids */\n.grid{display:grid;gap:10px;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));margin-bottom:12px}\n.kpi .l{font-size:12px;color:var(--muted)}.kpi .v{font-family:var(--mono);font-size:20px;font-weight:600;margin-top:2px}.kpi .s{font-size:11px;color:var(--muted)}\n.pos{color:var(--success)}.neg{color:var(--danger)}.acc{color:var(--accent)}\nh2{font-size:13px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin:16px 0 8px}\n.two{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(300px,1fr))}\ntable{width:100%;border-collapse:collapse}\ntd,th{padding:7px 4px;border-bottom:1px solid var(--border);text-align:left;font-size:13px;vertical-align:top}\nth{color:var(--muted);font-weight:500;font-size:12px}td.r,th.r{text-align:right;font-family:var(--mono);white-space:nowrap}\ntr:last-child td{border-bottom:none}\n.badge{font-size:10px;border:1px solid var(--border);border-radius:999px;padding:1px 7px;color:var(--muted)}\n.badge.cr{border-color:var(--danger);color:var(--danger)}\n.bars{display:flex;align-items:flex-end;gap:5px;height:120px;padding-top:6px}\n.bar{flex:1;background:var(--accent);border-radius:4px 4px 0 0;min-height:2px;opacity:.9;position:relative}\n.bar.today{opacity:1;box-shadow:0 0 0 2px var(--accent)44}\n.bl{display:flex;gap:5px;font-size:10px;color:var(--muted);font-family:var(--mono);margin-top:4px}.bl span{flex:1;text-align:center}\n.grid2{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(230px,1fr))}\n.prow{display:flex;justify-content:space-between;gap:8px;padding:3px 0;font-size:13px}\n.empty{color:var(--muted);font-size:13px;padding:6px 0}\n.foot{margin:22px 0 8px;text-align:center;font-size:11px;color:var(--muted)}\n</style>\n</head>\n<body>\n<div class=\"wrap\" id=\"app\"></div>\n<script>\n(function(){\n'use strict';\nvar app=document.getElementById('app'),S={token:sessionStorage.getItem('vp_tok')||'',data:null,sel:'all',timer:null};\n\n// tiny safe DOM builder: text is always set as text, never as HTML\nfunction h(tag,attrs){var e=document.createElement(tag);attrs=attrs||{};for(var k in attrs){if(k==='class')e.className=attrs[k];else if(k==='text')e.textContent=attrs[k];else if(k.slice(0,2)==='on')e.addEventListener(k.slice(2),attrs[k]);else e.setAttribute(k,attrs[k]);}\n  for(var i=2;i<arguments.length;i++){var c=arguments[i];if(c==null||c===false)continue;e.appendChild(typeof c==='object'?c:document.createTextNode(String(c)));}return e;}\nfunction api(path,opt){opt=opt||{};var hd={'Content-Type':'application/json'};if(S.token)hd.Authorization='Bearer '+S.token;\n  return fetch(path,{method:opt.method||'GET',headers:hd,body:opt.body?JSON.stringify(opt.body):undefined}).then(function(r){return r.json().then(function(j){j._status=r.status;return j;});});}\nfunction money(n,cur){n=Number(n)||0;return (cur||'GH₵')+' '+n.toLocaleString('en-GH',{minimumFractionDigits:2,maximumFractionDigits:2});}\nfunction num(n){return (Number(n)||0).toLocaleString('en-GH');}\nfunction ago(ms,now){var m=Math.max(0,Math.round((now-ms)/60000));if(m<1)return 'just now';if(m<60)return m+' min ago';var hr=Math.round(m/60);if(hr<24)return hr+' hr ago';return Math.round(hr/24)+' days ago';}\nfunction fresh(ms,now){if(!ms)return 'bad';var m=(now-ms)/60000;return m<=45?'ok':m<=180?'warn':'bad';}\nfunction when(iso){var d=new Date(iso);return isNaN(d)?'':d.toLocaleString('en-GH',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});}\nfunction shortDay(d){var x=new Date(d+'T12:00:00');return isNaN(x)?d.slice(5):x.toLocaleDateString('en-GH',{weekday:'narrow'});}\n\n// ── login ──\nfunction showLogin(msg){\n  clearInterval(S.timer);S.token='';sessionStorage.removeItem('vp_tok');\n  var acct=h('input',{class:'input',placeholder:'Account code',autocomplete:'username',autocapitalize:'characters',spellcheck:'false'});\n  var pw=h('input',{class:'input',type:'password',placeholder:'Password',autocomplete:'current-password'});\n  var err=h('div',{class:'err',text:msg||''});\n  var go=h('button',{class:'btn primary',text:'Sign in'});\n  function submit(){err.textContent='';go.disabled=true;\n    api('/api/login',{method:'POST',body:{account:acct.value,password:pw.value}}).then(function(r){go.disabled=false;\n      if(!r.ok){err.textContent=r.error||'Could not sign in.';return;}\n      S.token=r.token;sessionStorage.setItem('vp_tok',r.token);S.sel='all';load();\n    }).catch(function(){go.disabled=false;err.textContent='No internet connection.';});}\n  go.addEventListener('click',submit);pw.addEventListener('keydown',function(e){if(e.key==='Enter')submit();});\n  app.replaceChildren(h('div',{class:'login'},h('div',{class:'brand',text:'⚡ VOLT'},h('span',{text:'POS'})),h('h1',{text:'Shop dashboard'}),\n    h('div',{class:'muted',text:'Sign in to see how your shops are doing.'}),acct,pw,err,go));\n  acct.focus();\n}\n\n// ── data ──\nfunction load(){\n  api('/api/data').then(function(r){\n    if(r._status===401){showLogin('Please sign in again.');return;}\n    if(!r.ok){return;}\n    S.data=r;render();\n    clearInterval(S.timer);S.timer=setInterval(load,60000);\n  }).catch(function(){if(S.data){S.data.offline=true;render();}});\n}\n\n// ── aggregate across shops ──\nfunction sumSnap(shops,get){return shops.reduce(function(a,s){return a+(s.snapshot?(Number(get(s.snapshot))||0):0);},0);}\n\nfunction kpi(label,value,sub,cls){return h('div',{class:'card kpi'},h('div',{class:'l',text:label}),h('div',{class:'v '+(cls||''),text:value}),sub?h('div',{class:'s',text:sub}):null);}\n\nfunction periodCard(title,o,cur,fields){\n  var card=h('div',{class:'card'},h('div',{class:'muted',style:'font-size:12px;margin-bottom:6px',text:title}));\n  fields.forEach(function(f){var v=Number(o[f[1]])||0;\n    card.appendChild(h('div',{class:'prow'},h('span',{class:'muted',text:f[0]}),h('span',{class:'mono '+(f[1]==='profit'?(v>=0?'pos':'neg'):''),text:f[2]?num(v):money(v,cur)})));});\n  return card;\n}\nfunction renderAll(box,d){\n  var shops=d.shops,cur=(shops.find(function(s){return s.snapshot;})||{snapshot:{}}).snapshot.currency||'GH₵';\n  var rev=sumSnap(shops,function(x){return x.today.revenue;}),pr=sumSnap(shops,function(x){return x.today.profit;});\n  box.appendChild(h('h2',{text:'All shops — today'}));\n  box.appendChild(h('div',{class:'grid'},\n    kpi('Revenue',money(rev,cur),shops.length+' shops','acc'),\n    kpi('Profit',money(pr,cur),'after cost & expenses',pr>=0?'pos':'neg'),\n    kpi('Sales',num(sumSnap(shops,function(x){return x.today.sales;})),'transactions'),\n    kpi('Cash',money(sumSnap(shops,function(x){return x.today.cash;}),cur)),\n    kpi('MoMo / Card',money(sumSnap(shops,function(x){return x.today.digital;}),cur)),\n    kpi('Credit owed',money(sumSnap(shops,function(x){return x.outstandingCredit;}),cur),'all unpaid','neg')));\n  var tot=function(k){return{revenue:sumSnap(shops,function(x){return x[k].revenue;}),profit:sumSnap(shops,function(x){return x[k].profit;}),sales:sumSnap(shops,function(x){return x[k].sales;})};};\n  var fl=[['Revenue','revenue'],['Profit','profit'],['Sales','sales',1]];\n  box.appendChild(h('h2',{text:'Totals'}));\n  box.appendChild(h('div',{class:'grid2'},periodCard('Last 7 days',tot('d7'),cur,fl),periodCard('Last 30 days',tot('d30'),cur,fl)));\n  box.appendChild(h('h2',{text:'Each shop'}));\n  var tb=h('table');tb.appendChild(h('tr',null,h('th',{text:'Shop'}),h('th',{class:'r',text:'Today'}),h('th',{class:'r',text:'Profit'}),h('th',{text:'Updated'})));\n  shops.forEach(function(s){var sn=s.snapshot;\n    var tr=h('tr',{style:'cursor:pointer',onclick:function(){S.sel=s.id;render();}},\n      h('td',null,h('span',{class:'dot '+fresh(s.receivedAt,d.now)}),' ',s.name),\n      h('td',{class:'r',text:sn?money(sn.today.revenue,sn.currency):'—'}),\n      h('td',{class:'r',text:sn?money(sn.today.profit,sn.currency):'—'}),\n      h('td',{class:'muted',text:s.receivedAt?ago(s.receivedAt,d.now):'waiting'}));\n    tb.appendChild(tr);});\n  box.appendChild(h('div',{class:'card'},tb));\n}\n\nfunction listCard(title,rows,empty){return h('div',null,h('h2',{text:title}),h('div',{class:'card'},rows||h('div',{class:'empty',text:empty})));}\n\nfunction renderShop(box,s,d){\n  var sn=s.snapshot;\n  if(!sn){box.appendChild(h('div',{class:'card'},h('div',{class:'empty',text:'This shop has not sent any data yet. It will appear once the shop computer is online with Remote Dashboard switched on.'})));return;}\n  var cur=sn.currency||'GH₵',t=sn.today||{},d7=sn.d7||{},d30=sn.d30||{};\n  box.appendChild(h('h2',{text:'Today'}));\n  box.appendChild(h('div',{class:'grid'},\n    kpi('Revenue',money(t.revenue,cur),num(t.sales)+' sales','acc'),\n    kpi('Profit',money(t.profit,cur),'after cost & expenses',(t.profit||0)>=0?'pos':'neg'),\n    kpi('Cash',money(t.cash,cur)),kpi('MoMo / Card',money(t.digital,cur)),\n    kpi('Expenses',money(t.expenses,cur)),kpi('Credit owed',money(sn.outstandingCredit,cur),'all unpaid','neg')));\n  var fl=[['Revenue','revenue'],['Expenses','expenses'],['Profit','profit'],['Sales','sales',1]];\n  box.appendChild(h('div',{class:'grid2'},periodCard('Last 7 days',d7,cur,fl),periodCard('Last 30 days',d30,cur,fl)));\n\n  var days=Array.isArray(sn.days)?sn.days:[];\n  if(days.length){var max=Math.max.apply(null,days.map(function(x){return x.revenue||0;}).concat([1]));\n    var bars=h('div',{class:'bars'}),lbl=h('div',{class:'bl'});\n    days.forEach(function(x,i){var b=h('div',{class:'bar'+(i===days.length-1?' today':''),title:x.d+': '+money(x.revenue,cur)});b.style.height=Math.max(2,Math.round((x.revenue||0)/max*100))+'%';bars.appendChild(b);lbl.appendChild(h('span',{text:shortDay(x.d)}));});\n    box.appendChild(h('h2',{text:'Revenue, last '+days.length+' days'}));box.appendChild(h('div',{class:'card'},bars,lbl));}\n\n  var two=h('div',{class:'two'});\n  var rs=(sn.recentSales||[]).slice(0,15),rt=null;\n  if(rs.length){rt=h('table');rs.forEach(function(x){rt.appendChild(h('tr',null,\n    h('td',null,h('div',{text:x.customer||'Walk-in'}),h('div',{class:'muted',style:'font-size:11px',text:(x.id||'')+' · '+when(x.date)}),x.unpaid?h('span',{class:'badge cr',text:'credit'}):null),\n    h('td',{class:'r',text:money(x.total,cur)})));});}\n  two.appendChild(listCard('Recent sales',rt,'No sales yet.'));\n  var cc=(sn.creditCustomers||[]),ct=null;\n  if(cc.length){ct=h('table');cc.forEach(function(x){ct.appendChild(h('tr',null,h('td',{text:x.name}),h('td',{class:'r neg',text:money(x.amount,cur)})));});}\n  two.appendChild(listCard('Who owes money',ct,'No unpaid credit.'));\n  var ls=(sn.lowStock||[]),lt=null;\n  if(ls.length){lt=h('table');ls.forEach(function(x){lt.appendChild(h('tr',null,h('td',{text:x.name}),h('td',{class:'r '+(x.stock<=0?'neg':'acc'),text:x.stock<=0?'OUT':x.stock+' left'})));});\n    if(sn.lowCount>ls.length)lt.appendChild(h('tr',null,h('td',{class:'muted',text:'+'+(sn.lowCount-ls.length)+' more'}),h('td')));}\n  two.appendChild(listCard('Low stock'+(sn.outCount?' ('+sn.outCount+' sold out)':''),lt,'All products have enough stock.'));\n  var tp=(sn.topProducts||[]),tt=null;\n  if(tp.length){tt=h('table');tp.forEach(function(x){tt.appendChild(h('tr',null,h('td',{text:x.name}),h('td',{class:'r',text:num(x.qty)+' sold'})));});}\n  two.appendChild(listCard('Best sellers (30 days)',tt,'No sales in the last 30 days.'));\n  var ex=(sn.recentExpenses||[]),et=null;\n  if(ex.length){et=h('table');ex.forEach(function(x){et.appendChild(h('tr',null,h('td',null,h('div',{text:x.desc||x.cat}),h('div',{class:'muted',style:'font-size:11px',text:(x.cat||'')+' · '+x.date})),h('td',{class:'r',text:money(x.amount,cur)})));});}\n  two.appendChild(listCard('Recent expenses',et,'No expenses logged.'));\n  box.appendChild(two);\n}\n\nfunction render(){\n  var d=S.data;if(!d)return;\n  var multi=d.shops.length>1;if(!multi)S.sel=d.shops[0].id;\n  if(S.sel!=='all'&&!d.shops.some(function(s){return s.id===S.sel;}))S.sel=multi?'all':d.shops[0].id;\n  var root=h('div');\n  root.appendChild(h('div',{class:'top'},h('div',null,h('div',{class:'brand',text:'⚡ VOLT'},h('span',{text:'POS'})),h('div',{class:'who',text:d.name})),\n    h('div',null,h('button',{class:'btn',text:'Refresh',onclick:load}),' ',h('button',{class:'btn',text:'Sign out',onclick:function(){showLogin('');}}))));\n  if(multi||true){var tabs=h('div',{class:'tabs'});\n    if(multi)tabs.appendChild(h('button',{class:'tab'+(S.sel==='all'?' on':''),text:'All shops',onclick:function(){S.sel='all';render();}}));\n    d.shops.forEach(function(s){tabs.appendChild(h('button',{class:'tab'+(S.sel===s.id?' on':''),onclick:function(){S.sel=s.id;render();}},h('span',{class:'dot '+fresh(s.receivedAt,d.now)}),s.name));});\n    root.appendChild(tabs);}\n  var box=h('div');\n  if(d.offline)box.appendChild(h('div',{class:'card err',text:'You are offline. Showing the last data loaded.'}));\n  if(S.sel==='all')renderAll(box,d);\n  else{var s=d.shops.find(function(x){return x.id===S.sel;});\n    box.appendChild(h('div',{class:'status'},h('span',{class:'dot '+fresh(s.receivedAt,d.now)}),h('span',{text:s.receivedAt?'Updated '+ago(s.receivedAt,d.now)+' ('+when(new Date(s.receivedAt).toISOString())+')':'Waiting for the first update'}),\n      (s.receivedAt&&(d.now-s.receivedAt)/60000>180)?h('span',{class:'muted',text:'· the shop computer may be off or offline'}):null));\n    renderShop(box,s,d);}\n  root.appendChild(box);\n  root.appendChild(h('div',{class:'foot',text:'Numbers are sent by each shop when its computer is online. This page refreshes every minute.'}));\n  app.replaceChildren(root);\n}\n\nif(S.token)load();else showLogin('');\n})();\n</script>\n</body>\n</html>\n";

const enc = new TextEncoder();
const SESSION_TTL = 8 * 3600;
const MAX_BODY = 250 * 1024;
const MAX_FAILS = 8;
const PBKDF2_ITER = 100000; // Cloudflare's maximum
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 chars: no 0/O/1/I, and no modulo bias

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

const SEC = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' };
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...SEC },
});

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (s) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
function randomString(len) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = ''; for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % 32];
  return out;
}
async function pbkdf2(password, saltHex, iter) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const salt = Uint8Array.from(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256));
}
function safeEqual(a, b) { // constant-time string compare
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  let d = a.length ^ b.length; const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}
async function readJSON(request) {
  const text = await request.text();
  if (text.length > MAX_BODY) throw new HttpError(413, 'Too large');
  try { const v = JSON.parse(text || '{}'); if (v && typeof v === 'object') return v; } catch (e) {}
  throw new HttpError(400, 'Bad request');
}
const getAcct = async (env, code) => (/^[A-Z2-9]{6,16}$/.test(code) ? env.VOLT.get('acct:' + code, 'json') : null);
const cleanName = (v, max) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, max);

async function newPasswordRecord(password) {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  return { salt, iter: PBKDF2_ITER, hash: await pbkdf2(password, salt, PBKDF2_ITER) };
}

// ── A shop pushes its latest snapshot ──
async function push(request, env) {
  const code = (request.headers.get('X-Account') || '').toUpperCase();
  const shopId = request.headers.get('X-Shop') || '';
  const key = request.headers.get('X-Key') || '';
  const acct = await getAcct(env, code);
  const shop = acct && acct.shops.find((s) => s.id === shopId);
  const keyHash = await sha256(key);
  if (!shop || !safeEqual(keyHash, shop.keyHash)) throw new HttpError(401, 'Wrong account code, shop ID or key.');
  const snapshot = await readJSON(request);
  if (Array.isArray(snapshot)) throw new HttpError(400, 'Bad snapshot');
  const receivedAt = Date.now();
  await env.VOLT.put(`snap:${code}:${shop.id}`, JSON.stringify({ receivedAt, snapshot }));
  return json({ ok: true, receivedAt });
}

// ── The owner logs in ──
async function login(request, env) {
  const body = await readJSON(request);
  const code = String(body.account || '').trim().toUpperCase();
  const password = String(body.password || '');
  const failKey = 'fail:' + code;
  const fails = parseInt((await env.VOLT.get(failKey)) || '0', 10);
  if (fails >= MAX_FAILS) throw new HttpError(429, 'Too many attempts. Try again in 15 minutes.');
  const acct = await getAcct(env, code);
  // always do the slow hash so a wrong account code takes as long as a wrong password
  const attempt = acct ? await pbkdf2(password, acct.salt, acct.iter) : await pbkdf2(password, '00'.repeat(16), PBKDF2_ITER);
  if (!acct || !safeEqual(attempt, acct.hash)) {
    await env.VOLT.put(failKey, String(fails + 1), { expirationTtl: 900 });
    throw new HttpError(401, 'Wrong account code or password.');
  }
  await env.VOLT.delete(failKey);
  const token = randomString(40);
  await env.VOLT.put('sess:' + token, JSON.stringify({ code }), { expirationTtl: SESSION_TTL });
  return json({ ok: true, token, name: acct.name, shops: acct.shops.map(({ id, name }) => ({ id, name })) });
}

async function data(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const sess = token && /^[A-Z2-9]{40}$/.test(token) ? await env.VOLT.get('sess:' + token, 'json') : null;
  if (!sess) throw new HttpError(401, 'Please sign in again.');
  const acct = await getAcct(env, sess.code);
  if (!acct) throw new HttpError(401, 'Please sign in again.');
  const shops = await Promise.all(acct.shops.map(async (s) => {
    const rec = await env.VOLT.get(`snap:${sess.code}:${s.id}`, 'json');
    return { id: s.id, name: s.name, receivedAt: rec ? rec.receivedAt : null, snapshot: rec ? rec.snapshot : null };
  }));
  return json({ ok: true, name: acct.name, shops, now: Date.now() });
}

// ── You (the VoltPOS seller) manage accounts with ADMIN_TOKEN ──
async function admin(request, env, action) {
  const token = env.ADMIN_TOKEN;
  if (!token || token.length < 16) throw new HttpError(503, 'ADMIN_TOKEN is not set on the server.');
  if (!safeEqual(request.headers.get('X-Admin') || '', token)) throw new HttpError(401, 'Not allowed.');
  const b = await readJSON(request);

  if (action === 'account') {
    const name = cleanName(b.name, 60);
    const password = String(b.password || '');
    const shopNames = (Array.isArray(b.shops) ? b.shops : []).map((n) => cleanName(n, 60)).filter(Boolean).slice(0, 10);
    if (!name || password.length < 8 || !shopNames.length) throw new HttpError(400, 'Need name, password (8+ characters) and at least one shop.');
    let code; do { code = randomString(10); } while (await env.VOLT.get('acct:' + code));
    const shops = []; const keys = [];
    for (let i = 0; i < shopNames.length; i++) {
      const key = randomString(24);
      shops.push({ id: 's' + (i + 1), name: shopNames[i], keyHash: await sha256(key) });
      keys.push({ id: 's' + (i + 1), name: shopNames[i], key });
    }
    await env.VOLT.put('acct:' + code, JSON.stringify({ name, ...(await newPasswordRecord(password)), shops, created: Date.now() }));
    return json({ ok: true, account: code, shops: keys });
  }

  const code = String(b.account || '').trim().toUpperCase();
  const acct = await getAcct(env, code);
  if (!acct) throw new HttpError(404, 'No such account.');

  if (action === 'shop') {
    const name = cleanName(b.name, 60);
    if (!name) throw new HttpError(400, 'Shop name needed.');
    if (acct.shops.length >= 10) throw new HttpError(400, 'Too many shops.');
    const n = Math.max(0, ...acct.shops.map((s) => parseInt(s.id.slice(1), 10) || 0)) + 1;
    const key = randomString(24);
    acct.shops.push({ id: 's' + n, name, keyHash: await sha256(key) });
    await env.VOLT.put('acct:' + code, JSON.stringify(acct));
    return json({ ok: true, account: code, shop: { id: 's' + n, name, key } });
  }
  if (action === 'reset-password') {
    const password = String(b.password || '');
    if (password.length < 8) throw new HttpError(400, 'Password must be 8+ characters.');
    Object.assign(acct, await newPasswordRecord(password));
    await env.VOLT.put('acct:' + code, JSON.stringify(acct));
    await env.VOLT.delete('fail:' + code);
    return json({ ok: true });
  }
  if (action === 'delete-account') {
    await Promise.all(acct.shops.map((s) => env.VOLT.delete(`snap:${code}:${s.id}`)));
    await env.VOLT.delete('acct:' + code);
    return json({ ok: true });
  }
  throw new HttpError(404, 'Unknown action.');
}

async function route(request, env) {
  const { pathname } = new URL(request.url);
  const m = request.method;
  if (m === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    return new Response(VIEWER_HTML, { headers: {
      'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', ...SEC,
      'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'",
    } });
  }
  if (m === 'GET' && pathname === '/api/health') return json({ ok: true, service: 'voltpos-remote' });
  if (m === 'POST' && pathname === '/api/push') return push(request, env);
  if (m === 'POST' && pathname === '/api/login') return login(request, env);
  if (m === 'GET' && pathname === '/api/data') return data(request, env);
  if (m === 'POST' && pathname.startsWith('/api/admin/')) return admin(request, env, pathname.slice('/api/admin/'.length));
  return json({ ok: false, error: 'Not found' }, 404);
}

export default {
  async fetch(request, env) {
    try { return await route(request, env); }
    catch (e) {
      if (e instanceof HttpError) return json({ ok: false, error: e.message }, e.status);
      console.error(e);
      return json({ ok: false, error: 'Server error' }, 500);
    }
  },
};
