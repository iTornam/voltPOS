// VoltPOS Remote — Cloudflare Worker (one file: API + the owner's web page)
//
// Storage (Workers KV, binding "VOLT"):
//   acct:<CODE>            -> { name, salt, hash, iter, shops:[{id,name,keyHash}], created }
//   snap:<CODE>:<shopId>   -> { receivedAt, snapshot }      (latest snapshot only)
//   sess:<token>           -> { code }                      (expires after 8 hours)
//   chgq:<CODE>:<shopId>   -> [ change, ... ]               edits the OWNER asks for (only the owner's session writes this)
//   chgr:<CODE>:<shopId>   -> { <id>: {status,note,at} }    what the SHOP did with them (only the shop's key writes this)
//   fail:<CODE>            -> failed-login counter          (expires after 15 minutes)
// Secrets: ADMIN_TOKEN (wrangler secret) - needed to create accounts.
//
// What the shops send: totals, recent sales, stock levels. Never PINs, never phone numbers.

const VIEWER_HTML = "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n<meta name=\"robots\" content=\"noindex,nofollow\">\n<meta name=\"theme-color\" content=\"#0e1117\">\n<meta name=\"apple-mobile-web-app-capable\" content=\"yes\">\n<meta name=\"mobile-web-app-capable\" content=\"yes\">\n<meta name=\"apple-mobile-web-app-title\" content=\"VoltPOS\">\n<link rel=\"icon\" href=\"/icon.svg\" type=\"image/svg+xml\">\n<link rel=\"apple-touch-icon\" href=\"/icon.svg\">\n<link rel=\"manifest\" href=\"/manifest.json\">\n<title>VoltPOS Remote</title>\n<style>\n:root{--bg:#0e1117;--surface:#161b25;--surface2:#1e2533;--border:#2a3345;--text:#e8ecf4;--muted:#8592ad;--accent:#f5c400;--success:#3db87a;--danger:#e05252;--warn:#e8a33d;--font:system-ui,-apple-system,\"Segoe UI\",Roboto,sans-serif;--mono:ui-monospace,Menlo,Consolas,monospace}\n*{box-sizing:border-box;margin:0;padding:0}\nbody{background:var(--bg);color:var(--text);font-family:var(--font);font-size:14px;line-height:1.5;min-height:100vh}\nbutton,input{font-family:inherit;font-size:inherit;color:inherit}\n.wrap{max-width:980px;margin:0 auto;padding:14px}\n.brand{font-weight:700;letter-spacing:.04em;color:var(--accent)}.brand span{color:var(--muted)}\n.card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px}\n.btn{background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:8px 14px;cursor:pointer}\n.btn:hover{border-color:var(--accent)}.btn.primary{background:var(--accent);border-color:var(--accent);color:#111;font-weight:600}\n.input{width:100%;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:11px 12px}\n.input:focus{outline:none;border-color:var(--accent)}\n.muted{color:var(--muted)}.mono{font-family:var(--mono)}.err{color:var(--danger);min-height:20px;font-size:13px}\n/* login */\n.login{max-width:360px;margin:12vh auto 0;display:flex;flex-direction:column;gap:12px}\n.login h1{font-size:22px}\n/* top bar */\n.top{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;flex-wrap:wrap}\n.top .who{font-size:13px;color:var(--muted)}\n.tabs{display:flex;gap:8px;overflow-x:auto;padding-bottom:4px;margin-bottom:12px}\n.tab{white-space:nowrap;background:var(--surface);border:1px solid var(--border);border-radius:999px;padding:7px 14px;cursor:pointer;display:flex;align-items:center;gap:7px}\n.tab.on{border-color:var(--accent);color:var(--accent)}\n.dot{width:9px;height:9px;border-radius:50%;background:var(--muted);display:inline-block}\n.dot.ok{background:var(--success)}.dot.warn{background:var(--warn)}.dot.bad{background:var(--danger)}\n.status{display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:12px}\n/* grids */\n.grid{display:grid;gap:10px;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));margin-bottom:12px}\n.kpi .l{font-size:12px;color:var(--muted)}.kpi .v{font-family:var(--mono);font-size:20px;font-weight:600;margin-top:2px}.kpi .s{font-size:11px;color:var(--muted)}\n.pos{color:var(--success)}.neg{color:var(--danger)}.acc{color:var(--accent)}\nh2{font-size:13px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin:16px 0 8px}\n.two{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(300px,1fr))}\ntable{width:100%;border-collapse:collapse}\ntd,th{padding:7px 4px;border-bottom:1px solid var(--border);text-align:left;font-size:13px;vertical-align:top}\nth{color:var(--muted);font-weight:500;font-size:12px}td.r,th.r{text-align:right;font-family:var(--mono);white-space:nowrap}\ntr:last-child td{border-bottom:none}\n.badge{font-size:10px;border:1px solid var(--border);border-radius:999px;padding:1px 7px;color:var(--muted)}\n.badge.cr{border-color:var(--danger);color:var(--danger)}\n.bars{display:flex;align-items:flex-end;gap:5px;height:120px;padding-top:6px}\n.bar{flex:1;background:var(--accent);border-radius:4px 4px 0 0;min-height:2px;opacity:.9;position:relative}\n.bar.today{opacity:1;box-shadow:0 0 0 2px var(--accent)44}\n.bl{display:flex;gap:5px;font-size:10px;color:var(--muted);font-family:var(--mono);margin-top:4px}.bl span{flex:1;text-align:center}\n.grid2{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(230px,1fr))}\n.prow{display:flex;justify-content:space-between;gap:8px;padding:3px 0;font-size:13px}\n.alert{display:flex;gap:8px;align-items:flex-start;padding:9px 12px;border-radius:10px;border:1px solid var(--border);background:var(--surface);font-size:13px;margin-bottom:6px}\n.alert.bad{border-color:var(--danger)}.alert.warn{border-color:var(--warn)}.alert.good{border-color:var(--success);color:var(--success)}\n.chip{font-size:11px;border-radius:999px;padding:1px 8px;border:1px solid var(--border);color:var(--muted);font-family:var(--mono);margin-left:6px}\n.chip.up{color:var(--success);border-color:var(--success)}.chip.down{color:var(--danger);border-color:var(--danger)}\n.bar{cursor:pointer}.bar.sel{outline:2px solid var(--text);outline-offset:1px}\n.dayinfo{margin-top:10px;font-size:13px;display:flex;gap:14px;flex-wrap:wrap}.dayinfo b{font-family:var(--mono)}\n@media (prefers-color-scheme:light){\n :root{--bg:#f3f5f9;--surface:#ffffff;--surface2:#eef1f6;--border:#d6dce8;--text:#1b2230;--muted:#5b6882;--accent:#b88700;--success:#1f9d62;--danger:#c93c3c;--warn:#b9791a}\n .btn.primary{color:#fff}.bar{opacity:1}\n}\n.srow{padding:9px 2px;border-bottom:1px solid var(--border);cursor:pointer}.srow:last-child{border-bottom:none}\n.srow .top2{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}\n.srow .items{margin:8px 0 2px;padding:8px 10px;background:var(--surface2);border-radius:8px;font-size:12.5px}\n.srow .items div{display:flex;justify-content:space-between;gap:10px;padding:2px 0}\n.dayh{display:flex;justify-content:space-between;font-size:12px;color:var(--muted);font-weight:600;padding:10px 2px 4px;text-transform:uppercase;letter-spacing:.05em}\n.chips{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 8px}\n.chip2{border:1px solid var(--border);background:var(--surface2);border-radius:999px;padding:4px 12px;cursor:pointer;font-size:12px}.chip2.on{border-color:var(--accent);color:var(--accent)}\n.frow{display:flex;gap:6px;align-items:center;margin:6px 0;flex-wrap:wrap}.frow .lbl{width:100%;font-size:11px;color:var(--muted)}.frow .input{padding:8px 10px;min-width:0;flex:1}\n.imsg{font-size:13px;margin:0 0 8px}.imsg.ok{color:var(--success)}.imsg.bad{color:var(--danger)}\n.addbox{border:1px dashed var(--border);border-radius:10px;padding:10px;margin-bottom:10px}\n.empty{color:var(--muted);font-size:13px;padding:6px 0}\n.foot{margin:22px 0 8px;text-align:center;font-size:11px;color:var(--muted)}\n</style>\n</head>\n<body>\n<div class=\"wrap\" id=\"app\"></div>\n<script>\n(function(){\n'use strict';\nvar app=document.getElementById('app'),S={token:sessionStorage.getItem('vp_tok')||'',data:null,sel:'all',timer:null,hide:localStorage.getItem('vp_hide_profit')==='1',day:{},q:{},open:{},inv:{}};\n\n// tiny safe DOM builder: text is always set as text, never as HTML\nfunction h(tag,attrs){var e=document.createElement(tag);attrs=attrs||{};for(var k in attrs){if(k==='class')e.className=attrs[k];else if(k==='text')e.textContent=attrs[k];else if(k.slice(0,2)==='on')e.addEventListener(k.slice(2),attrs[k]);else e.setAttribute(k,attrs[k]);}\n  for(var i=2;i<arguments.length;i++){var c=arguments[i];if(c==null||c===false)continue;e.appendChild(typeof c==='object'?c:document.createTextNode(String(c)));}return e;}\nfunction api(path,opt){opt=opt||{};var hd={'Content-Type':'application/json'};if(S.token)hd.Authorization='Bearer '+S.token;\n  return fetch(path,{method:opt.method||'GET',headers:hd,body:opt.body?JSON.stringify(opt.body):undefined}).then(function(r){return r.json().then(function(j){j._status=r.status;return j;});});}\nfunction money(n,cur){n=Number(n)||0;return (cur||'GH₵')+' '+n.toLocaleString('en-GH',{minimumFractionDigits:2,maximumFractionDigits:2});}\nfunction pv(n,cur){return S.hide?'••••':money(n,cur);} // profit values respect the Hide-profit switch\nfunction num(n){return (Number(n)||0).toLocaleString('en-GH');}\nfunction ago(ms,now){var m=Math.max(0,Math.round((now-ms)/60000));if(m<1)return 'just now';if(m<60)return m+' min ago';var hr=Math.round(m/60);if(hr<24)return hr+' hr ago';return Math.round(hr/24)+' days ago';}\nfunction fresh(ms,now){if(!ms)return 'bad';var m=(now-ms)/60000;return m<=45?'ok':m<=180?'warn':'bad';}\nfunction when(iso){var d=new Date(iso);return isNaN(d)?'':d.toLocaleString('en-GH',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});}\nfunction shortDay(d){var x=new Date(d+'T12:00:00');return isNaN(x)?d.slice(5):x.toLocaleDateString('en-GH',{weekday:'narrow'});}\n\n// ── login ──\nfunction showLogin(msg){\n  clearInterval(S.timer);S.token='';sessionStorage.removeItem('vp_tok');\n  var acct=h('input',{class:'input',placeholder:'Account code',autocomplete:'username',autocapitalize:'characters',spellcheck:'false'});\n  var pw=h('input',{class:'input',type:'password',placeholder:'Password',autocomplete:'current-password'});\n  var err=h('div',{class:'err',text:msg||''});\n  var go=h('button',{class:'btn primary',text:'Sign in'});\n  function submit(){err.textContent='';go.disabled=true;\n    api('/api/login',{method:'POST',body:{account:acct.value,password:pw.value}}).then(function(r){go.disabled=false;\n      if(!r.ok){err.textContent=r.error||'Could not sign in.';return;}\n      S.token=r.token;sessionStorage.setItem('vp_tok',r.token);S.sel='all';load();\n    }).catch(function(){go.disabled=false;err.textContent='No internet connection.';});}\n  go.addEventListener('click',submit);pw.addEventListener('keydown',function(e){if(e.key==='Enter')submit();});\n  app.replaceChildren(h('div',{class:'login'},h('div',{class:'brand',text:'⚡ VOLT'},h('span',{text:'POS'})),h('h1',{text:'Shop dashboard'}),\n    h('div',{class:'muted',text:'Sign in to see how your shops are doing.'}),acct,pw,err,go));\n  acct.focus();\n}\n\n// ── data ──\nfunction load(auto){\n  api('/api/data').then(function(r){\n    if(r._status===401){showLogin('Please sign in again.');return;}\n    if(!r.ok){return;}\n    var ae=document.activeElement;\n    if(auto===true&&ae&&(ae.tagName==='INPUT'||ae.tagName==='SELECT'||ae.tagName==='TEXTAREA')){S.data=r;return;} // don't wipe a form while it is being filled in\n    S.data=r;render();\n    clearInterval(S.timer);S.timer=setInterval(function(){load(true);},60000);\n  }).catch(function(){if(S.data){S.data.offline=true;render();}});\n}\n\n// ── aggregate across shops ──\nfunction sumSnap(shops,get){return shops.reduce(function(a,s){return a+(s.snapshot?(Number(get(s.snapshot))||0):0);},0);}\n\nfunction kpi(label,value,sub,cls,extra){return h('div',{class:'card kpi'},h('div',{class:'l',text:label}),h('div',{class:'v '+(cls||''),text:value}),sub?h('div',{class:'s',text:sub}):null,extra||null);}\n\nfunction attention(shops,now){\n  var out=[],multi=shops.length>1;\n  shops.forEach(function(s){var nm=multi?s.name+': ':'';\n    if(!s.receivedAt){out.push({lv:'warn',t:nm+'has not sent any data yet.'});return;}\n    var m=(now-s.receivedAt)/60000;\n    if(m>180)out.push({lv:'bad',t:nm+'last update was '+ago(s.receivedAt,now)+'. The shop computer may be off or offline.'});\n    var sn=s.snapshot;if(!sn)return;\n    if(sn.outCount>0)out.push({lv:'warn',t:nm+num(sn.outCount)+(sn.outCount===1?' product is':' products are')+' sold out.'});\n    var lowOnly=(sn.lowCount||0)-(sn.outCount||0);\n    if(lowOnly>0)out.push({lv:'warn',t:nm+num(lowOnly)+' running low on stock.'});\n    if(sn.outstandingCredit>0){var n=(sn.creditCustomers||[]).length;out.push({lv:'info',t:nm+money(sn.outstandingCredit,sn.currency)+' owed by '+n+(n===1?' customer.':' customers.')});}\n  });\n  return out;\n}\nfunction attentionBox(list){\n  var box=h('div',{style:'margin-bottom:12px'},h('h2',{text:'Needs attention'}));\n  if(!list.length){box.appendChild(h('div',{class:'alert good',text:'✓ Nothing needs attention right now.'}));return box;}\n  list.forEach(function(a){box.appendChild(h('div',{class:'alert '+(a.lv==='info'?'':a.lv)},h('span',{text:a.lv==='bad'?'🔴':a.lv==='warn'?'🟠':'ℹ️'}),h('span',{text:a.t})));});\n  return box;\n}\nfunction periodCard(title,o,cur,fields){\n  var card=h('div',{class:'card'},h('div',{class:'muted',style:'font-size:12px;margin-bottom:6px',text:title}));\n  fields.forEach(function(f){var v=Number(o[f[1]])||0;\n    card.appendChild(h('div',{class:'prow'},h('span',{class:'muted',text:f[0]}),h('span',{class:'mono '+(f[1]==='profit'&&!S.hide?(v>=0?'pos':'neg'):''),text:f[2]?num(v):(f[1]==='profit'?pv(v,cur):money(v,cur))})));});\n  return card;\n}\nfunction renderAll(box,d){\n  var shops=d.shops,cur=(shops.find(function(s){return s.snapshot;})||{snapshot:{}}).snapshot.currency||'GH₵';\n  var rev=sumSnap(shops,function(x){return x.today.revenue;}),pr=sumSnap(shops,function(x){return x.today.profit;});\n  box.appendChild(attentionBox(attention(shops,d.now)));\n  box.appendChild(h('h2',{text:'All shops — today'}));\n  box.appendChild(h('div',{class:'grid'},\n    kpi('Revenue',money(rev,cur),shops.length+' shops','acc'),\n    kpi('Profit',pv(pr,cur),'after cost & expenses',S.hide?'':(pr>=0?'pos':'neg')),\n    kpi('Sales',num(sumSnap(shops,function(x){return x.today.sales;})),'transactions'),\n    kpi('Cash',money(sumSnap(shops,function(x){return x.today.cash;}),cur)),\n    kpi('MoMo / Card',money(sumSnap(shops,function(x){return x.today.digital;}),cur)),\n    kpi('Credit owed',money(sumSnap(shops,function(x){return x.outstandingCredit;}),cur),'all unpaid','neg')));\n  var tot=function(k){return{revenue:sumSnap(shops,function(x){return x[k].revenue;}),profit:sumSnap(shops,function(x){return x[k].profit;}),sales:sumSnap(shops,function(x){return x[k].sales;})};};\n  var fl=[['Revenue','revenue'],['Profit','profit'],['Sales','sales',1]];\n  box.appendChild(h('h2',{text:'Totals'}));\n  box.appendChild(h('div',{class:'grid2'},periodCard('Last 7 days',tot('d7'),cur,fl),periodCard('Last 30 days',tot('d30'),cur,fl)));\n  box.appendChild(h('h2',{text:'Each shop'}));\n  var tb=h('table');tb.appendChild(h('tr',null,h('th',{text:'Shop'}),h('th',{class:'r',text:'Today'}),h('th',{class:'r',text:'Profit'}),h('th',{text:'Updated'})));\n  shops.forEach(function(s){var sn=s.snapshot;\n    var tr=h('tr',{style:'cursor:pointer',onclick:function(){S.sel=s.id;render();}},\n      h('td',null,h('span',{class:'dot '+fresh(s.receivedAt,d.now)}),' ',s.name),\n      h('td',{class:'r',text:sn?money(sn.today.revenue,sn.currency):'—'}),\n      h('td',{class:'r',text:sn?pv(sn.today.profit,sn.currency):'—'}),\n      h('td',{class:'muted',text:s.receivedAt?ago(s.receivedAt,d.now):'waiting'}));\n    tb.appendChild(tr);});\n  box.appendChild(h('div',{class:'card'},tb));\n}\n\nfunction listCard(title,rows,empty){return h('div',null,h('h2',{text:title}),h('div',{class:'card'},rows||h('div',{class:'empty',text:empty})));}\n\nfunction invState(id){return S.inv[id]||(S.inv[id]={q:'',f:'all',open:null,more:false,add:false,d:{},a:{},ok:'',err:''});}\nfunction describeChange(c,cur){\n  if(c.type==='restock')return 'Restock +'+num(c.qty)+' × '+c.name;\n  if(c.type==='price')return 'Price of '+c.name+' → '+money(c.price,cur);\n  if(c.type==='low')return 'Low-stock level of '+c.name+' → '+num(c.low);\n  if(c.type==='add')return 'Add new product: '+c.name+' ('+money(c.price,cur)+', '+num(c.stock||0)+' in stock)';\n  return 'Change';\n}\nfunction inventorySection(sn,s,cur,d){\n  var box=h('div'),inv=sn.inventory;\n  box.appendChild(h('h2',{text:'Inventory'+(Array.isArray(inv)?' ('+num(sn.inventoryTotal||inv.length)+' products)':'')}));\n  if(!Array.isArray(inv)){box.appendChild(h('div',{class:'card'},h('div',{class:'empty',text:'This shop is running an older VoltPOS version. Update the shop app to see its inventory here and to send stock changes.'})));return box;}\n  var st=invState(s.id),card=h('div',{class:'card',id:'inv-card'}),list=h('div'),more=h('div',{style:'margin-top:8px'});\n  var stale=!s.receivedAt||(d.now-s.receivedAt)/60000>180;\n  function send(change,summary,done){\n    if(!window.confirm('Send to '+s.name+'?\\n\\n'+summary+'\\n\\nThe shop applies it when its computer is online, after someone there approves it (unless the shop applies changes automatically).'))return;\n    api('/api/changes',{method:'POST',body:{shop:s.id,change:change}}).then(function(r){\n      if(!r.ok){st.err=r.error||'Could not send.';st.ok='';}\n      else{st.ok='Sent to '+s.name+'. '+(stale?'The shop looks offline right now, so it will apply once the shop computer is back online.':'It will show as applied once the shop has dealt with it.');st.err='';if(done)done();}\n      load(false);\n    }).catch(function(){st.err='No internet connection.';st.ok='';render();});\n  }\n  if(st.ok)card.appendChild(h('div',{class:'imsg ok',text:st.ok}));\n  if(st.err)card.appendChild(h('div',{class:'imsg bad',text:st.err}));\n  var search=h('input',{class:'input',type:'search',placeholder:'Search name, category or barcode',autocomplete:'off',style:'margin-bottom:8px'});search.value=st.q;\n  var chips=h('div',{class:'chips'});\n  [['all','All'],['low','Low stock'],['out','Sold out']].forEach(function(f){chips.appendChild(h('button',{class:'chip2'+(st.f===f[0]?' on':''),text:f[1],onclick:function(){st.f=f[0];st.open=null;render();}}));});\n  chips.appendChild(h('button',{class:'chip2'+(st.add?' on':''),text:st.add?'✕ Close':'＋ Add product',onclick:function(){st.add=!st.add;render();}}));\n  card.appendChild(search);card.appendChild(chips);\n  if(st.add){\n    var a=st.a,cats=[];inv.forEach(function(p){if(p.cat&&cats.indexOf(p.cat)<0)cats.push(p.cat);});\n    var dl=h('datalist',{id:'cats-'+s.id});cats.forEach(function(c){dl.appendChild(h('option',{value:c}));});\n    function fld(key,ph,type,flex){var i=h('input',{class:'input',type:type||'text',placeholder:ph,autocomplete:'off',style:flex?'flex:'+flex:''});if(type==='number'){i.min='0';i.step='any';}i.value=a[key]||'';i.addEventListener('input',function(){a[key]=i.value;});return i;}\n    var cat=fld('cat','Category (e.g. General)');cat.setAttribute('list','cats-'+s.id);\n    var form=h('div',{class:'addbox'},h('div',{class:'muted',style:'font-size:12px;margin-bottom:4px',text:'New product for '+s.name}),dl,\n      h('div',{class:'frow'},fld('name','Product name *','text',2)),h('div',{class:'frow'},cat),\n      h('div',{class:'frow'},fld('price','Selling price *','number'),fld('cost','Cost price','number')),\n      h('div',{class:'frow'},fld('stock','Opening stock','number'),fld('low','Low-stock level','number'),fld('barcode','Barcode')));\n    form.appendChild(h('button',{class:'btn primary',text:'Send to shop',onclick:function(){\n      if(!String(a.name||'').trim()){st.err='Enter the product name.';st.ok='';render();return;}\n      if(a.price===undefined||a.price===''||isNaN(Number(a.price))){st.err='Enter the selling price.';st.ok='';render();return;}\n      send({type:'add',name:a.name,cat:a.cat,price:a.price,cost:a.cost,stock:a.stock,low:a.low,barcode:a.barcode},'Add new product: '+a.name+' at '+money(a.price,cur)+(a.stock?', '+a.stock+' in stock':''),function(){st.a={};st.add=false;});}}));\n    card.appendChild(form);\n  }\n  function editPanel(p){\n    var dd=st.d[p.id]||(st.d[p.id]={}),panel=h('div',{class:'items'});\n    panel.appendChild(h('div',null,h('span',{class:'muted',text:'Selling price'}),h('span',{class:'mono',text:money(p.price,cur)})));\n    panel.appendChild(h('div',null,h('span',{class:'muted',text:'Cost price'}),h('span',{class:'mono',text:pv(p.cost,cur)})));\n    panel.appendChild(h('div',null,h('span',{class:'muted',text:'Low-stock level'}),h('span',{class:'mono',text:num(p.low)})));\n    function inp(key,ph,step){var i=h('input',{class:'input',type:'number',min:'0',step:step||'any',placeholder:ph});i.value=dd[key]||'';i.addEventListener('input',function(){dd[key]=i.value;});return i;}\n    function btn(label,fn){return h('button',{class:'btn primary',text:label,onclick:fn});}\n    function bad(msg){st.err=msg;st.ok='';render();}\n    var base={product:p.id,name:p.name};\n    var qty=inp('qty','Add how many?','1'),rcost=inp('cost','New cost (optional)');\n    panel.appendChild(h('div',{class:'frow'},h('div',{class:'lbl',text:'Restock: add to the current '+num(p.stock)}),qty,rcost,btn('Send',function(){\n      var q=Number(dd.qty);if(!Number.isInteger(q)||q<1)return bad('Enter a whole number to add (1 or more).');\n      send(Object.assign({type:'restock',qty:q},base,dd.cost!==undefined&&dd.cost!==''?{cost:dd.cost}:{}),'Restock +'+q+' × '+p.name+' (now '+p.stock+')',function(){dd.qty='';dd.cost='';});})));\n    var price=inp('price','New selling price');\n    panel.appendChild(h('div',{class:'frow'},h('div',{class:'lbl',text:'Change the selling price'}),price,btn('Send',function(){\n      if(dd.price===undefined||dd.price===''||isNaN(Number(dd.price))||Number(dd.price)<0)return bad('Enter the new price.');\n      send(Object.assign({type:'price',price:dd.price},base),'Change the price of '+p.name+' from '+money(p.price,cur)+' to '+money(dd.price,cur),function(){dd.price='';});})));\n    var low=inp('low','New low-stock level','1');\n    panel.appendChild(h('div',{class:'frow'},h('div',{class:'lbl',text:'Change the low-stock level'}),low,btn('Send',function(){\n      var v=Number(dd.low);if(dd.low===undefined||dd.low===''||!Number.isInteger(v)||v<0)return bad('Enter a whole number (0 or more).');\n      send(Object.assign({type:'low',low:v},base),'Set the low-stock level of '+p.name+' to '+v,function(){dd.low='';});})));\n    return panel;\n  }\n  function paint(){\n    list.replaceChildren();more.replaceChildren();\n    var toks=st.q.toLowerCase().split(/\\s+/).filter(Boolean);\n    var rows=inv.filter(function(p){\n      if(st.f==='low'&&!(p.stock>0&&p.stock<=p.low))return false;\n      if(st.f==='out'&&!(p.stock<=0))return false;\n      if(!toks.length)return true;\n      var hay=(p.name+' '+p.cat+' '+p.barcode).toLowerCase();return toks.every(function(t){return hay.indexOf(t)>=0;});});\n    if(!rows.length){list.appendChild(h('div',{class:'empty',text:inv.length?'No products match.':'No products yet.'}));return;}\n    (st.more?rows:rows.slice(0,60)).forEach(function(p){\n      var open=st.open===p.id;\n      var row=h('div',{class:'srow'},h('div',{class:'top2',onclick:function(){st.open=open?null:p.id;paint();}},\n        h('div',null,h('div',{text:p.name}),h('div',{class:'muted',style:'font-size:11px',text:[p.cat,p.barcode].filter(Boolean).join(' · ')})),\n        h('div',{style:'text-align:right'},h('div',{class:'mono '+(p.stock<=0?'neg':p.stock<=p.low?'acc':''),text:p.stock<=0?'OUT':num(p.stock)+' in stock'}),h('div',{class:'muted mono',style:'font-size:11px',text:money(p.price,cur)}))));\n      if(open)row.appendChild(editPanel(p));\n      list.appendChild(row);});\n    if(!st.more&&rows.length>60)more.appendChild(h('button',{class:'btn',text:'Show all '+rows.length,onclick:function(){st.more=true;paint();}}));\n  }\n  search.addEventListener('input',function(){st.q=search.value;st.more=false;paint();});\n  paint();card.appendChild(list);card.appendChild(more);\n  if((sn.inventoryTotal||0)>inv.length)card.appendChild(h('div',{class:'muted',style:'font-size:12px;margin-top:8px',text:'Showing the first '+inv.length+' of '+sn.inventoryTotal+' products.'}));\n  box.appendChild(card);return box;\n}\nfunction changesSection(s,d,cur){\n  var list=s.changes||[];if(!list.length)return null;\n  var box=h('div');box.appendChild(h('h2',{text:'Your changes to '+s.name}));\n  var card=h('div',{class:'card'}),waiting=list.filter(function(c){return c.status==='pending';}).length;\n  if(waiting&&(!s.receivedAt||(d.now-s.receivedAt)/60000>180))card.appendChild(h('div',{class:'imsg bad',text:'The shop computer looks offline. '+waiting+' change'+(waiting===1?'':'s')+' will apply when it is back online.'}));\n  list.slice(0,15).forEach(function(c){\n    var chip=c.status==='pending'?['⏳ waiting for the shop','']:c.status==='applied'?['✓ applied','pos']:c.status==='rejected'?['✗ rejected by the shop','neg']:['⚠ failed','neg'];\n    card.appendChild(h('div',{class:'srow',style:'cursor:default'},h('div',{class:'top2'},\n      h('div',null,h('div',{text:describeChange(c,cur)}),h('div',{class:'muted',style:'font-size:11px',text:when(new Date(c.at).toISOString())+(c.note?' · '+c.note:'')})),\n      h('div',{class:chip[1],style:'font-size:12px;white-space:nowrap',text:chip[0]}))));});\n  box.appendChild(card);return box;\n}\n\nfunction dayKey(iso){var d=new Date(iso);return isNaN(d)?'':d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate();}\nfunction dayLabel(iso){var d=new Date(iso);if(isNaN(d))return '';var n=new Date(),y=new Date(n.getTime()-864e5);\n  if(dayKey(iso)===dayKey(n.toISOString()))return 'Today';if(dayKey(iso)===dayKey(y.toISOString()))return 'Yesterday';\n  return d.toLocaleDateString('en-GH',{weekday:'long',day:'numeric',month:'short'});}\nfunction clock(iso){var d=new Date(iso);return isNaN(d)?'':d.toLocaleTimeString('en-GH',{hour:'2-digit',minute:'2-digit'});}\nfunction salesSection(sn,cur,shopId){\n  var list=Array.isArray(sn.recentSales)?sn.recentSales:[];\n  var legacy=list.length&&typeof list[0].items==='number'; // shops on an older app only send a count\n  var box=h('div'),listBox=h('div'),note=h('div',{class:'muted',style:'font-size:12px;margin-top:8px'});\n  var search=h('input',{class:'input',type:'search',placeholder:'Search customer or product',autocomplete:'off',style:'margin-bottom:6px'});\n  search.value=S.q[shopId]||'';\n  function paint(){\n    var q=(S.q[shopId]||'').trim().toLowerCase();listBox.replaceChildren();\n    var shown=list.filter(function(x){if(!q)return true;\n      if(String(x.customer||'').toLowerCase().indexOf(q)>=0)return true;\n      return Array.isArray(x.items)&&x.items.some(function(i){return String(i.n).toLowerCase().indexOf(q)>=0;});});\n    if(!shown.length){listBox.appendChild(h('div',{class:'empty',text:list.length?'No sales match \"'+S.q[shopId]+'\".':'No sales in the last 7 days.'}));return;}\n    var lastDay=null,grp=null,tot=0,hd=null,sum=0;\n    function closeGroup(){if(hd)hd.lastChild.textContent=money(sum,cur);}\n    shown.forEach(function(x){var dk=dayKey(x.date);\n      if(dk!==lastDay){closeGroup();lastDay=dk;sum=0;hd=h('div',{class:'dayh'},h('span',{text:dayLabel(x.date)}),h('span',{text:''}));listBox.appendChild(hd);}\n      sum+=Number(x.total)||0;\n      var key=shopId+'|'+x.id,open=!!S.open[key],detailed=Array.isArray(x.items);\n      var row=h('div',{class:'srow',onclick:function(){if(!detailed)return;S.open[key]=!S.open[key];paint();}},\n        h('div',{class:'top2'},\n          h('div',null,h('div',{text:x.customer||'Walk-in'}),\n            h('div',{class:'muted',style:'font-size:11px',text:(x.id||'')+' · '+clock(x.date)+' · '+(x.payment||'')+' · '+(detailed?x.items.length+(x.more?'+'+x.more:'')+(x.items.length+x.more===1?' item':' items'):(x.items+(x.items===1?' item':' items')))}),\n            x.unpaid?h('span',{class:'badge cr',text:'credit unpaid'}):null),\n          h('div',{class:'mono',style:'white-space:nowrap',text:money(x.total,cur)+(detailed?(open?' ▾':' ▸'):'')})));\n      if(open&&detailed){var it=h('div',{class:'items'});\n        x.items.forEach(function(i){it.appendChild(h('div',null,h('span',{text:i.q+' × '+i.n}),h('span',{class:'mono muted',text:money(i.q*i.p,cur)})));});\n        if(x.more)it.appendChild(h('div',null,h('span',{class:'muted',text:'+ '+x.more+' more item'+(x.more===1?'':'s')}),h('span')));\n        if(x.discount>0)it.appendChild(h('div',null,h('span',{class:'muted',text:'Discount'}),h('span',{class:'mono muted',text:'− '+money(x.discount,cur)})));\n        row.appendChild(it);}\n      listBox.appendChild(row);});\n    closeGroup();\n  }\n  search.addEventListener('input',function(){S.q[shopId]=search.value;paint();});\n  paint();\n  var total7=typeof sn.salesCount7==='number'?sn.salesCount7:list.length;\n  note.textContent=legacy?'This shop is running an older VoltPOS version that sends only its last '+list.length+' sales. Update the shop app to see all 7 days with items.'\n    :(total7>list.length?'Showing the latest '+list.length+' of '+total7+' sales from the last 7 days.':'All '+list.length+' sale'+(list.length===1?'':'s')+' from the last 7 days.');\n  box.appendChild(h('h2',{text:'Sales: last 7 days'}));\n  box.appendChild(h('div',{class:'card',id:'sales-card'},search,listBox,note));\n  return box;\n}\n\nfunction renderShop(box,s,d){\n  var sn=s.snapshot;\n  if(!sn){box.appendChild(h('div',{class:'card'},h('div',{class:'empty',text:'This shop has not sent any data yet. It will appear once the shop computer is online with Remote Dashboard switched on.'})));return;}\n  var cur=sn.currency||'GH₵',t=sn.today||{},d7=sn.d7||{},d30=sn.d30||{};\n  box.appendChild(attentionBox(attention([s],d.now)));\n  var dl=Array.isArray(sn.days)?sn.days:[],yv=null;\n  if(dl.length>1&&dl[dl.length-1].d===t.date)yv=dl[dl.length-2].revenue;\n  var cmp=null;\n  if(yv!==null){var pct=yv>0?Math.round(((t.revenue||0)-yv)/yv*100):null;\n    cmp=h('div',{class:'s'},'Yesterday '+money(yv,cur),pct===null?null:h('span',{class:'chip '+(pct>=0?'up':'down'),text:(pct>=0?'▲ ':'▼ ')+Math.abs(pct)+'%'}));}\n  box.appendChild(h('h2',{text:'Today'}));\n  box.appendChild(h('div',{class:'grid'},\n    kpi('Revenue',money(t.revenue,cur),num(t.sales)+' sales','acc',cmp),\n    kpi('Profit',pv(t.profit,cur),'after cost & expenses',S.hide?'':((t.profit||0)>=0?'pos':'neg')),\n    kpi('Cash',money(t.cash,cur)),kpi('MoMo / Card',money(t.digital,cur)),\n    kpi('Expenses',money(t.expenses,cur)),kpi('Credit owed',money(sn.outstandingCredit,cur),'all unpaid','neg')));\n  var fl=[['Revenue','revenue'],['Expenses','expenses'],['Profit','profit'],['Sales','sales',1]];\n  box.appendChild(h('div',{class:'grid2'},periodCard('Last 7 days',d7,cur,fl),periodCard('Last 30 days',d30,cur,fl)));\n\n  var days=Array.isArray(sn.days)?sn.days:[];\n  if(days.length){var max=Math.max.apply(null,days.map(function(x){return x.revenue||0;}).concat([1]));\n    var sel=S.day[s.id];if(sel==null||sel<0||sel>=days.length)sel=days.length-1;\n    var bars=h('div',{class:'bars'}),lbl=h('div',{class:'bl'});\n    days.forEach(function(x,i){var b=h('div',{class:'bar'+(i===days.length-1?' today':'')+(i===sel?' sel':''),title:x.d,onclick:function(){S.day[s.id]=i;render();}});\n      b.style.height=Math.max(2,Math.round((x.revenue||0)/max*100))+'%';bars.appendChild(b);lbl.appendChild(h('span',{text:shortDay(x.d)}));});\n    var dd=days[sel],dn=new Date(dd.d+'T12:00:00'),dlabel=isNaN(dn)?dd.d:dn.toLocaleDateString('en-GH',{weekday:'short',day:'numeric',month:'short'});\n    var info=h('div',{class:'dayinfo'},h('span',{text:dlabel}),h('span',null,'Revenue ',h('b',{text:money(dd.revenue,cur)})),h('span',null,'Profit ',h('b',{text:pv(dd.profit,cur)})));\n    box.appendChild(h('h2',{text:'Revenue, last '+days.length+' days (tap a bar)'}));box.appendChild(h('div',{class:'card'},bars,lbl,info));}\n\n  box.appendChild(inventorySection(sn,s,cur,d));\n  var chg=changesSection(s,d,cur);if(chg)box.appendChild(chg);\n  box.appendChild(salesSection(sn,cur,s.id));\n  var two=h('div',{class:'two'});\n  var cc=(sn.creditCustomers||[]),ct=null;\n  if(cc.length){ct=h('table');cc.forEach(function(x){ct.appendChild(h('tr',null,h('td',{text:x.name}),h('td',{class:'r neg',text:money(x.amount,cur)})));});}\n  two.appendChild(listCard('Who owes money',ct,'No unpaid credit.'));\n  var ls=(sn.lowStock||[]),lt=null;\n  if(ls.length){lt=h('table');ls.forEach(function(x){lt.appendChild(h('tr',null,h('td',{text:x.name}),h('td',{class:'r '+(x.stock<=0?'neg':'acc'),text:x.stock<=0?'OUT':x.stock+' left'})));});\n    if(sn.lowCount>ls.length)lt.appendChild(h('tr',null,h('td',{class:'muted',text:'+'+(sn.lowCount-ls.length)+' more'}),h('td')));}\n  two.appendChild(listCard('Low stock'+(sn.outCount?' ('+sn.outCount+' sold out)':''),lt,'All products have enough stock.'));\n  var tp=(sn.topProducts||[]),tt=null;\n  if(tp.length){tt=h('table');tp.forEach(function(x){tt.appendChild(h('tr',null,h('td',{text:x.name}),h('td',{class:'r',text:num(x.qty)+' sold'})));});}\n  two.appendChild(listCard('Best sellers (30 days)',tt,'No sales in the last 30 days.'));\n  var ex=(sn.recentExpenses||[]),et=null;\n  if(ex.length){et=h('table');ex.forEach(function(x){et.appendChild(h('tr',null,h('td',null,h('div',{text:x.desc||x.cat}),h('div',{class:'muted',style:'font-size:11px',text:(x.cat||'')+' · '+x.date})),h('td',{class:'r',text:money(x.amount,cur)})));});}\n  two.appendChild(listCard('Recent expenses',et,'No expenses logged.'));\n  box.appendChild(two);\n}\n\nfunction render(){\n  var d=S.data;if(!d)return;\n  var multi=d.shops.length>1;if(!multi)S.sel=d.shops[0].id;\n  if(S.sel!=='all'&&!d.shops.some(function(s){return s.id===S.sel;}))S.sel=multi?'all':d.shops[0].id;\n  var root=h('div');\n  root.appendChild(h('div',{class:'top'},h('div',null,h('div',{class:'brand',text:'⚡ VOLT'},h('span',{text:'POS'})),h('div',{class:'who',text:d.name})),\n    h('div',null,h('button',{class:'btn',text:S.hide?'👁 Show profit':'🙈 Hide profit',onclick:function(){S.hide=!S.hide;localStorage.setItem('vp_hide_profit',S.hide?'1':'0');render();}}),' ',h('button',{class:'btn',text:'Refresh',onclick:function(){load(false);}}),' ',h('button',{class:'btn',text:'Sign out',onclick:function(){showLogin('');}}))));\n  if(multi||true){var tabs=h('div',{class:'tabs'});\n    if(multi)tabs.appendChild(h('button',{class:'tab'+(S.sel==='all'?' on':''),text:'All shops',onclick:function(){S.sel='all';render();}}));\n    d.shops.forEach(function(s){tabs.appendChild(h('button',{class:'tab'+(S.sel===s.id?' on':''),onclick:function(){S.sel=s.id;render();}},h('span',{class:'dot '+fresh(s.receivedAt,d.now)}),s.name));});\n    root.appendChild(tabs);}\n  var box=h('div');\n  if(d.offline)box.appendChild(h('div',{class:'card err',text:'You are offline. Showing the last data loaded.'}));\n  if(S.sel==='all')renderAll(box,d);\n  else{var s=d.shops.find(function(x){return x.id===S.sel;});\n    box.appendChild(h('div',{class:'status'},h('span',{class:'dot '+fresh(s.receivedAt,d.now)}),h('span',{text:s.receivedAt?'Updated '+ago(s.receivedAt,d.now)+' ('+when(new Date(s.receivedAt).toISOString())+')':'Waiting for the first update'}),\n      (s.receivedAt&&(d.now-s.receivedAt)/60000>180)?h('span',{class:'muted',text:'· the shop computer may be off or offline'}):null));\n    renderShop(box,s,d);}\n  root.appendChild(box);\n  root.appendChild(h('div',{class:'foot',text:'Numbers are sent by each shop when its computer is online. This page refreshes every minute.'}));\n  app.replaceChildren(root);\n}\n\nif(S.token)load();else showLogin('');\n})();\n</script>\n</body>\n</html>\n";

const ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="#0e1117"/><path d="M56 12 28 56h20l-4 32 28-44H52z" fill="#f5c400"/></svg>';
const MANIFEST = JSON.stringify({ name: 'VoltPOS Dashboard', short_name: 'VoltPOS', start_url: '/', display: 'standalone',
  background_color: '#0e1117', theme_color: '#0e1117', icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }] });

const enc = new TextEncoder();
const SESSION_TTL = 8 * 3600;
const MAX_BODY = 900 * 1024;
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
const CODE_RE = /^[A-Z0-9]{6,16}$/; // letters + digits only, 6 to 16 characters (the shop app checks the same rule)
const getAcct = async (env, code) => (CODE_RE.test(code) ? env.VOLT.get('acct:' + code, 'json') : null);
const cleanName = (v, max) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, max);

async function newPasswordRecord(password) {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  return { salt, iter: PBKDF2_ITER, hash: await pbkdf2(password, salt, PBKDF2_ITER) };
}

// ── Edits the owner asks for ──
const CHANGE_TYPES = ['restock', 'price', 'low', 'add'];
const MAX_PENDING = 100;
const cleanText = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const intIn = (v, lo, hi) => { const n = Number(v); return Number.isInteger(n) && n >= lo && n <= hi ? n : null; };
const numIn = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n * 100) / 100 : null; };

