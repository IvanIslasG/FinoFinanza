let gastosDB=null;
let editingGastoId=null;
let gastoViewType='corriente';
let gastoSort={key:'date',dir:'desc'};

const GASTOS_DB='FinoFinanzaGastosDB';
const GASTOS_STORE='gastos';

const PEOPLE_KEY='finoFinanza.incomePeople';
const AI_TOKEN_KEY='finoFinanza.aiAccessToken';
const CAT_PREFIX='finoFinanza.gastoCategorias.';
const CREDIT_CARDS_KEY='finoFinanza.creditCards';
const QUICK_TEMPLATES_KEY='finoFinanza.quickExpenseTemplates';
const LEGACY_FIXED_TEMPLATES_KEY='finoFinanza.fixedExpenseTemplates';

const BASE_CATEGORIES={
  fijo:[
    'Renta / Hipoteca','Internet','Telefonía','Electricidad','Agua','Gas',
    'Colegiatura','Seguros','Suscripciones','Cuotas / Membresías','Otro'
  ],
  corriente:[
    'Supermercado','Comida fuera','Transporte','Gasolina','Salud / Farmacia',
    'Ropa y calzado','Bebé / Niños','Mascotas','Entretenimiento','Hogar',
    'Cuidado personal','Regalos','Educación','Trámites','Imprevistos','Otro'
  ],
  manutencion:[
    'Casa','Automóvil','Electrodomésticos','Muebles','Jardín','Mascotas',
    'Equipo / Tecnología','Reparaciones','Refacciones','Servicio preventivo','Otro'
  ]
};

const PAYMENT_METHODS=[
  'Efectivo','Tarjeta de débito','Tarjeta de crédito','Transferencia',
  'Domiciliación','Vales','Otro'
];

