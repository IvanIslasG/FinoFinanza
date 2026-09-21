const DEBTS_DB_NAME='FinoFinanzaDeudasDB';
const DEBTS_DB_VERSION=1;
const DEBTS_STORE='deudas';
const DEBT_PAYMENTS_STORE='pagos';

let debtsDb=null;
let debtView='active';
let editingDebtId=null;

const PEOPLE_KEY='finoFinanza.incomePeople';
const AI_TOKEN_KEY='finoFinanza.aiAccessToken';

const DEBT_TYPES=[
  'Préstamo personal','Hipoteca / FOVISSSTE','Crédito automotriz',
  'Tarjeta revolvente','Diferimiento con intereses','Préstamo informal','Otro'
];
const DEBT_STATUS=['Activa','Liquidada','Pausada'];

function esc(v=''){return String(v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));}
function money(v){return new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(Number(v||0));}
function today(){const d=new Date();const tz=d.getTimezoneOffset()*60000;return new Date(d-tz).toISOString().slice(0,10);}
function norm(v=''){return String(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();}
function personDisplayName(v){if(v==='Ivan')return 'Iván';if(v==='Yorsky')return 'Diana / Yorsky';return v||'—';}
function isFamilyMode(){return Boolean(localStorage.getItem(AI_TOKEN_KEY));}
function getPeople(){
  if(isFamilyMode())return ['Ivan','Yorsky'];
  try{const p=JSON.parse(localStorage.getItem(PEOPLE_KEY)||'[]');return Array.isArray(p)?[...new Set(p.map(x=>String(x||'').trim()).filter(Boolean))]:[];}catch{return []}
}

function openDebtsDb(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DEBTS_DB_NAME,DEBTS_DB_VERSION);
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains(DEBTS_STORE)){
        const s=db.createObjectStore(DEBTS_STORE,{keyPath:'id',autoIncrement:true});
        s.createIndex('status','status',{unique:false});s.createIndex('person','person',{unique:false});s.createIndex('creditor','creditor',{unique:false});
      }
      if(!db.objectStoreNames.contains(DEBT_PAYMENTS_STORE)){
        const s=db.createObjectStore(DEBT_PAYMENTS_STORE,{keyPath:'id',autoIncrement:true});
        s.createIndex('debtId','debtId',{unique:false});s.createIndex('date','date',{unique:false});
      }
    };
    req.onsuccess=()=>{debtsDb=req.result;resolve(debtsDb)};
    req.onerror=()=>reject(req.error);
  });
}
function storeAll(store){return new Promise((res,rej)=>{const r=debtsDb.transaction(store,'readonly').objectStore(store).getAll();r.onsuccess=()=>res(r.result||[]);r.onerror=()=>rej(r.error);});}
function debtGetAll(){return storeAll(DEBTS_STORE)}
function paymentGetAll(){return storeAll(DEBT_PAYMENTS_STORE)}
function debtGet(id){return new Promise((res,rej)=>{const r=debtsDb.transaction(DEBTS_STORE,'readonly').objectStore(DEBTS_STORE).get(Number(id));r.onsuccess=()=>res(r.result||null);r.onerror=()=>rej(r.error);});}
function debtAdd(x){return new Promise((res,rej)=>{const r=debtsDb.transaction(DEBTS_STORE,'readwrite').objectStore(DEBTS_STORE).add(x);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}
function debtPut(x){return new Promise((res,rej)=>{const r=debtsDb.transaction(DEBTS_STORE,'readwrite').objectStore(DEBTS_STORE).put(x);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}
function paymentAdd(x){return new Promise((res,rej)=>{const r=debtsDb.transaction(DEBT_PAYMENTS_STORE,'readwrite').objectStore(DEBT_PAYMENTS_STORE).add(x);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}
function paymentDelete(id){return new Promise((res,rej)=>{const r=debtsDb.transaction(DEBT_PAYMENTS_STORE,'readwrite').objectStore(DEBT_PAYMENTS_STORE).delete(Number(id));r.onsuccess=()=>res();r.onerror=()=>rej(r.error);});}
function debtDelete(id){
  return new Promise((resolve,reject)=>{
    const tx=debtsDb.transaction([DEBTS_STORE,DEBT_PAYMENTS_STORE],'readwrite');
    tx.objectStore(DEBTS_STORE).delete(Number(id));
    const idx=tx.objectStore(DEBT_PAYMENTS_STORE).index('debtId');
    const req=idx.openCursor(IDBKeyRange.only(Number(id)));
    req.onsuccess=()=>{const c=req.result;if(c){c.delete();c.continue();}};
    tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);
  });
}

function estimateDebt(balance,annualRate,monthlyPayment){
  const P=Number(balance||0),pay=Number(monthlyPayment||0),annual=Number(annualRate||0);
  if(P<=0)return {months:0,totalPaid:0,interest:0};
  if(pay<=0)return {months:null,totalPaid:null,interest:null};
  const r=annual>0?annual/100/12:0;
  if(r===0){const months=Math.ceil(P/pay);return {months,totalPaid:P,interest:0};}
  if(pay<=P*r)return {months:null,totalPaid:null,interest:null};
  const months=Math.ceil(-Math.log(1-r*P/pay)/Math.log(1+r));
  const totalPaid=months*pay;
  return {months,totalPaid,interest:Math.max(0,totalPaid-P)};
}
function progressPct(d){const o=Number(d.originalAmount||0),b=Number(d.balance||0);return o>0?Math.max(0,Math.min(100,(o-b)/o*100)):0;}
function toast(text){const el=document.getElementById('dToast');if(!el)return;el.textContent=text;el.classList.add('show');clearTimeout(toast._t);toast._t=setTimeout(()=>el.classList.remove('show'),2200);}

function injectDebtStyles(){
  if(document.getElementById('ff-deudas-styles'))return;
  const s=document.createElement('style');s.id='ff-deudas-styles';s.textContent=`
  #deudas .d-wrap{display:grid;gap:14px}#deudas .d-tabs{display:flex;gap:6px;padding:5px;background:#f2f4f7;border:1px solid #e4e7ec;border-radius:13px;width:max-content;max-width:100%}
  #deudas .d-tab{border:0;background:transparent;color:#667085;border-radius:9px;padding:9px 14px;font-size:11px;font-weight:900;cursor:pointer}#deudas .d-tab.active{background:#fff;color:#155eef;box-shadow:0 1px 3px rgba(16,24,40,.1)}
  #deudas .d-pane{display:none}#deudas .d-pane.active{display:grid;gap:14px}#deudas .d-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
  #deudas .d-stat{border:1px solid #e4e7ec;border-radius:14px;padding:14px;background:#fff}#deudas .d-stat.primary{background:#f8fbff;border-color:#b2ccff}#deudas .d-stat small{display:block;color:#667085;font-size:9px;text-transform:uppercase;font-weight:900;margin-bottom:6px}#deudas .d-stat strong{font-size:18px}
  #deudas .d-card{background:#fff;border:1px solid #e4e7ec;border-radius:16px;overflow:hidden}#deudas .d-head{padding:15px 17px;border-bottom:1px solid #e4e7ec;display:flex;justify-content:space-between;gap:12px;align-items:center}#deudas .d-head h3{margin:0;font-size:14px}#deudas .d-head small{color:#667085}#deudas .d-body{padding:16px}
  #deudas .d-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:11px}#deudas .d-field label{display:block;margin-bottom:5px;font-size:9px;font-weight:900;text-transform:uppercase;color:#667085}#deudas .d-field input,#deudas .d-field select,#deudas .d-field textarea{width:100%;box-sizing:border-box;border:1px solid #d0d5dd;border-radius:9px;padding:9px 10px;background:#fff;font-size:12px}#deudas .d-span2{grid-column:span 2}#deudas .d-span4{grid-column:1/-1}
  #deudas .d-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:14px;flex-wrap:wrap}#deudas .d-btn{border:1px solid #d0d5dd;border-radius:9px;background:#fff;padding:8px 11px;font-size:10px;font-weight:800;cursor:pointer}#deudas .d-btn.primary{background:#155eef;border-color:#155eef;color:#fff}#deudas .d-btn.danger{color:#b42318}
  #deudas .d-table-wrap{overflow:auto;border:1px solid #e4e7ec;border-radius:12px}#deudas table{width:100%;border-collapse:collapse;min-width:980px}#deudas th,#deudas td{padding:10px 9px;border-bottom:1px solid #eef2f6;text-align:left;font-size:11px}#deudas th{background:#f8fafc;color:#475467;text-transform:uppercase;font-size:9px}
  #deudas .d-pill{display:inline-flex;border:1px solid #d0d5dd;border-radius:999px;padding:3px 7px;font-size:9px;font-weight:900;background:#f8fafc}#deudas .d-pill.active{background:#ecfdf3;color:#067647;border-color:#abefc6}#deudas .d-pill.paused{background:#fffaeb;color:#b54708;border-color:#fedf89}#deudas .d-progress{height:7px;background:#f2f4f7;border-radius:999px;overflow:hidden;margin-top:5px}#deudas .d-progress span{display:block;height:100%;background:#155eef;border-radius:999px}
  #deudas .d-filters{display:grid;grid-template-columns:1.5fr repeat(3,minmax(140px,1fr));gap:8px;margin-bottom:10px}#deudas .d-filters>*{width:100%;box-sizing:border-box;border:1px solid #d0d5dd;border-radius:9px;padding:8px 9px;background:#fff}
  #deudas .d-health{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}#deudas .d-health-card{border:1px solid #e4e7ec;border-radius:12px;padding:12px;background:#fff}#deudas .d-health-card small{color:#667085;font-size:9px;text-transform:uppercase;font-weight:900}#deudas .d-health-card strong{display:block;margin-top:5px;font-size:15px}
  #deudas .d-empty{padding:28px;text-align:center;color:#667085}#deudas .d-toast{position:fixed;right:20px;bottom:20px;z-index:9999;padding:10px 13px;border-radius:10px;font-size:11px;font-weight:800;display:none}#deudas .d-toast.show{display:block;background:#ecfdf3;color:#067647;border:1px solid #abefc6}
  @media(max-width:900px){#deudas .d-summary{grid-template-columns:1fr 1fr}#deudas .d-grid{grid-template-columns:1fr 1fr}#deudas .d-filters{grid-template-columns:1fr 1fr}#deudas .d-health{grid-template-columns:1fr}}@media(max-width:560px){#deudas .d-summary,#deudas .d-grid,#deudas .d-filters{grid-template-columns:1fr}#deudas .d-span2,#deudas .d-span4{grid-column:auto}}`;
  document.head.appendChild(s);
}

function renderDebtShell(){
  const root=document.getElementById('deudas');if(!root)return;
  root.innerHTML=`
  <div class="topbar"><div><h2>Deudas</h2><p>Controla saldos, pagos, intereses y compromisos pendientes.</p></div></div>
  <div class="d-wrap">
    <div class="d-tabs"><button class="d-tab active" data-dview="active">Deudas activas</button><button class="d-tab" data-dview="payments">Pagos</button><button class="d-tab" data-dview="projection">Proyección</button></div>
    <section class="d-pane active" data-dpane="active">
      <div class="d-summary"><div class="d-stat primary"><small>Deuda total</small><strong id="dTotalDebt">$0.00</strong></div><div class="d-stat"><small>Pago mensual comprometido</small><strong id="dMonthlyCommitment">$0.00</strong></div><div class="d-stat"><small>Intereses estimados restantes</small><strong id="dEstimatedInterest">$0.00</strong></div><div class="d-stat"><small>Deudas activas</small><strong id="dActiveCount">0</strong></div></div>
      <section class="d-card"><div class="d-head"><div><h3 id="dFormTitle">Registrar deuda</h3><small>Captura el saldo actual aunque la deuda haya iniciado antes.</small></div></div><div class="d-body"><form id="debtForm"><div class="d-grid">
        <div class="d-field"><label>Persona responsable</label><select id="dPerson"></select></div><div class="d-field"><label>Tipo de deuda</label><select id="dType">${DEBT_TYPES.map(x=>`<option>${esc(x)}</option>`).join('')}</select></div><div class="d-field d-span2"><label>Acreedor / institución</label><input id="dCreditor" required></div>
        <div class="d-field"><label>Monto original</label><input id="dOriginal" type="number" min="0" step="0.01"></div><div class="d-field"><label>Saldo actual</label><input id="dBalance" type="number" min="0" step="0.01" required></div><div class="d-field"><label>Pago mensual</label><input id="dMonthly" type="number" min="0" step="0.01"></div><div class="d-field"><label>Tasa anual %</label><input id="dRate" type="number" min="0" step="0.01"></div>
        <div class="d-field"><label>Fecha de inicio</label><input id="dStart" type="date"></div><div class="d-field"><label>Fecha estimada de término</label><input id="dEnd" type="date"></div><div class="d-field"><label>Estado</label><select id="dStatus">${DEBT_STATUS.map(x=>`<option>${x}</option>`).join('')}</select></div><div class="d-field"><label>Día de pago</label><input id="dPaymentDay" type="number" min="1" max="31"></div>
        <div class="d-field d-span4"><label>Nota</label><textarea id="dNote"></textarea></div></div><div class="d-actions"><button class="d-btn" id="dCancelEdit" type="button" style="display:none">Cancelar edición</button><button class="d-btn primary" type="submit" id="dSave">Guardar deuda</button></div></form></div></section>
      <section class="d-card"><div class="d-head"><div><h3>Deudas registradas</h3><small>Saldo, pago mensual y avance.</small></div></div><div class="d-body"><div class="d-filters"><input id="dSearch" type="search" placeholder="Buscar acreedor, tipo o nota..."><select id="dFilterPerson"><option value="">Todas las personas</option></select><select id="dFilterType"><option value="">Todos los tipos</option>${DEBT_TYPES.map(x=>`<option>${esc(x)}</option>`).join('')}</select><select id="dFilterStatus"><option value="">Todos los estados</option>${DEBT_STATUS.map(x=>`<option>${x}</option>`).join('')}</select></div><div class="d-table-wrap"><table><thead><tr><th>Persona</th><th>Acreedor</th><th>Tipo</th><th>Saldo</th><th>Pago mensual</th><th>Tasa</th><th>Avance</th><th>Estado</th><th></th></tr></thead><tbody id="dDebtRows"></tbody></table></div></div></section>
    </section>
    <section class="d-pane" data-dpane="payments"><section class="d-card"><div class="d-head"><div><h3>Registrar pago</h3><small>Guarda abonos sin perder el historial.</small></div></div><div class="d-body"><form id="debtPaymentForm"><div class="d-grid"><div class="d-field d-span2"><label>Deuda</label><select id="dpDebt"></select></div><div class="d-field"><label>Fecha</label><input id="dpDate" type="date" required></div><div class="d-field"><label>Pago total</label><input id="dpAmount" type="number" min="0.01" step="0.01" required></div><div class="d-field"><label>Capital</label><input id="dpPrincipal" type="number" min="0" step="0.01"></div><div class="d-field"><label>Intereses</label><input id="dpInterest" type="number" min="0" step="0.01"></div><div class="d-field"><label>Comisiones</label><input id="dpFees" type="number" min="0" step="0.01"></div><div class="d-field"><label>Pago extraordinario</label><select id="dpExtra"><option value="false">No</option><option value="true">Sí</option></select></div><div class="d-field d-span4"><label>Nota</label><textarea id="dpNote"></textarea></div></div><div class="d-actions"><button class="d-btn primary" type="submit">Guardar pago</button></div></form></div></section><section class="d-card"><div class="d-head"><div><h3>Historial de pagos</h3><small>Capital, intereses y abonos extraordinarios.</small></div></div><div class="d-body"><div class="d-table-wrap"><table><thead><tr><th>Fecha</th><th>Deuda</th><th>Pago</th><th>Capital</th><th>Intereses</th><th>Comisiones</th><th>Tipo</th><th></th></tr></thead><tbody id="dPaymentRows"></tbody></table></div></div></section></section>
    <section class="d-pane" data-dpane="projection"><div class="d-health"><div class="d-health-card"><small>Saldo total pendiente</small><strong id="dProjBalance">$0.00</strong></div><div class="d-health-card"><small>Pago mensual actual</small><strong id="dProjMonthly">$0.00</strong></div><div class="d-health-card"><small>Meses ponderados estimados</small><strong id="dProjMonths">—</strong></div></div><section class="d-card"><div class="d-head"><div><h3>Proyección por deuda</h3><small>Estimación simple basada en saldo, tasa y pago mensual.</small></div></div><div class="d-body"><div class="d-table-wrap"><table><thead><tr><th>Acreedor</th><th>Saldo</th><th>Pago</th><th>Tasa</th><th>Meses estimados</th><th>Interés estimado restante</th><th>Pago total estimado</th></tr></thead><tbody id="dProjectionRows"></tbody></table></div></div></section></section>
  </div><div id="dToast" class="d-toast"></div>`;
}

function fillDebtPeople(){const people=getPeople();const a=document.getElementById('dPerson');const f=document.getElementById('dFilterPerson');if(a)a.innerHTML=people.map(p=>`<option value="${esc(p)}">${esc(personDisplayName(p))}</option>`).join('');if(f)f.innerHTML='<option value="">Todas las personas</option>'+people.map(p=>`<option value="${esc(p)}">${esc(personDisplayName(p))}</option>`).join('');}

function resetDebtForm(){editingDebtId=null;document.getElementById('debtForm')?.reset();fillDebtPeople();document.getElementById('dStatus').value='Activa';document.getElementById('dStart').value=today();document.getElementById('dFormTitle').textContent='Registrar deuda';document.getElementById('dSave').textContent='Guardar deuda';document.getElementById('dCancelEdit').style.display='none';}
async function saveDebt(e){e.preventDefault();const item={person:document.getElementById('dPerson').value,type:document.getElementById('dType').value,creditor:document.getElementById('dCreditor').value.trim(),originalAmount:Number(document.getElementById('dOriginal').value||0),balance:Number(document.getElementById('dBalance').value||0),monthlyPayment:Number(document.getElementById('dMonthly').value||0),annualRate:Number(document.getElementById('dRate').value||0),startDate:document.getElementById('dStart').value,endDate:document.getElementById('dEnd').value,status:document.getElementById('dStatus').value,paymentDay:Number(document.getElementById('dPaymentDay').value||0),note:document.getElementById('dNote').value.trim(),updatedAt:new Date().toISOString()};if(!item.person||!item.creditor||item.balance<0){alert('Completa persona, acreedor y saldo actual.');return;}if(editingDebtId){const old=await debtGet(editingDebtId);await debtPut({...old,...item,id:editingDebtId});toast('Deuda actualizada.');}else{await debtAdd({...item,createdAt:new Date().toISOString()});toast('Deuda guardada.');}resetDebtForm();await renderDebtAll();}
async function editDebt(id){const d=await debtGet(id);if(!d)return;editingDebtId=id;document.getElementById('dPerson').value=d.person||'';document.getElementById('dType').value=d.type||DEBT_TYPES[0];document.getElementById('dCreditor').value=d.creditor||'';document.getElementById('dOriginal').value=d.originalAmount||'';document.getElementById('dBalance').value=d.balance||'';document.getElementById('dMonthly').value=d.monthlyPayment||'';document.getElementById('dRate').value=d.annualRate||'';document.getElementById('dStart').value=d.startDate||'';document.getElementById('dEnd').value=d.endDate||'';document.getElementById('dStatus').value=d.status||'Activa';document.getElementById('dPaymentDay').value=d.paymentDay||'';document.getElementById('dNote').value=d.note||'';document.getElementById('dFormTitle').textContent='Editar deuda';document.getElementById('dSave').textContent='Guardar cambios';document.getElementById('dCancelEdit').style.display='';window.scrollTo({top:0,behavior:'smooth'});}

async function saveDebtPayment(e){e.preventDefault();const debtId=Number(document.getElementById('dpDebt').value||0);const d=await debtGet(debtId);if(!d){alert('Selecciona una deuda.');return;}const amount=Number(document.getElementById('dpAmount').value||0);let principal=Number(document.getElementById('dpPrincipal').value||0);const interest=Number(document.getElementById('dpInterest').value||0);const fees=Number(document.getElementById('dpFees').value||0);if(amount<=0){alert('Captura el monto del pago.');return;}if(principal<=0)principal=Math.max(0,amount-interest-fees);await paymentAdd({debtId,date:document.getElementById('dpDate').value||today(),amount,principal,interest,fees,extraordinary:document.getElementById('dpExtra').value==='true',note:document.getElementById('dpNote').value.trim(),createdAt:new Date().toISOString()});const newBalance=Math.max(0,Number(d.balance||0)-principal);await debtPut({...d,balance:newBalance,status:newBalance<=0?'Liquidada':d.status,updatedAt:new Date().toISOString()});document.getElementById('debtPaymentForm').reset();document.getElementById('dpDate').value=today();toast('Pago registrado.');await renderDebtAll();}

function renderDebtSummary(debts){const active=debts.filter(d=>d.status==='Activa');const total=active.reduce((s,d)=>s+Number(d.balance||0),0);const monthly=active.reduce((s,d)=>s+Number(d.monthlyPayment||0),0);const interest=active.reduce((s,d)=>s+Number(estimateDebt(d.balance,d.annualRate,d.monthlyPayment).interest||0),0);document.getElementById('dTotalDebt').textContent=money(total);document.getElementById('dMonthlyCommitment').textContent=money(monthly);document.getElementById('dEstimatedInterest').textContent=money(interest);document.getElementById('dActiveCount').textContent=String(active.length);}
function renderDebtTable(debts){const q=norm(document.getElementById('dSearch')?.value||''),person=document.getElementById('dFilterPerson')?.value||'',type=document.getElementById('dFilterType')?.value||'',status=document.getElementById('dFilterStatus')?.value||'';const rows=debts.filter(d=>(!person||d.person===person)&&(!type||d.type===type)&&(!status||d.status===status)&&(!q||norm([d.creditor,d.type,d.note,personDisplayName(d.person)].join(' ')).includes(q))).sort((a,b)=>Number(b.balance||0)-Number(a.balance||0));const body=document.getElementById('dDebtRows');if(!rows.length){body.innerHTML='<tr><td colspan="9"><div class="d-empty">Todavía no hay deudas registradas.</div></td></tr>';return;}body.innerHTML=rows.map(d=>{const pct=progressPct(d),pill=d.status==='Activa'?'active':d.status==='Pausada'?'paused':'';return `<tr><td>${esc(personDisplayName(d.person))}</td><td><strong>${esc(d.creditor)}</strong>${d.paymentDay?`<br><span style="color:#667085;font-size:9px">Pago día ${d.paymentDay}</span>`:''}</td><td>${esc(d.type)}</td><td><strong>${money(d.balance)}</strong>${d.originalAmount?`<br><span style="color:#667085;font-size:9px">Original ${money(d.originalAmount)}</span>`:''}</td><td>${money(d.monthlyPayment)}</td><td>${Number(d.annualRate||0).toFixed(2)}%</td><td style="min-width:130px">${pct.toFixed(0)}%<div class="d-progress"><span style="width:${pct}%"></span></div></td><td><span class="d-pill ${pill}">${esc(d.status)}</span></td><td><button class="d-btn" data-edit="${d.id}" type="button">Editar</button> <button class="d-btn danger" data-del="${d.id}" type="button">Eliminar</button></td></tr>`}).join('');body.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>editDebt(Number(b.dataset.edit)));body.querySelectorAll('[data-del]').forEach(b=>b.onclick=async()=>{if(!confirm('¿Eliminar esta deuda y su historial de pagos?'))return;await debtDelete(Number(b.dataset.del));toast('Deuda eliminada.');await renderDebtAll();});}
function renderPaymentDebtOptions(debts){const el=document.getElementById('dpDebt');const current=el.value;const active=debts.filter(d=>d.status!=='Liquidada');el.innerHTML='<option value="">Selecciona deuda</option>'+active.map(d=>`<option value="${d.id}">${esc(d.creditor)} · ${esc(personDisplayName(d.person))} · ${money(d.balance)}</option>`).join('');if(active.some(d=>String(d.id)===current))el.value=current;}
function renderPayments(debts,payments){const map=new Map(debts.map(d=>[Number(d.id),d]));const rows=[...payments].sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));const body=document.getElementById('dPaymentRows');if(!rows.length){body.innerHTML='<tr><td colspan="8"><div class="d-empty">Aún no hay pagos registrados.</div></td></tr>';return;}body.innerHTML=rows.map(p=>`<tr><td>${esc(p.date||'—')}</td><td>${esc(map.get(Number(p.debtId))?.creditor||'Deuda eliminada')}</td><td><strong>${money(p.amount)}</strong></td><td>${money(p.principal)}</td><td>${money(p.interest)}</td><td>${money(p.fees)}</td><td>${p.extraordinary?'<span class="d-pill">Extraordinario</span>':'Normal'}</td><td><button class="d-btn danger" data-pdel="${p.id}" type="button">Eliminar</button></td></tr>`).join('');body.querySelectorAll('[data-pdel]').forEach(b=>b.onclick=async()=>{if(!confirm('¿Eliminar este pago? El saldo no se recalculará automáticamente en esta primera versión.'))return;await paymentDelete(Number(b.dataset.pdel));toast('Pago eliminado.');await renderDebtAll();});}
function renderProjection(debts){const active=debts.filter(d=>d.status==='Activa'),body=document.getElementById('dProjectionRows');const totalBalance=active.reduce((s,d)=>s+Number(d.balance||0),0),totalMonthly=active.reduce((s,d)=>s+Number(d.monthlyPayment||0),0);let weighted=0,weight=0;if(!active.length){body.innerHTML='<tr><td colspan="7"><div class="d-empty">Registra una deuda activa para ver su proyección.</div></td></tr>';document.getElementById('dProjBalance').textContent=money(0);document.getElementById('dProjMonthly').textContent=money(0);document.getElementById('dProjMonths').textContent='—';return;}body.innerHTML=active.map(d=>{const e=estimateDebt(d.balance,d.annualRate,d.monthlyPayment);if(e.months){weighted+=e.months*Number(d.balance||0);weight+=Number(d.balance||0);}return `<tr><td><strong>${esc(d.creditor)}</strong></td><td>${money(d.balance)}</td><td>${money(d.monthlyPayment)}</td><td>${Number(d.annualRate||0).toFixed(2)}%</td><td>${e.months??'No calculable'}</td><td>${e.interest===null?'—':money(e.interest)}</td><td>${e.totalPaid===null?'—':money(e.totalPaid)}</td></tr>`}).join('');document.getElementById('dProjBalance').textContent=money(totalBalance);document.getElementById('dProjMonthly').textContent=money(totalMonthly);document.getElementById('dProjMonths').textContent=weight?`${Math.round(weighted/weight)} meses`:'—';}
async function renderDebtAll(){const [debts,payments]=await Promise.all([debtGetAll(),paymentGetAll()]);renderDebtSummary(debts);renderDebtTable(debts);renderPaymentDebtOptions(debts);renderPayments(debts,payments);renderProjection(debts);}
function switchDebtView(view){debtView=view;document.querySelectorAll('#deudas [data-dview]').forEach(b=>b.classList.toggle('active',b.dataset.dview===view));document.querySelectorAll('#deudas [data-dpane]').forEach(p=>p.classList.toggle('active',p.dataset.dpane===view));}
function bindDebtEvents(){document.querySelectorAll('#deudas [data-dview]').forEach(b=>b.onclick=()=>switchDebtView(b.dataset.dview));document.getElementById('debtForm').addEventListener('submit',saveDebt);document.getElementById('dCancelEdit').onclick=resetDebtForm;document.getElementById('debtPaymentForm').addEventListener('submit',saveDebtPayment);['dSearch','dFilterPerson','dFilterType','dFilterStatus'].forEach(id=>{const el=document.getElementById(id);el?.addEventListener(id==='dSearch'?'input':'change',async()=>renderDebtTable(await debtGetAll()));});}

export async function initDeudas(){injectDebtStyles();renderDebtShell();fillDebtPeople();bindDebtEvents();resetDebtForm();document.getElementById('dpDate').value=today();try{await openDebtsDb();await renderDebtAll();}catch(err){console.error(err);alert('No fue posible abrir el almacenamiento local del módulo Deudas.');}}