function cleanChange(c) {
  if (!c || typeof c !== 'object' || !CHANGE_TYPES.includes(c.type)) throw new HttpError(400, 'Unknown kind of change.');
  const out = { type: c.type };
  if (c.type !== 'add') {
    out.product = cleanText(c.product, 40);
    out.name = cleanText(c.name, 80); // shown to the shop; also used to find the product if its id changed
    if (!out.product && !out.name) throw new HttpError(400, 'Choose a product.');
  }
  if (c.type === 'restock') {
    out.qty = intIn(c.qty, 1, 100000); if (out.qty === null) throw new HttpError(400, 'Quantity must be a whole number from 1 to 100000.');
    if (c.cost !== undefined && c.cost !== null && c.cost !== '') { out.cost = numIn(c.cost, 0, 10000000); if (out.cost === null) throw new HttpError(400, 'Cost price looks wrong.'); }
  } else if (c.type === 'price') {
    out.price = numIn(c.price, 0, 10000000); if (out.price === null) throw new HttpError(400, 'Price looks wrong.');
  } else if (c.type === 'low') {
    out.low = intIn(c.low, 0, 100000); if (out.low === null) throw new HttpError(400, 'Low-stock level must be a whole number.');
  } else { // add
    out.name = cleanText(c.name, 80); if (!out.name) throw new HttpError(400, 'Enter the product name.');
    out.cat = cleanText(c.cat, 40) || 'General';
    out.price = numIn(c.price, 0, 10000000); if (out.price === null) throw new HttpError(400, 'Selling price looks wrong.');
    out.cost = c.cost === undefined || c.cost === null || c.cost === '' ? 0 : numIn(c.cost, 0, 10000000); if (out.cost === null) throw new HttpError(400, 'Cost price looks wrong.');
    out.stock = c.stock === undefined || c.stock === '' ? 0 : intIn(c.stock, 0, 100000); if (out.stock === null) throw new HttpError(400, 'Opening stock must be a whole number.');
    out.low = c.low === undefined || c.low === '' ? 5 : intIn(c.low, 0, 100000); if (out.low === null) throw new HttpError(400, 'Low-stock level must be a whole number.');
    out.barcode = cleanText(c.barcode, 40);
  }
  return out;
}
const sessionAcct = async (request, env) => {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const sess = token && /^[A-Z2-9]{40}$/.test(token) ? await env.VOLT.get('sess:' + token, 'json') : null;
  const acct = sess ? await getAcct(env, sess.code) : null;
  if (!acct) throw new HttpError(401, 'Please sign in again.');
  return { code: sess.code, acct };
};
async function shopAuth(request, env) { // a shop proves itself with its own key
  const code = (request.headers.get('X-Account') || '').toUpperCase();
  const shopId = request.headers.get('X-Shop') || '';
  const acct = await getAcct(env, code);
  const shop = acct && acct.shops.find((s) => s.id === shopId);
  if (!shop || !safeEqual(await sha256(request.headers.get('X-Key') || ''), shop.keyHash)) throw new HttpError(401, 'Wrong account code, shop ID or key.');
  return { code, shop };
}
const queueKey = (code, id) => `chgq:${code}:${id}`;
const resultKey = (code, id) => `chgr:${code}:${id}`;