function esc(s=''){
  return String(s).replace(/[&<>"']/g,m=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[m]));
}
function norm(s=''){
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
}
function money(n){
  return Number(n||0).toLocaleString('es-MX',{style:'currency',currency:'MXN'});
}
function today(){
  const d=new Date();
  const tz=d.getTimezoneOffset()*60000;
  return new Date(d-tz).toISOString().slice(0,10);
}
function fmtDate(s){
  if(!s)return '—';
  const [y,m,d]=String(s).split('-');
  return `${d}/${m}/${y}`;
}
function typeLabel(t){
  return t==='fijo'?'Fijo':t==='manutencion'?'Manutención':'Corriente';
}
function personLabel(v){
  if(v==='Ivan')return 'Iván';
  if(v==='Yorsky')return 'Diana / Yorsky';
  return v||'—';
}
function unique(values){
  return [...new Set((values||[]).map(x=>String(x||'').trim()).filter(Boolean))];
}
function isFamilyMode(){
  return Boolean(localStorage.getItem(AI_TOKEN_KEY));
}
function getPeople(){
  if(isFamilyMode())return ['Ivan','Yorsky'];
  try{
    const p=JSON.parse(localStorage.getItem(PEOPLE_KEY)||'[]');
    return unique(Array.isArray(p)?p:[]);
  }catch{return []}
}
function savePeople(v){
  localStorage.setItem(PEOPLE_KEY,JSON.stringify(unique(v)));
}
function catKey(type){return CAT_PREFIX+type}
function getCategories(type){
  try{
    const local=JSON.parse(localStorage.getItem(catKey(type))||'[]');
    return unique([...(Array.isArray(local)?local:[]),...BASE_CATEGORIES[type]]);
  }catch{
    return [...BASE_CATEGORIES[type]];
  }
}
function saveCategories(type,values){
  localStorage.setItem(catKey(type),JSON.stringify(unique(values)));
}

function getCreditCards(){
  try{
    const cards=JSON.parse(localStorage.getItem(CREDIT_CARDS_KEY)||'[]');
    return unique(Array.isArray(cards)?cards:[]);
  }catch{return []}
}
function saveCreditCards(values){
  localStorage.setItem(CREDIT_CARDS_KEY,JSON.stringify(unique(values)));
}


const DEFAULT_QUICK_TEMPLATES=[
  {name:'Spotify',type:'fijo',category:'Suscripciones',description:'Spotify',paymentMethod:'Tarjeta de crédito',creditCard:''},
  {name:'Netflix',type:'fijo',category:'Suscripciones',description:'Netflix',paymentMethod:'Tarjeta de crédito',creditCard:''},
  {name:'Internet',type:'fijo',category:'Internet',description:'Servicio de internet',paymentMethod:'Transferencia',creditCard:''},
  {name:'Luz',type:'fijo',category:'Electricidad',description:'Servicio de electricidad',paymentMethod:'Transferencia',creditCard:''},
  {name:'ChatGPT',type:'fijo',category:'Suscripciones',description:'ChatGPT',paymentMethod:'Tarjeta de crédito',creditCard:''},
  {name:'Telcel',type:'fijo',category:'Telefonía',description:'Telcel',paymentMethod:'Tarjeta de crédito',creditCard:''},
  {name:'Gasolina',type:'corriente',category:'Gasolina',description:'Gasolina',paymentMethod:'Tarjeta de crédito',creditCard:''}
];

function normalizeQuickTemplate(t){
  return {
    name:String(t?.name||'').trim(),
    type:['fijo','corriente','manutencion'].includes(t?.type)?t.type:'fijo',
    category:String(t?.category||'Otro').trim()||'Otro',
    description:String(t?.description||t?.name||'').trim(),
    paymentMethod:String(t?.paymentMethod||'Efectivo'),
    creditCard:String(t?.creditCard||'')
  };
}
function getQuickTemplates(){
  try{
    const saved=JSON.parse(localStorage.getItem(QUICK_TEMPLATES_KEY)||'null');
    if(Array.isArray(saved)&&saved.length)return saved.map(normalizeQuickTemplate);
  }catch{}

  // Migra automáticamente las plantillas v1.2 si existían.
  try{
    const legacy=JSON.parse(localStorage.getItem(LEGACY_FIXED_TEMPLATES_KEY)||'null');
    if(Array.isArray(legacy)&&legacy.length){
      const migrated=legacy.map(t=>normalizeQuickTemplate({...t,type:'fijo'}));
      // Agrega Telcel y Gasolina si aún no existen.
      for(const base of DEFAULT_QUICK_TEMPLATES){
        if(!migrated.some(x=>norm(x.name)===norm(base.name)))migrated.push(base);
      }
      localStorage.setItem(QUICK_TEMPLATES_KEY,JSON.stringify(migrated));
      return migrated;
    }
  }catch{}

  localStorage.setItem(QUICK_TEMPLATES_KEY,JSON.stringify(DEFAULT_QUICK_TEMPLATES));
  return [...DEFAULT_QUICK_TEMPLATES];
}
function saveQuickTemplates(values){
  localStorage.setItem(QUICK_TEMPLATES_KEY,JSON.stringify(values.map(normalizeQuickTemplate)));
}
function addQuickTemplate(){
  const name=prompt('Nombre del acceso rápido (ej. Telcel, Gasolina, Spotify):');
  if(!name?.trim())return;

  const rawType=prompt('Tipo: fijo, corriente o manutencion','fijo');
  const type=norm(rawType).startsWith('corr')?'corriente':
    norm(rawType).startsWith('manut')?'manutencion':'fijo';

  const category=prompt('Categoría:', type==='corriente'?'Otro':'Suscripciones');
  if(!category?.trim())return;

  const template={
    name:name.trim(),
    type,
    category:category.trim(),
    description:name.trim(),
    paymentMethod:'Efectivo',
    creditCard:''
  };
  const list=getQuickTemplates();
  list.push(template);
  saveQuickTemplates(list);
  saveCategories(type,[...getCategories(type),template.category]);
  renderQuickTemplates();
  fillFilterCategories();
}
function deleteQuickTemplate(index){
  const list=getQuickTemplates();
  const item=list[index];
  if(!item)return;
  if(!confirm(`¿Eliminar el acceso rápido "${item.name}"?`))return;
  list.splice(index,1);
  saveQuickTemplates(list);
  renderQuickTemplates();
}
function useQuickTemplate(index){
  const t=getQuickTemplates()[index];
  if(!t)return;

  setFormType(t.type);
  fillCategories(t.type,t.category);
  document.getElementById('gDescription').value=t.description||t.name||'';
  document.getElementById('gPayment').value=t.paymentMethod||'Efectivo';
  updatePaymentUI(t.creditCard||'');
  document.getElementById('gDate').value=today();
  document.getElementById('gAmount').value='';
  document.getElementById('gAmount').focus();
  document.getElementById('gastoForm').scrollIntoView({behavior:'smooth',block:'start'});
}
function renderQuickTemplates(){
  const wrap=document.getElementById('gQuickTemplates');
  if(!wrap)return;
  const list=getQuickTemplates();

  wrap.innerHTML=list.map((t,i)=>`
    <button class="g-fixed-card" type="button" data-quick-template="${i}">
      <div class="g-fixed-icon">${t.type==='corriente'?'↗':t.type==='manutencion'?'⌂':'▣'}</div>
      <div class="g-fixed-main">
        <strong>${esc(t.name)}</strong>
        <small>${esc(typeLabel(t.type))} · ${esc(t.category)}</small>
      </div>
      <span class="g-fixed-arrow">›</span>
      <span class="g-fixed-delete" data-delete-quick="${i}" title="Eliminar acceso rápido">×</span>
    </button>
  `).join('') + `
    <button class="g-fixed-card g-fixed-add" id="gAddQuickTemplate" type="button">
      <div class="g-fixed-icon">＋</div>
      <div class="g-fixed-main"><strong>Nuevo acceso</strong><small>Crear gasto rápido</small></div>
    </button>
  `;

  wrap.querySelectorAll('[data-quick-template]').forEach(btn=>{
    btn.addEventListener('click',e=>{
      if(e.target.closest('[data-delete-quick]'))return;
      useQuickTemplate(Number(btn.dataset.quickTemplate));
    });
  });
  wrap.querySelectorAll('[data-delete-quick]').forEach(btn=>{
    btn.addEventListener('click',e=>{
      e.stopPropagation();
      deleteQuickTemplate(Number(btn.dataset.deleteQuick));
    });
  });
  document.getElementById('gAddQuickTemplate')?.addEventListener('click',addQuickTemplate);
}
function fillCreditCards(selected=''){
  const sel=document.getElementById('gCreditCard');
  if(!sel)return;
  const cards=getCreditCards();
  sel.innerHTML='<option value="">Selecciona tarjeta</option>'+
    cards.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('');
  if(selected&&cards.includes(selected))sel.value=selected;
}
function updatePaymentUI(selectedCard=''){
  const method=document.getElementById('gPayment')?.value||'';
  const cardField=document.getElementById('gCreditCardField');
  const accountField=document.getElementById('gAccountField');
  const isCredit=method==='Tarjeta de crédito';
  if(cardField)cardField.style.display=isCredit?'':'none';
  if(accountField)accountField.style.display=isCredit?'none':'';
  if(isCredit)fillCreditCards(selectedCard);
}
function addCreditCard(){
  const name=prompt('Nombre de la tarjeta de crédito:');
  if(!name?.trim())return;
  const value=name.trim();
  saveCreditCards([...getCreditCards(),value]);
  fillCreditCards(value);
}

function openGastosDB(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(GASTOS_DB,1);
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains(GASTOS_STORE)){
        const store=db.createObjectStore(GASTOS_STORE,{keyPath:'id',autoIncrement:true});
        store.createIndex('date','date');
        store.createIndex('type','type');
        store.createIndex('person','person');
      }
    };
    req.onsuccess=()=>{gastosDB=req.result;resolve(gastosDB)};
    req.onerror=()=>reject(req.error);
  });
}
function dbGetAll(){
  return new Promise((res,rej)=>{
    const r=gastosDB.transaction(GASTOS_STORE,'readonly').objectStore(GASTOS_STORE).getAll();
    r.onsuccess=()=>res(r.result||[]);
    r.onerror=()=>rej(r.error);
  });
}
function dbGet(id){
  return new Promise((res,rej)=>{
    const r=gastosDB.transaction(GASTOS_STORE,'readonly').objectStore(GASTOS_STORE).get(id);
    r.onsuccess=()=>res(r.result);
    r.onerror=()=>rej(r.error);
  });
}
function dbAdd(item){
  return new Promise((res,rej)=>{
    const r=gastosDB.transaction(GASTOS_STORE,'readwrite').objectStore(GASTOS_STORE).add(item);
    r.onsuccess=()=>res(r.result);
    r.onerror=()=>rej(r.error);
  });
}
function dbPut(item){
  return new Promise((res,rej)=>{
    const r=gastosDB.transaction(GASTOS_STORE,'readwrite').objectStore(GASTOS_STORE).put(item);
    r.onsuccess=()=>res(r.result);
    r.onerror=()=>rej(r.error);
  });
}
function dbDelete(id){
  return new Promise((res,rej)=>{
    const r=gastosDB.transaction(GASTOS_STORE,'readwrite').objectStore(GASTOS_STORE).delete(id);
    r.onsuccess=()=>res();
    r.onerror=()=>rej(r.error);
  });
}

function injectStyles(){
  if(document.getElementById('ff-gastos-styles'))return;
  const s=document.createElement('style');
  s.id='ff-gastos-styles';
  s.textContent=`
    #gastos .g-wrap{display:grid;gap:14px}
    #gastos .g-tabs{display:flex;gap:7px;flex-wrap:wrap}
    #gastos .g-fixed-section{background:#fff;border:1px solid #b2ccff;border-radius:16px;padding:16px;box-shadow:0 1px 2px rgba(16,24,40,.04)}
    #gastos .g-fixed-title{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:12px}
    #gastos .g-fixed-title h3{margin:0;font-size:14px}
    #gastos .g-fixed-title small{color:#667085}
    #gastos .g-fixed-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:9px}
    #gastos .g-fixed-card{position:relative;display:flex;align-items:center;gap:10px;text-align:left;border:1px solid #e4e7ec;background:#fff;border-radius:12px;padding:12px;cursor:pointer;min-height:68px}
    #gastos .g-fixed-card:hover{background:#f8fbff;border-color:#b2ccff}
    #gastos .g-fixed-icon{width:32px;height:32px;border-radius:9px;background:#eef4ff;color:#155eef;display:grid;place-items:center;font-weight:900;flex:0 0 auto}
    #gastos .g-fixed-main{flex:1;min-width:0}
    #gastos .g-fixed-main strong{display:block;font-size:12px;color:#101828;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #gastos .g-fixed-main small{display:block;margin-top:3px;color:#667085;font-size:9px}
    #gastos .g-fixed-arrow{color:#98a2b3;font-size:18px}
    #gastos .g-fixed-delete{position:absolute;right:6px;top:4px;color:#98a2b3;font-size:13px}
    #gastos .g-fixed-delete:hover{color:#b42318}
    #gastos .g-fixed-add{border-style:dashed}

    #gastos .g-tab{border:1px solid #d0d5dd;background:#fff;color:#344054;border-radius:10px;padding:9px 14px;font-size:11px;font-weight:800;cursor:pointer}
    #gastos .g-tab.active{background:#eff4ff;border-color:#b2ccff;color:#155eef}
    #gastos .g-card{background:#fff;border:1px solid #e4e7ec;border-radius:16px;overflow:hidden}
    #gastos .g-head{padding:16px 18px;border-bottom:1px solid #e4e7ec;display:flex;justify-content:space-between;gap:12px;align-items:center}
    #gastos .g-head h3{margin:0;font-size:15px}
    #gastos .g-head small{color:#667085}
    #gastos .g-body{padding:18px}
    #gastos .g-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
    #gastos .g-stat{border:1px solid #e4e7ec;border-radius:12px;padding:13px;background:#fff}
    #gastos .g-stat small{display:block;color:#667085;font-size:10px;text-transform:uppercase;font-weight:800;margin-bottom:6px}
    #gastos .g-stat strong{font-size:18px;color:#101828}
    #gastos .g-stat.current{background:#f8fbff}
    #gastos .g-form-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
    #gastos .g-field label{display:block;margin-bottom:6px;font-size:10px;font-weight:800;color:#475467;text-transform:uppercase}
    #gastos .g-field input,#gastos .g-field select,#gastos .g-field textarea{width:100%;box-sizing:border-box;border:1px solid #d0d5dd;border-radius:10px;padding:9px 10px;background:#fff;color:#101828;font-size:12px}
    #gastos .g-field textarea{min-height:70px;resize:vertical}
    #gastos .g-span2{grid-column:span 2}
    #gastos .g-inline{display:flex;gap:6px}
    #gastos .g-inline>*:first-child{flex:1;min-width:0}
    #gastos .g-plus{width:36px;border:1px solid #d0d5dd;background:#fff;color:#155eef;border-radius:9px;font-weight:900;cursor:pointer}
    #gastos .g-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}
    #gastos .g-btn{border:1px solid #d0d5dd;border-radius:9px;background:#fff;padding:9px 13px;font-size:11px;font-weight:800;cursor:pointer}
    #gastos .g-primary{background:#155eef;border-color:#155eef;color:white}
    #gastos .g-filter-grid{display:grid;grid-template-columns:minmax(220px,1.5fr) repeat(3,minmax(140px,1fr)) minmax(250px,1.2fr);gap:8px;margin-bottom:10px}
    #gastos .g-filter-grid>*{width:100%;min-width:0;box-sizing:border-box;border:1px solid #d0d5dd;border-radius:9px;padding:8px 9px;background:#fff}
    #gastos .g-date-range{display:grid;grid-template-columns:1fr 1fr;gap:6px;border:0;padding:0;background:transparent}
    #gastos .g-date-range input{width:100%;min-width:0;box-sizing:border-box;border:1px solid #d0d5dd;border-radius:9px;padding:8px 9px}
    #gastos .g-table-wrap{overflow:auto;border:1px solid #e4e7ec;border-radius:12px}
    #gastos table{width:100%;border-collapse:collapse;min-width:880px}
    #gastos th,#gastos td{padding:10px 9px;border-bottom:1px solid #eef2f6;text-align:left;font-size:11px}
    #gastos th{background:#f8fafc;color:#475467;text-transform:uppercase;font-size:9px}
    #gastos th.sortable{cursor:pointer}
    #gastos th.active{background:#eef4ff;color:#175cd3}
    #gastos .g-type{display:inline-flex;border-radius:999px;padding:4px 8px;font-size:9px;font-weight:900;border:1px solid}
    #gastos .g-type.fijo{background:#f2f4f7;color:#344054;border-color:#d0d5dd}
    #gastos .g-type.corriente{background:#eff8ff;color:#175cd3;border-color:#b2ddff}
    #gastos .g-type.manutencion{background:#fffaeb;color:#b54708;border-color:#fedf89}
    #gastos .g-money{font-weight:900}
    #gastos .g-danger{color:#b42318}
    #gastos .g-empty{padding:28px;text-align:center;color:#667085}
    #gastos .g-count-row{display:flex;justify-content:space-between;gap:12px;margin:7px 0;color:#667085;font-size:10px}
    @media(max-width:1180px){
      #gastos .g-form-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
      #gastos .g-filter-grid{grid-template-columns:1fr 1fr 1fr}
      #gastos .g-filter-grid #gSearch{grid-column:1/-1}
      #gastos .g-date-range{grid-column:span 2}
    }
    @media(max-width:760px){
      #gastos .g-summary{grid-template-columns:1fr 1fr}
      #gastos .g-form-grid,#gastos .g-filter-grid{grid-template-columns:1fr}
      #gastos .g-span2,#gastos .g-filter-grid #gSearch,#gastos .g-date-range{grid-column:auto}
      #gastos .g-date-range{grid-template-columns:1fr}
    }
  `;
  document.head.appendChild(s);
}