// the owner asks for a change
async function createChange(request, env) {
  const { code, acct } = await sessionAcct(request, env);
  const b = await readJSON(request);
  const shop = acct.shops.find((s) => s.id === b.shop);
  if (!shop) throw new HttpError(404, 'No such shop.');
  const change = cleanChange(b.change);
  const queue = (await env.VOLT.get(queueKey(code, shop.id), 'json')) || [];
  const results = (await env.VOLT.get(resultKey(code, shop.id), 'json')) || {};
  const pending = queue.filter((c) => !results[c.id]).length;
  if (pending >= MAX_PENDING) throw new HttpError(429, 'This shop already has ' + MAX_PENDING + ' changes waiting. Wait for it to catch up.');
  const rec = { id: randomString(12), at: Date.now(), ...change };
  queue.push(rec);
  // tidy up: keep everything still waiting, plus the 60 most recent finished ones
  const fin = queue.filter((c) => results[c.id]);
  const drop = new Set(fin.slice(0, Math.max(0, fin.length - 60)).map((c) => c.id));
  await env.VOLT.put(queueKey(code, shop.id), JSON.stringify(queue.filter((c) => !drop.has(c.id))));
  return json({ ok: true, id: rec.id });
}
// the shop collects what is waiting for it
async function pullChanges(request, env) {
  const { code, shop } = await shopAuth(request, env);
  const queue = (await env.VOLT.get(queueKey(code, shop.id), 'json')) || [];
  const results = (await env.VOLT.get(resultKey(code, shop.id), 'json')) || {};
  return json({ ok: true, changes: queue.filter((c) => !results[c.id]).slice(0, 50) });
}
// the shop reports what it did
async function ackChanges(request, env) {
  const { code, shop } = await shopAuth(request, env);
  const b = await readJSON(request);
  const queue = (await env.VOLT.get(queueKey(code, shop.id), 'json')) || [];
  const known = new Set(queue.map((c) => c.id));
  const results = (await env.VOLT.get(resultKey(code, shop.id), 'json')) || {};
  let n = 0;
  for (const r of (Array.isArray(b.results) ? b.results : []).slice(0, 100)) {
    if (!r || !known.has(r.id) || results[r.id]) continue; // unknown id, or already settled: ignore
    if (!['applied', 'rejected', 'failed'].includes(r.status)) continue;
    results[r.id] = { status: r.status, note: cleanText(r.note, 120), at: Date.now() };
    n++;
  }
  const ids = Object.keys(results);
  if (ids.length > 200) ids.sort((a, z) => results[a].at - results[z].at).slice(0, ids.length - 200).forEach((i) => delete results[i]);
  await env.VOLT.put(resultKey(code, shop.id), JSON.stringify(results));
  return json({ ok: true, settled: n });
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
    const queue = (await env.VOLT.get(queueKey(sess.code, s.id), 'json')) || [];
    const results = (await env.VOLT.get(resultKey(sess.code, s.id), 'json')) || {};
    const changes = queue.slice(-40).reverse().map((c) => ({ ...c, status: results[c.id] ? results[c.id].status : 'pending', note: results[c.id] ? results[c.id].note : '', doneAt: results[c.id] ? results[c.id].at : null }));
    return { id: s.id, name: s.name, receivedAt: rec ? rec.receivedAt : null, snapshot: rec ? rec.snapshot : null, changes };
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
    let code = String(b.code || '').replace(/\s+/g, '').toUpperCase();
    if (code) {
      if (!CODE_RE.test(code)) throw new HttpError(400, 'Account code must be 6 to 16 letters and numbers only (no spaces or symbols).');
      if (await env.VOLT.get('acct:' + code)) throw new HttpError(409, 'That account code is already taken. Choose another.');
    } else {
      do { code = randomString(10); } while (await env.VOLT.get('acct:' + code));
    }
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
    await Promise.all(acct.shops.flatMap((s) => [env.VOLT.delete(`snap:${code}:${s.id}`), env.VOLT.delete(queueKey(code, s.id)), env.VOLT.delete(resultKey(code, s.id))]));
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
      'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'",
    } });
  }
  if (m === 'GET' && pathname === '/manifest.json') return new Response(MANIFEST, { headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=86400', ...SEC } });
  if (m === 'GET' && pathname === '/icon.svg') return new Response(ICON_SVG, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400', ...SEC } });
  if (m === 'GET' && pathname === '/api/health') return json({ ok: true, service: 'voltpos-remote' });
  if (m === 'POST' && pathname === '/api/push') return push(request, env);
  if (m === 'POST' && pathname === '/api/login') return login(request, env);
  if (m === 'POST' && pathname === '/api/changes') return createChange(request, env);
  if (m === 'POST' && pathname === '/api/pull') return pullChanges(request, env);
  if (m === 'POST' && pathname === '/api/ack') return ackChanges(request, env);
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