function renderShell(){
  const root=document.getElementById('gastos');
  if(!root)return;
  root.innerHTML=`
    <div class="topbar">
      <div>
        <h2>Gastos</h2>
        <p>Registra y clasifica gastos fijos, corrientes y de manutención.</p>
      </div>
    </div>

    <div class="g-wrap">
      <div class="g-tabs">
        <button class="g-tab" data-gtype="fijo">Fijos</button>
        <button class="g-tab active" data-gtype="corriente">Corrientes</button>
        <button class="g-tab" data-gtype="manutencion">Manutención</button>
        <button class="g-tab" id="gAllTab" data-gtype="todos">Todos</button>
      </div>

      <section class="g-fixed-section" id="gQuickSection">
        <div class="g-fixed-title">
          <div>
            <h3>Gastos rápidos</h3>
            <small>Elige un servicio o gasto frecuente; después completa fecha y monto.</small>
          </div>
        </div>
        <div class="g-fixed-grid" id="gQuickTemplates"></div>
      </section>

      <div class="g-summary">
        <div class="g-stat"><small>Gasto del mes</small><strong id="gMonthTotal">$0.00</strong></div>
        <div class="g-stat"><small>Fijos</small><strong id="gFixedTotal">$0.00</strong></div>
        <div class="g-stat current"><small>Corrientes</small><strong id="gCurrentTotal">$0.00</strong></div>
        <div class="g-stat"><small>Manutención</small><strong id="gMaintenanceTotal">$0.00</strong></div>
      </div>

      <section class="g-card">
        <div class="g-head">
          <div><h3 id="gFormTitle">Registrar gasto corriente</h3><small>Los datos se guardan localmente en este dispositivo.</small></div>
        </div>
        <div class="g-body">
          <form id="gastoForm">
            <div class="g-form-grid">
              <div class="g-field">
                <label>Persona</label>
                <div class="g-inline">
                  <select id="gPerson"></select>
                  <button class="g-plus" id="gAddPerson" type="button" title="Dar de alta persona">＋</button>
                </div>
              </div>
              <div class="g-field">
                <label>Tipo de gasto</label>
                <select id="gType">
                  <option value="fijo">Fijo</option>
                  <option value="corriente">Corriente</option>
                  <option value="manutencion">Manutención</option>
                </select>
              </div>
              <div class="g-field">
                <label>Categoría</label>
                <div class="g-inline">
                  <select id="gCategory"></select>
                  <button class="g-plus" id="gAddCategory" type="button" title="Nueva categoría">＋</button>
                </div>
              </div>
              <div class="g-field">
                <label>Fecha</label>
                <input id="gDate" type="date" required>
              </div>

              <div class="g-field g-span2">
                <label>Descripción</label>
                <input id="gDescription" type="text" placeholder="Ej. Supermercado semanal, cambio de aceite..." required>
              </div>
              <div class="g-field">
                <label>Monto</label>
                <input id="gAmount" type="number" min="0.01" step="0.01" placeholder="0.00" required>
              </div>
              <div class="g-field">
                <label>Método de pago</label>
                <select id="gPayment">${PAYMENT_METHODS.map(x=>`<option>${esc(x)}</option>`).join('')}</select>
              </div>

              <div class="g-field" id="gCreditCardField" style="display:none">
                <label>Tarjeta de crédito</label>
                <div class="g-inline">
                  <select id="gCreditCard"></select>
                  <button class="g-plus" id="gAddCreditCard" type="button" title="Dar de alta tarjeta">＋</button>
                </div>
              </div>

              <div class="g-field g-span2" id="gAccountField">
                <label>Cuenta / Medio (opcional)</label>
                <input id="gAccount" type="text" placeholder="Ej. BBVA débito, efectivo, transferencia...">
              </div>
              <div class="g-field g-span2">
                <label>Nota (opcional)</label>
                <textarea id="gNote" placeholder="Detalle adicional"></textarea>
              </div>
            </div>

            <div class="g-actions">
              <button class="g-btn" id="gCancelEdit" type="button" style="display:none">Cancelar edición</button>
              <button class="g-btn g-primary" id="gSave" type="submit">Guardar gasto</button>
            </div>
          </form>
        </div>
      </section>

      <section class="g-card">
        <div class="g-head">
          <div><h3>Historial de gastos</h3><small id="gHistoryTitle">Todos los gastos registrados</small></div>
          <strong id="gVisibleTotal">$0.00</strong>
        </div>
        <div class="g-body">
          <div class="g-filter-grid">
            <input id="gSearch" type="search" placeholder="Buscar descripción, categoría, cuenta...">
            <select id="gFilterPerson"><option value="">Todas las personas</option></select>
            <select id="gFilterType">
              <option value="">Todos los tipos</option>
              <option value="fijo">Fijos</option>
              <option value="corriente">Corrientes</option>
              <option value="manutencion">Manutención</option>
            </select>
            <select id="gFilterCategory"><option value="">Todas las categorías</option></select>
            <div class="g-date-range">
              <input id="gFrom" type="date" title="Desde">
              <input id="gTo" type="date" title="Hasta">
            </div>
          </div>

          <div class="g-count-row">
            <span id="gCount">0 registros</span>
            <span>Deudas se administrarán en su módulo independiente.</span>
          </div>

          <div class="g-table-wrap">
            <table>
              <thead>
                <tr>
                  <th class="sortable active" data-gsort="date">Fecha ↕</th>
                  <th class="sortable" data-gsort="person">Persona ↕</th>
                  <th class="sortable" data-gsort="type">Tipo ↕</th>
                  <th class="sortable" data-gsort="category">Categoría ↕</th>
                  <th class="sortable" data-gsort="description">Descripción ↕</th>
                  <th>Método</th>
                  <th class="sortable" data-gsort="amount">Monto ↕</th>
                  <th></th>
                </tr>
              </thead>
              <tbody id="gHistoryBody"></tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  `;
}

function fillPeople(selected=''){
  const people=getPeople();
  const family=isFamilyMode();
  const selects=[document.getElementById('gPerson')];
  for(const sel of selects){
    if(!sel)continue;
    sel.innerHTML=(family?'':'<option value="">Da de alta tu nombre</option>')+
      people.map(p=>`<option value="${esc(p)}">${esc(personLabel(p))}</option>`).join('');
    if(selected&&people.includes(selected))sel.value=selected;
    else if(family&&people.length)sel.value=people[0];
  }
  const add=document.getElementById('gAddPerson');
  if(add)add.style.display=family?'none':'';
  const filter=document.getElementById('gFilterPerson');
  if(filter){
    const old=filter.value;
    filter.innerHTML='<option value="">Todas las personas</option>'+
      people.map(p=>`<option value="${esc(p)}">${esc(personLabel(p))}</option>`).join('');
    if(people.includes(old))filter.value=old;
  }
}
function fillCategories(type,selected=''){
  const list=getCategories(type);
  const sel=document.getElementById('gCategory');
  if(sel){
    sel.innerHTML=list.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('');
    if(selected&&list.includes(selected))sel.value=selected;
  }
}
function fillFilterCategories(){
  const sel=document.getElementById('gFilterCategory');
  if(!sel)return;
  const current=sel.value;
  const all=unique([
    ...getCategories('fijo'),
    ...getCategories('corriente'),
    ...getCategories('manutencion')
  ]);
  sel.innerHTML='<option value="">Todas las categorías</option>'+
    all.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('');
  if(all.includes(current))sel.value=current;
}
function setFormType(type,preserveCategory=false){
  if(!['fijo','corriente','manutencion'].includes(type))type='corriente';
  gastoViewType=type;
  const typeSel=document.getElementById('gType');
  if(typeSel)typeSel.value=type;
  fillCategories(type,preserveCategory?document.getElementById('gCategory')?.value:'');
  const title=document.getElementById('gFormTitle');
  if(title)title.textContent=`Registrar gasto ${type==='manutencion'?'de manutención':type}`;
  document.querySelectorAll('#gastos .g-tab[data-gtype]').forEach(btn=>{
    btn.classList.toggle('active',btn.dataset.gtype===type);
  });
}

function addPerson(){
  if(isFamilyMode())return;
  const name=prompt('Nombre que quieres dar de alta en este dispositivo:');
  if(!name?.trim())return;
  const value=name.trim();
  const people=getPeople();
  savePeople([...people,value]);
  fillPeople(value);
  renderHistory();
}
function addCategory(){
  const type=document.getElementById('gType').value;
  const name=prompt(`Nueva categoría para gastos ${typeLabel(type).toLowerCase()}:`);
  if(!name?.trim())return;
  const value=name.trim();
  saveCategories(type,[...getCategories(type),value]);
  fillCategories(type,value);
  fillFilterCategories();
}

function resetForm(){
  editingGastoId=null;
  document.getElementById('gastoForm')?.reset();
  fillPeople();
  setFormType(gastoViewType==='todos'?'corriente':gastoViewType);
  document.getElementById('gDate').value=today();
  updatePaymentUI();
  document.getElementById('gSave').textContent='Guardar gasto';
  document.getElementById('gCancelEdit').style.display='none';
}

async function saveGasto(e){
  e.preventDefault();
  const item={
    person:document.getElementById('gPerson').value,
    type:document.getElementById('gType').value,
    category:document.getElementById('gCategory').value,
    date:document.getElementById('gDate').value,
    description:document.getElementById('gDescription').value.trim(),
    amount:Number(document.getElementById('gAmount').value||0),
    paymentMethod:document.getElementById('gPayment').value,
    creditCard:document.getElementById('gPayment').value==='Tarjeta de crédito'
      ? (document.getElementById('gCreditCard')?.value||'')
      : '',
    account:document.getElementById('gPayment').value==='Tarjeta de crédito'
      ? ''
      : document.getElementById('gAccount').value.trim(),
    note:document.getElementById('gNote').value.trim(),
    updatedAt:new Date().toISOString()
  };
  if(!item.person||!item.date||!item.category||!item.description||item.amount<=0){
    alert('Completa persona, fecha, categoría, descripción y monto.');
    return;
  }
  if(item.paymentMethod==='Tarjeta de crédito' && !item.creditCard){
    alert('Selecciona la tarjeta de crédito utilizada.');
    return;
  }

  if(editingGastoId){
    const old=await dbGet(editingGastoId);
    await dbPut({...old,...item,id:editingGastoId});
  }else{
    await dbAdd({...item,createdAt:new Date().toISOString()});
  }
  saveCategories(item.type,[...getCategories(item.type),item.category]);
  resetForm();
  await renderAll();
}

async function editGasto(id){
  const item=await dbGet(id);
  if(!item)return;
  editingGastoId=id;
  if(!isFamilyMode() && item.person){
    savePeople([...getPeople(),item.person]);
  }
  fillPeople(item.person);
  setFormType(item.type);
  fillCategories(item.type,item.category);
  document.getElementById('gDate').value=item.date||today();
  document.getElementById('gDescription').value=item.description||'';
  document.getElementById('gAmount').value=item.amount||'';
  document.getElementById('gPayment').value=item.paymentMethod||'Efectivo';
  updatePaymentUI(item.creditCard||'');
  document.getElementById('gAccount').value=item.account||'';
  document.getElementById('gNote').value=item.note||'';
  document.getElementById('gSave').textContent='Guardar cambios';
  document.getElementById('gCancelEdit').style.display='';
  document.getElementById('gastoForm').scrollIntoView({behavior:'smooth',block:'start'});
}
async function deleteGasto(id){
  if(!confirm('¿Eliminar este gasto?'))return;
  await dbDelete(id);
  await renderAll();
}

function filters(){
  return {
    q:norm(document.getElementById('gSearch')?.value||''),
    person:document.getElementById('gFilterPerson')?.value||'',
    type:document.getElementById('gFilterType')?.value||'',
    category:document.getElementById('gFilterCategory')?.value||'',
    from:document.getElementById('gFrom')?.value||'',
    to:document.getElementById('gTo')?.value||''
  };
}
function sortVal(x,key){
  if(key==='amount')return Number(x.amount||0);
  if(key==='date')return x.date||'';
  if(key==='person')return norm(personLabel(x.person));
  return norm(x[key]||'');
}
function compare(a,b){
  const av=sortVal(a,gastoSort.key),bv=sortVal(b,gastoSort.key);
  let c=typeof av==='number'?av-bv:String(av).localeCompare(String(bv),'es',{numeric:true});
  if(c===0)c=Number(a.id||0)-Number(b.id||0);
  return gastoSort.dir==='asc'?c:-c;
}

async function renderSummary(all){
  const month=today().slice(0,7);
  const monthRows=all.filter(x=>String(x.date||'').slice(0,7)===month);
  const sum=t=>monthRows.filter(x=>!t||x.type===t).reduce((s,x)=>s+Number(x.amount||0),0);
  document.getElementById('gMonthTotal').textContent=money(sum(''));
  document.getElementById('gFixedTotal').textContent=money(sum('fijo'));
  document.getElementById('gCurrentTotal').textContent=money(sum('corriente'));
  document.getElementById('gMaintenanceTotal').textContent=money(sum('manutencion'));
}

async function renderHistory(){
  const all=await dbGetAll();
  const f=filters();
  let rows=all.filter(x=>{
    if(gastoViewType!=='todos' && x.type!==gastoViewType)return false;
    if(f.person&&x.person!==f.person)return false;
    if(f.type&&x.type!==f.type)return false;
    if(f.category&&x.category!==f.category)return false;
    if(f.from&&String(x.date||'')<f.from)return false;
    if(f.to&&String(x.date||'')>f.to)return false;
    if(f.q){
      const hay=norm([personLabel(x.person),x.category,x.description,x.paymentMethod,x.creditCard,x.account,x.note].join(' '));
      if(!hay.includes(f.q))return false;
    }
    return true;
  });
  rows.sort(compare);

  const total=rows.reduce((s,x)=>s+Number(x.amount||0),0);
  document.getElementById('gCount').textContent=`${rows.length} registro${rows.length===1?'':'s'}`;
  document.getElementById('gVisibleTotal').textContent=money(total);

  const body=document.getElementById('gHistoryBody');
  if(!rows.length){
    body.innerHTML=`<tr><td colspan="8"><div class="g-empty">No hay gastos que coincidan con los filtros.</div></td></tr>`;
    return;
  }
  body.innerHTML=rows.map(x=>`
    <tr>
      <td>${fmtDate(x.date)}</td>
      <td>${esc(personLabel(x.person))}</td>
      <td><span class="g-type ${esc(x.type)}">${esc(typeLabel(x.type))}</span></td>
      <td>${esc(x.category)}</td>
      <td><strong>${esc(x.description)}</strong>${x.account?`<br><small>${esc(x.account)}</small>`:''}</td>
      <td>${esc(x.paymentMethod||'—')}${x.creditCard?`<br><small>${esc(x.creditCard)}</small>`:''}</td>
      <td class="g-money">${money(x.amount)}</td>
      <td>
        <button class="g-btn" data-edit-g="${x.id}" type="button">Editar</button>
        <button class="g-btn g-danger" data-del-g="${x.id}" type="button">Eliminar</button>
      </td>
    </tr>
  `).join('');

  body.querySelectorAll('[data-edit-g]').forEach(b=>b.addEventListener('click',()=>editGasto(Number(b.dataset.editG))));
  body.querySelectorAll('[data-del-g]').forEach(b=>b.addEventListener('click',()=>deleteGasto(Number(b.dataset.delG))));
}

async function renderAll(){
  const all=await dbGetAll();
  await renderSummary(all);
  await renderHistory();
  document.querySelectorAll('#gastos th[data-gsort]').forEach(th=>{
    th.classList.toggle('active',th.dataset.gsort===gastoSort.key);
  });
}

function bindEvents(){
  document.getElementById('gastoForm').addEventListener('submit',saveGasto);
  document.getElementById('gCancelEdit').addEventListener('click',resetForm);
  document.getElementById('gAddPerson').addEventListener('click',addPerson);
  document.getElementById('gAddCategory').addEventListener('click',addCategory);
  document.getElementById('gAddCreditCard').addEventListener('click',addCreditCard);

  document.getElementById('gType').addEventListener('change',e=>setFormType(e.target.value));
  document.getElementById('gPayment').addEventListener('change',()=>updatePaymentUI());

  document.querySelectorAll('#gastos .g-tab[data-gtype]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const type=btn.dataset.gtype;
      gastoViewType=type;
      document.querySelectorAll('#gastos .g-tab').forEach(x=>x.classList.toggle('active',x===btn));
      if(type!=='todos')setFormType(type);
      renderHistory();
    });
  });

  ['gSearch','gFilterPerson','gFilterType','gFilterCategory','gFrom','gTo'].forEach(id=>{
    const el=document.getElementById(id);
    el.addEventListener(id==='gSearch'?'input':'change',renderHistory);
  });

  document.querySelectorAll('#gastos th[data-gsort]').forEach(th=>{
    th.addEventListener('click',()=>{
      const key=th.dataset.gsort;
      if(gastoSort.key===key)gastoSort.dir=gastoSort.dir==='asc'?'desc':'asc';
      else{
        gastoSort.key=key;
        gastoSort.dir=(key==='date'||key==='amount')?'desc':'asc';
      }
      renderAll();
    });
  });
}

export async function initGastos(){
  injectStyles();
  renderShell();
  fillPeople();
  fillFilterCategories();
  setFormType('corriente');
  document.getElementById('gDate').value=today();
  fillCreditCards();
  updatePaymentUI();
  renderQuickTemplates();
  bindEvents();

  try{
    await openGastosDB();
    await renderAll();
  }catch(err){
    console.error(err);
    alert('No fue posible abrir el almacenamiento local del módulo Gastos.');
  }
}
