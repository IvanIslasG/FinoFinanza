const INCOME_DB_NAME='FinoFinanzaIngresosDB';
const INCOME_DB_VERSION=1;
const INCOME_STORE='ingresos';

let incomeDb=null;
let selectedIncomeFile=null;
let currentPayslipPreview=null;
let editingIncomeId=null;
let incomeView='manual';

const P39_DEMO={
  person:'Ivan',
  source:'TELMEX',
  entryType:'nomina',
  documentType:'Nómina semanal',
  paymentDate:'2025-09-28',
  period:'39/2025',
  periodDays:7,
  dailySalary:851.32,
  perceptions:10703.04,
  deductions:7692.04,
  taxes:1177.46,
  net:3011.00,
  extraordinary:false,
  parserProfile:'telmex',
  concepts:[
    {code:'03',description:'Sueldo',kind:'percepcion',amount:5959.24},
    {code:'12',description:'Productividad',kind:'percepcion',amount:1506.37},
    {code:'13',description:'Manejo',kind:'percepcion',days:5,amount:171.90},
    {code:'20',description:'Ayuda renta',kind:'percepcion',amount:537.88},
    {code:'21',description:'Ayuda pasajes',kind:'percepcion',amount:280.91},
    {code:'22',description:'Ayuda despensa',kind:'percepcion',amount:331.24},
    {code:'23.1',description:'Tiempo ext doble',kind:'percepcion',hours:3.5,amount:893.90},
    {code:'24',description:'Indem dia descanso',kind:'percepcion',hours:4,amount:1021.60},
    {code:'51',description:'Ahorro 11.53%',kind:'ahorro',amount:706.92,accumulated:26946.02},
    {code:'53',description:'Cuotas sindicales',kind:'deduccion',amount:148.98},
    {code:'54',description:'Seguro sindicato',kind:'deduccion',amount:265.72},
    {code:'55',description:'Impuesto',kind:'impuesto',amount:1177.46},
    {code:'69',description:'Amort INFONAVIT',kind:'deduccion',amount:2455.94},
    {code:'74',description:'Descuento caja',kind:'deduccion',amount:1639},
    {code:'93',description:'Retención caja',kind:'deduccion',amount:1000},
    {code:'95.0',description:'Seguro de vida',kind:'deduccion',amount:119.87},
    {code:'95.1',description:'Seguro de auto',kind:'deduccion',amount:178},
    {code:'99',description:'Ajuste redondeo',kind:'deduccion',amount:-0.15}
  ]
};

function openIncomeDb(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(INCOME_DB_NAME,INCOME_DB_VERSION);
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains(INCOME_STORE)){
        const store=db.createObjectStore(INCOME_STORE,{keyPath:'id',autoIncrement:true});
        store.createIndex('paymentDate','paymentDate',{unique:false});
        store.createIndex('person','person',{unique:false});
        store.createIndex('source','source',{unique:false});
      }
    };
    req.onsuccess=()=>{incomeDb=req.result;resolve(incomeDb)};
    req.onerror=()=>reject(req.error);
  });
}
function incomeGetAll(){
  return new Promise((resolve,reject)=>{
    const req=incomeDb.transaction(INCOME_STORE,'readonly').objectStore(INCOME_STORE).getAll();
    req.onsuccess=()=>resolve(req.result||[]);
    req.onerror=()=>reject(req.error);
  });
}
function incomeAdd(item){
  return new Promise((resolve,reject)=>{
    const req=incomeDb.transaction(INCOME_STORE,'readwrite').objectStore(INCOME_STORE).add(item);
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}
function incomePut(item){
  return new Promise((resolve,reject)=>{
    const req=incomeDb.transaction(INCOME_STORE,'readwrite').objectStore(INCOME_STORE).put(item);
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}
function incomeDelete(id){
  return new Promise((resolve,reject)=>{
    const req=incomeDb.transaction(INCOME_STORE,'readwrite').objectStore(INCOME_STORE).delete(Number(id));
    req.onsuccess=()=>resolve();
    req.onerror=()=>reject(req.error);
  });
}
function incomeGet(id){
  return new Promise((resolve,reject)=>{
    const req=incomeDb.transaction(INCOME_STORE,'readonly').objectStore(INCOME_STORE).get(Number(id));
    req.onsuccess=()=>resolve(req.result||null);
    req.onerror=()=>reject(req.error);
  });
}

function esc(v=''){
  return String(v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
}
function money(v){
  return new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(Number(v||0));
}
function localDate(iso){
  if(!iso)return '—';
  const [y,m,d]=String(iso).slice(0,10).split('-').map(Number);
  if(!y||!m||!d)return iso;
  return new Intl.DateTimeFormat('es-MX',{day:'2-digit',month:'short',year:'numeric'}).format(new Date(y,m-1,d));
}
function normalizedPerson(v){
  if(v==='Yorsky')return 'Yorsky';
  if(v==='Ivan')return 'Iván';
  return v||'Otro';
}
function netFor(item){
  if(item.entryType==='manual')return Number(item.amount||0);
  return Number(item.net||0);
}
function typeLabel(item){
  if(item.entryType==='manual')return item.incomeType||'Ingreso';
  if(item.extraordinary)return 'Nómina extraordinaria';
  return 'Nómina';
}
function monthKey(date){
  return String(date||'').slice(0,7);
}
function toast(text,type='ok'){
  const el=document.getElementById('incomeToast');
  if(!el)return;
  el.className='income-toast show '+type;
  el.textContent=text;
  clearTimeout(toast._t);
  toast._t=setTimeout(()=>el.classList.remove('show'),2600);
}

function injectIncomeStyles(){
  if(document.getElementById('finoIncomeStyles'))return;
  const style=document.createElement('style');
  style.id='finoIncomeStyles';
  style.textContent=`
    #ingresos .income-shell{display:grid;gap:16px}
    #ingresos .income-tabs{display:flex;gap:7px;flex-wrap:wrap}
    #ingresos .income-tab{border:1px solid var(--line);background:#fff;color:#475467;border-radius:10px;padding:9px 13px;font-size:12px;font-weight:800;cursor:pointer}
    #ingresos .income-tab.active{background:#eef4ff;border-color:#b8c8ef;color:var(--accent)}
    #ingresos .income-pane{display:none}
    #ingresos .income-pane.active{display:block}
    #ingresos .income-card{background:#fff;border:1px solid var(--line);border-radius:16px;overflow:hidden}
    #ingresos .income-card-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;border-bottom:1px solid var(--line)}
    #ingresos .income-card-head h3{font-size:14px;margin:0}
    #ingresos .income-card-head span{font-size:11px;color:var(--muted)}
    #ingresos .income-card-body{padding:16px}
    #ingresos .income-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
    #ingresos .income-field{display:grid;gap:5px;min-width:0}
    #ingresos .income-field.full{grid-column:1/-1}
    #ingresos .income-field label{font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#667085;font-weight:800}
    #ingresos .income-field input,#ingresos .income-field select,#ingresos .income-field textarea{
      width:100%;min-width:0;border:1px solid var(--line);border-radius:9px;background:#fff;padding:9px 10px;font:inherit;font-size:12px;color:#101828;box-sizing:border-box
    }
    #ingresos .income-field textarea{min-height:74px;resize:vertical}
    #ingresos .income-actions{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;margin-top:14px}
    #ingresos .income-btn{border:1px solid var(--line);background:#fff;color:#344054;border-radius:9px;padding:9px 12px;font-size:11px;font-weight:800;cursor:pointer}
    #ingresos .income-btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
    #ingresos .income-btn.good{background:#ecfdf3;border-color:#abefc6;color:#067647}
    #ingresos .income-btn.danger{color:#b42318}
    #ingresos .income-btn:disabled{opacity:.5;cursor:not-allowed}
    #ingresos .income-reader-grid{display:grid;grid-template-columns:minmax(280px,.8fr) minmax(0,1.2fr);gap:16px;align-items:start}
    #ingresos .income-drop{min-height:190px;border:2px dashed #b8c8ef;border-radius:14px;background:#f8faff;display:grid;place-items:center;text-align:center;padding:18px}
    #ingresos .income-drop.dragover{background:#eef4ff;border-color:var(--accent)}
    #ingresos .income-drop strong{display:block;margin-bottom:4px}
    #ingresos .income-drop p{font-size:11px;color:var(--muted);margin:0 0 12px}
    #ingresos .income-file-meta{display:none;margin-top:9px;padding:9px 10px;border:1px solid var(--line);border-radius:9px;font-size:11px}
    #ingresos .income-file-meta.show{display:flex;justify-content:space-between;align-items:center;gap:10px}
    #ingresos .income-preview-empty{border:1px dashed var(--line);border-radius:12px;padding:30px 16px;text-align:center;color:var(--muted);font-size:12px}
    #ingresos .income-preview{display:none}
    #ingresos .income-preview.show{display:block}
    #ingresos .income-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:10px}
    #ingresos .income-kpi{border:1px solid var(--line);border-radius:11px;padding:11px;background:#f8fafc}
    #ingresos .income-kpi span{display:block;font-size:9px;color:#667085;text-transform:uppercase;margin-bottom:4px}
    #ingresos .income-kpi strong{font-size:16px}
    #ingresos .income-kpi.net{background:#f0fdf4}
    #ingresos .income-validation{padding:9px 10px;border-radius:9px;border:1px solid var(--line);font-size:11px;margin:8px 0}
    #ingresos .income-validation.ok{background:#ecfdf3;color:#067647;border-color:#abefc6}
    #ingresos .income-validation.warn{background:#fffaeb;color:#b54708;border-color:#fedf89}
    #ingresos .income-table-wrap{overflow:auto;border:1px solid var(--line);border-radius:11px}
    #ingresos .income-table{width:100%;border-collapse:collapse;font-size:11px;min-width:760px}
    #ingresos .income-table th{background:#f8fafc;color:#667085;text-align:left;font-size:9px;text-transform:uppercase;letter-spacing:.03em;padding:9px;border-bottom:1px solid var(--line);white-space:nowrap}
    #ingresos .income-table td{padding:9px;border-bottom:1px solid #f2f4f7;vertical-align:middle}
    #ingresos .income-table tbody tr:last-child td{border-bottom:0}
    #ingresos .income-history-row{cursor:pointer}
    #ingresos .income-history-row:hover{background:#fafcff}
    #ingresos .income-pill{display:inline-flex;align-items:center;border:1px solid var(--line);border-radius:999px;padding:3px 7px;font-size:9px;font-weight:800;background:#f8fafc;color:#475467;white-space:nowrap}
    #ingresos .income-pill.telmex{background:#eef4ff;color:#3538cd;border-color:#c7d7fe}
    #ingresos .income-pill.yorsky{background:#fdf2fa;color:#c11574;border-color:#fcceee}
    #ingresos .income-pill.manual{background:#ecfdf3;color:#067647;border-color:#abefc6}
    #ingresos .income-filters{display:grid;grid-template-columns:minmax(180px,1fr) repeat(3,minmax(120px,.45fr));gap:8px;margin-bottom:10px}
    #ingresos .income-filters input,#ingresos .income-filters select{width:100%;border:1px solid var(--line);border-radius:9px;padding:8px 9px;font-size:11px;background:#fff}
    #ingresos .income-summary{display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:10px;font-size:11px;color:#667085}
    #ingresos .income-summary strong{color:#101828;font-size:13px}
    #ingresos .income-row-actions{display:flex;gap:4px}
    #ingresos .income-icon-btn{width:28px;height:28px;border:1px solid var(--line);background:#fff;border-radius:7px;cursor:pointer}
    #ingresos .income-icon-btn:hover{background:#f8fafc}
    #ingresos .income-toolbar-note{font-size:10px;color:#667085;margin-top:8px;line-height:1.45}
    #ingresos .income-toast{position:fixed;right:20px;bottom:20px;z-index:9999;padding:10px 13px;border-radius:10px;font-size:11px;font-weight:700;box-shadow:0 10px 25px rgba(16,24,40,.12);display:none}
    #ingresos .income-toast.show{display:block}
    #ingresos .income-toast.ok{background:#ecfdf3;color:#067647;border:1px solid #abefc6}
    #ingresos .income-toast.warn{background:#fffaeb;color:#b54708;border:1px solid #fedf89}
    #ingresos .income-toast.error{background:#fef3f2;color:#b42318;border:1px solid #fecdca}
    #ingresos .income-modal-backdrop{position:fixed;inset:0;background:rgba(16,24,40,.42);z-index:9997;display:none;place-items:center;padding:20px}
    #ingresos .income-modal-backdrop.show{display:grid}
    #ingresos .income-modal{background:#fff;border-radius:16px;width:min(620px,100%);max-height:86vh;overflow:auto;box-shadow:0 25px 60px rgba(16,24,40,.2)}
    #ingresos .income-modal-head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--line)}
    #ingresos .income-modal-head h3{margin:0;font-size:14px}
    #ingresos .income-modal-body{padding:16px}
    #ingresos .income-close{border:0;background:#f2f4f7;border-radius:8px;width:30px;height:30px;cursor:pointer}
    @media(max-width:850px){
      #ingresos .income-reader-grid{grid-template-columns:1fr}
      #ingresos .income-kpis{grid-template-columns:repeat(2,1fr)}
      #ingresos .income-filters{grid-template-columns:1fr 1fr}
    }
    @media(max-width:560px){
      #ingresos .income-form-grid,#ingresos .income-filters{grid-template-columns:1fr}
      #ingresos .income-kpis{grid-template-columns:1fr 1fr}
    }
  `;
  document.head.appendChild(style);
}

function renderIncomeShell(){
  const section=document.getElementById('ingresos');
  if(!section)return;
  section.innerHTML=`
    <div class="topbar">
      <div>
        <h2>Ingresos</h2>
        <p>Nómina, volantes e ingresos familiares en un solo historial.</p>
      </div>
    </div>
    <div class="income-shell">
      <div class="income-tabs">
        <button class="income-tab active" data-income-view="manual">＋ Registrar ingreso</button>
        <button class="income-tab" data-income-view="payslip">PDF Volantes</button>
        <button class="income-tab" data-income-view="history">≡ Historial</button>
      </div>

      <section class="income-pane active" id="incomePaneManual">
        <div class="income-card">
          <div class="income-card-head">
            <h3 id="manualIncomeTitle">Registrar ingreso</h3>
            <span>Ingresos que no provienen de un volante</span>
          </div>
          <div class="income-card-body">
            <form id="manualIncomeForm">
              <div class="income-form-grid">
                <div class="income-field">
                  <label>Persona</label>
                  <select id="manualPerson">
                    <option value="Ivan">Iván</option>
                    <option value="Yorsky">Yorsky</option>
                    <option value="Familiar">Familiar / compartido</option>
                    <option value="Otro">Otro</option>
                  </select>
                </div>
                <div class="income-field">
                  <label>Fecha del ingreso</label>
                  <input id="manualDate" type="date" required>
                </div>
                <div class="income-field">
                  <label>Fuente</label>
                  <input id="manualSource" list="incomeSourceSuggestions" placeholder="Ej. Renta, TELMEX, clases..." required>
                  <datalist id="incomeSourceSuggestions">
                    <option value="Renta"></option>
                    <option value="TELMEX"></option>
                    <option value="Trabajo extra"></option>
                    <option value="Venta"></option>
                    <option value="Devolución"></option>
                    <option value="Regalo"></option>
                    <option value="Otro"></option>
                  </datalist>
                </div>
                <div class="income-field">
                  <label>Categoría</label>
                  <select id="manualType">
                    <option value="Sueldo / Nómina">Sueldo / Nómina</option>
                    <option value="Renta">Renta</option>
                    <option value="Trabajo extra">Trabajo extra</option>
                    <option value="Venta">Venta</option>
                    <option value="Devolución">Devolución</option>
                    <option value="Regalo">Regalo</option>
                    <option value="Premio / Bono">Premio / Bono</option>
                    <option value="Otro">Otro</option>
                  </select>
                </div>
                <div class="income-field">
                  <label>Concepto</label>
                  <input id="manualConcept" placeholder="Ej. Renta septiembre" required>
                </div>
                <div class="income-field">
                  <label>Monto recibido</label>
                  <input id="manualAmount" type="number" min="0" step="0.01" placeholder="0.00" required>
                </div>
                <div class="income-field full">
                  <label>Nota</label>
                  <textarea id="manualNote" placeholder="Opcional"></textarea>
                </div>
              </div>
              <div class="income-actions">
                <button class="income-btn" id="manualCancelEdit" type="button" style="display:none">Cancelar edición</button>
                <button class="income-btn primary" type="submit" id="manualSaveBtn">Guardar ingreso</button>
              </div>
            </form>
          </div>
        </div>
      </section>

      <section class="income-pane" id="incomePanePayslip">
        <div class="income-card">
          <div class="income-card-head">
            <h3>Importar volante</h3>
            <span>PDF · revisión antes de guardar</span>
          </div>
          <div class="income-card-body">
            <div class="income-reader-grid">
              <div>
                <div class="income-form-grid" style="margin-bottom:10px">
                  <div class="income-field">
                    <label>¿De quién es?</label>
                    <select id="payslipPerson">
                      <option value="Ivan">Iván</option>
                      <option value="Yorsky">Yorsky</option>
                    </select>
                  </div>
                  <div class="income-field">
                    <label>Perfil de lectura</label>
                    <select id="payslipProfile">
                      <option value="telmex">TELMEX</option>
                      <option value="yorsky">Yorsky · manual por ahora</option>
                      <option value="generic">Nómina genérica</option>
                    </select>
                  </div>
                </div>
                <div class="income-drop" id="incomeDropzone">
                  <div>
                    <strong>Arrastra aquí el volante</strong>
                    <p>o selecciona un PDF desde tu equipo.</p>
                    <button class="income-btn" id="incomeSelectPdf" type="button">Seleccionar PDF</button>
                    <input id="incomePdfInput" type="file" accept="application/pdf,.pdf" hidden>
                  </div>
                </div>
                <div class="income-file-meta" id="incomeFileMeta">
                  <div><strong id="incomeFileName">—</strong><div id="incomeFileSize" style="color:#667085"></div></div>
                  <button class="income-btn" id="incomeRemovePdf" type="button">Quitar</button>
                </div>
                <div class="income-actions" style="justify-content:flex-start">
                  <button class="income-btn primary" id="incomeProcessPdf" type="button" disabled>Procesar volante</button>
                  <button class="income-btn" id="incomeDemoP39" type="button">Ejemplo P39</button>
                </div>
                <div class="income-toolbar-note">
                  TELMEX tendrá lectura automática mediante OCR + reglas. Yorsky queda preparado para incorporar su perfil cuando tengamos un volante real.
                </div>
              </div>

              <div>
                <div class="income-preview-empty" id="incomePreviewEmpty">Procesa un volante para revisar sus datos antes de guardarlo.</div>
                <div class="income-preview" id="incomePreview">
                  <div class="income-form-grid" style="margin-bottom:10px">
                    <div class="income-field"><label>Fecha de pago</label><input id="previewPaymentDate" type="date"></div>
                    <div class="income-field"><label>Periodo</label><input id="previewPeriod" type="text"></div>
                    <div class="income-field"><label>Tipo de volante</label>
                      <select id="previewDocumentType">
                        <option value="Nómina semanal">Nómina semanal</option>
                        <option value="Nómina extraordinaria">Nómina extraordinaria</option>
                        <option value="Ahorro">Ahorro</option>
                        <option value="Otro">Otro</option>
                      </select>
                    </div>
                    <div class="income-field"><label>Extraordinario</label>
                      <select id="previewExtraordinary"><option value="false">No</option><option value="true">Sí</option></select>
                    </div>
                  </div>
                  <div class="income-kpis">
                    <div class="income-kpi"><span>Percepciones</span><strong id="previewPerceptions">$0.00</strong></div>
                    <div class="income-kpi"><span>Deducciones</span><strong id="previewDeductions">$0.00</strong></div>
                    <div class="income-kpi"><span>Impuestos</span><strong id="previewTaxes">$0.00</strong></div>
                    <div class="income-kpi net"><span>Neto</span><strong id="previewNet">$0.00</strong></div>
                  </div>
                  <div class="income-validation" id="previewValidation">—</div>
                  <div class="income-table-wrap" style="max-height:300px">
                    <table class="income-table">
                      <thead><tr><th>Clave</th><th>Concepto</th><th>Tipo</th><th>Horas</th><th>Importe</th></tr></thead>
                      <tbody id="previewConceptRows"></tbody>
                    </table>
                  </div>
                  <div class="income-actions">
                    <button class="income-btn good" id="savePayslipBtn" type="button">Guardar volante</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="income-pane" id="incomePaneHistory">
        <div class="income-card">
          <div class="income-card-head">
            <h3>Historial de ingresos</h3>
            <span id="incomeHistoryCount">0 registros</span>
          </div>
          <div class="income-card-body">
            <div class="income-filters">
              <input id="incomeSearch" type="search" placeholder="Buscar fuente, concepto, periodo...">
              <select id="incomeFilterPerson"><option value="">Todas las personas</option><option value="Ivan">Iván</option><option value="Yorsky">Yorsky</option><option value="Familiar">Familiar</option><option value="Otro">Otro</option></select>
              <select id="incomeFilterKind"><option value="">Todos los tipos</option><option value="manual">Manual</option><option value="nomina">Nómina</option></select>
              <input id="incomeFilterMonth" type="month">
            </div>
            <div class="income-summary">
              <span id="incomeHistoryShowing">0 registros</span>
              <span>Total neto mostrado: <strong id="incomeHistoryTotal">$0.00</strong></span>
            </div>
            <div class="income-table-wrap">
              <table class="income-table">
                <thead><tr><th>Fecha</th><th>Persona</th><th>Fuente</th><th>Concepto / periodo</th><th>Categoría</th><th>Neto</th><th></th></tr></thead>
                <tbody id="incomeHistoryRows"></tbody>
              </table>
            </div>
          </div>
        </div>
      </section>
    </div>

    <div class="income-modal-backdrop" id="incomeDetailModal">
      <div class="income-modal">
        <div class="income-modal-head"><h3>Detalle del ingreso</h3><button class="income-close" id="incomeDetailClose">×</button></div>
        <div class="income-modal-body" id="incomeDetailBody"></div>
      </div>
    </div>
    <div class="income-toast" id="incomeToast"></div>
  `;
}

function switchIncomeView(view){
  incomeView=view;
  document.querySelectorAll('#ingresos [data-income-view]').forEach(b=>b.classList.toggle('active',b.dataset.incomeView===view));
  document.querySelectorAll('#ingresos .income-pane').forEach(p=>p.classList.remove('active'));
  const map={manual:'incomePaneManual',payslip:'incomePanePayslip',history:'incomePaneHistory'};
  document.getElementById(map[view])?.classList.add('active');
  if(view==='history')renderIncomeHistory();
}

function resetManualForm(){
  editingIncomeId=null;
  const form=document.getElementById('manualIncomeForm');
  form?.reset();
  document.getElementById('manualPerson').value='Ivan';
  document.getElementById('manualDate').value=new Date().toISOString().slice(0,10);
  document.getElementById('manualType').value='Otro';
  document.getElementById('manualIncomeTitle').textContent='Registrar ingreso';
  document.getElementById('manualSaveBtn').textContent='Guardar ingreso';
  document.getElementById('manualCancelEdit').style.display='none';
}

async function saveManualIncome(e){
  e.preventDefault();
  const item={
    entryType:'manual',
    person:document.getElementById('manualPerson').value,
    paymentDate:document.getElementById('manualDate').value,
    source:document.getElementById('manualSource').value.trim(),
    incomeType:document.getElementById('manualType').value,
    concept:document.getElementById('manualConcept').value.trim(),
    amount:Number(document.getElementById('manualAmount').value||0),
    note:document.getElementById('manualNote').value.trim(),
    updatedAt:new Date().toISOString()
  };
  if(!item.paymentDate||!item.source||!item.concept||item.amount<=0){
    toast('Completa fecha, fuente, concepto y monto.','warn');return;
  }
  if(editingIncomeId){
    const old=await incomeGet(editingIncomeId);
    await incomePut({...old,...item,id:editingIncomeId});
    toast('Ingreso actualizado.');
  }else{
    item.createdAt=new Date().toISOString();
    await incomeAdd(item);
    toast('Ingreso guardado.');
  }
  resetManualForm();
  await renderIncomeHistory();
}

function setPdfFile(file){
  if(!file)return;
  if(file.type!=='application/pdf'&&!file.name.toLowerCase().endsWith('.pdf')){
    toast('El archivo debe ser PDF.','warn');return;
  }
  selectedIncomeFile=file;
  document.getElementById('incomeFileName').textContent=file.name;
  document.getElementById('incomeFileSize').textContent=`${(file.size/1024).toFixed(1)} KB`;
  document.getElementById('incomeFileMeta').classList.add('show');
  document.getElementById('incomeProcessPdf').disabled=false;
}
function clearPdfFile(){
  selectedIncomeFile=null;
  document.getElementById('incomePdfInput').value='';
  document.getElementById('incomeFileMeta').classList.remove('show');
  document.getElementById('incomeProcessPdf').disabled=true;
}
function normalizePayslipData(raw){
  const d={...raw};
  return {
    person:d.person||document.getElementById('payslipPerson').value,
    source:d.source||(
      document.getElementById('payslipProfile').value==='telmex'?'TELMEX':
      document.getElementById('payslipPerson').value==='Yorsky'?'Nómina Yorsky':'Nómina'
    ),
    entryType:'nomina',
    documentType:d.documentType||d.tipo_documento||'Nómina',
    paymentDate:d.paymentDate||d.fecha_pago||'',
    period:d.period||d.periodo||'',
    periodDays:Number(d.periodDays??d.dias_periodo??0),
    dailySalary:Number(d.dailySalary??d.salario_diario??0),
    perceptions:Number(d.perceptions??d.total_percepciones??0),
    deductions:Number(d.deductions??d.total_deducciones??0),
    taxes:Number(d.taxes??d.impuestos??0),
    net:Number(d.net??d.neto??0),
    extraordinary:Boolean(d.extraordinary),
    parserProfile:d.parserProfile||document.getElementById('payslipProfile').value,
    concepts:(d.concepts||d.conceptos||[]).map(c=>({
      code:c.code??c.clave??'',
      description:c.description??c.descripcion??'',
      kind:c.kind??c.tipo??'',
      days:c.days??c.dias??null,
      hours:c.hours??c.horas??null,
      amount:Number(c.amount??c.importe??0),
      accumulated:c.accumulated??c.acumulado??null
    })),
    fileName:selectedIncomeFile?.name||d.fileName||'',
    createdAt:d.createdAt||new Date().toISOString(),
    updatedAt:new Date().toISOString()
  };
}
function renderPayslipPreview(raw){
  currentPayslipPreview=normalizePayslipData(raw);
  const d=currentPayslipPreview;
  document.getElementById('incomePreviewEmpty').style.display='none';
  document.getElementById('incomePreview').classList.add('show');
  document.getElementById('previewPaymentDate').value=d.paymentDate||'';
  document.getElementById('previewPeriod').value=d.period||'';
  document.getElementById('previewDocumentType').value=[...document.getElementById('previewDocumentType').options].some(o=>o.value===d.documentType)?d.documentType:'Otro';
  document.getElementById('previewExtraordinary').value=String(Boolean(d.extraordinary));
  document.getElementById('previewPerceptions').textContent=money(d.perceptions);
  document.getElementById('previewDeductions').textContent=money(d.deductions);
  document.getElementById('previewTaxes').textContent=money(d.taxes);
  document.getElementById('previewNet').textContent=money(d.net);

  const calc=d.perceptions-d.deductions;
  const ok=Math.abs(calc-d.net)<0.02;
  const val=document.getElementById('previewValidation');
  val.className='income-validation '+(ok?'ok':'warn');
  val.textContent=ok
    ? `✓ Validado: ${money(d.perceptions)} − ${money(d.deductions)} = ${money(d.net)}`
    : `⚠ Revisar: el cálculo da ${money(calc)} y el neto leído es ${money(d.net)}.`;

  document.getElementById('previewConceptRows').innerHTML=d.concepts.length
    ? d.concepts.map(c=>`<tr><td>${esc(c.code)}</td><td>${esc(c.description)}</td><td>${esc(c.kind)}</td><td>${c.hours??''}</td><td>${money(c.amount)}</td></tr>`).join('')
    : '<tr><td colspan="5" style="text-align:center;color:#667085">Sin conceptos detectados</td></tr>';
}
async function processPayslip(){
  if(!selectedIncomeFile)return;
  const person=document.getElementById('payslipPerson').value;
  const profile=document.getElementById('payslipProfile').value;
  if(profile==='yorsky'){
    toast('El perfil de Yorsky está preparado, pero falta un volante real para enseñarle su formato.','warn');
    renderPayslipPreview({
      person:'Yorsky',source:'Nómina Yorsky',entryType:'nomina',
      paymentDate:'',period:'',perceptions:0,deductions:0,taxes:0,net:0,
      documentType:'Nómina',parserProfile:'yorsky',concepts:[]
    });
    return;
  }
  try{
    const form=new FormData();
    form.append('file',selectedIncomeFile);
    form.append('person',person);
    form.append('profile',profile);
    const response=await fetch('/api/nomina/leer',{method:'POST',body:form});
    if(!response.ok)throw new Error('reader unavailable');
    const data=await response.json();
    renderPayslipPreview({...data,person,parserProfile:profile});
    toast('Volante procesado. Revisa los datos antes de guardarlo.');
  }catch{
    toast('El OCR real aún no está conectado. La interfaz y el guardado ya están listos.','warn');
  }
}
async function savePayslip(){
  if(!currentPayslipPreview)return;
  const d={
    ...currentPayslipPreview,
    paymentDate:document.getElementById('previewPaymentDate').value,
    period:document.getElementById('previewPeriod').value.trim(),
    documentType:document.getElementById('previewDocumentType').value,
    extraordinary:document.getElementById('previewExtraordinary').value==='true',
    updatedAt:new Date().toISOString()
  };
  if(!d.paymentDate){
    toast('Indica la fecha de pago antes de guardar.','warn');return;
  }
  const all=await incomeGetAll();
  const duplicate=all.find(x=>x.entryType==='nomina'&&x.person===d.person&&x.paymentDate===d.paymentDate&&String(x.period||'')===String(d.period||'')&&x.source===d.source);
  if(duplicate){
    const replace=confirm('Ya existe un volante de esta persona, fecha y periodo. ¿Deseas reemplazarlo?');
    if(!replace)return;
    await incomePut({...duplicate,...d,id:duplicate.id,createdAt:duplicate.createdAt||d.createdAt});
    toast('Volante reemplazado.');
  }else{
    await incomeAdd(d);
    toast('Volante guardado.');
  }
  await renderIncomeHistory();
  switchIncomeView('history');
}

function collectHistoryFilters(){
  return {
    q:document.getElementById('incomeSearch')?.value.trim().toLowerCase()||'',
    person:document.getElementById('incomeFilterPerson')?.value||'',
    kind:document.getElementById('incomeFilterKind')?.value||'',
    month:document.getElementById('incomeFilterMonth')?.value||''
  };
}
async function renderIncomeHistory(){
  if(!incomeDb)return;
  const rowsEl=document.getElementById('incomeHistoryRows');
  if(!rowsEl)return;
  const all=(await incomeGetAll()).sort((a,b)=>String(b.paymentDate||'').localeCompare(String(a.paymentDate||''))||Number(b.id)-Number(a.id));
  const f=collectHistoryFilters();
  const filtered=all.filter(item=>{
    if(f.person&&item.person!==f.person)return false;
    if(f.kind&&item.entryType!==f.kind)return false;
    if(f.month&&monthKey(item.paymentDate)!==f.month)return false;
    if(f.q){
      const hay=[
        item.source,item.concept,item.period,item.incomeType,item.documentType,
        normalizedPerson(item.person),item.note,item.paymentDate
      ].join(' ').toLowerCase();
      if(!hay.includes(f.q))return false;
    }
    return true;
  });
  document.getElementById('incomeHistoryCount').textContent=`${all.length} registro${all.length===1?'':'s'}`;
  document.getElementById('incomeHistoryShowing').textContent=`${filtered.length} de ${all.length} registros`;
  document.getElementById('incomeHistoryTotal').textContent=money(filtered.reduce((s,x)=>s+netFor(x),0));

  rowsEl.innerHTML=filtered.length?filtered.map(item=>{
    const concept=item.entryType==='manual'
      ? item.concept
      : `${item.documentType||'Nómina'}${item.period?` · ${item.period}`:''}`;
    const pillClass=item.entryType==='manual'?'manual':item.source==='TELMEX'?'telmex':item.person==='Yorsky'?'yorsky':'';
    return `<tr class="income-history-row" data-income-id="${item.id}">
      <td>${localDate(item.paymentDate)}</td>
      <td>${esc(normalizedPerson(item.person))}</td>
      <td><span class="income-pill ${pillClass}">${esc(item.source||'—')}</span></td>
      <td><strong>${esc(concept||'—')}</strong></td>
      <td>${esc(typeLabel(item))}</td>
      <td><strong>${money(netFor(item))}</strong></td>
      <td><div class="income-row-actions">
        ${item.entryType==='manual'?`<button class="income-icon-btn" data-income-edit="${item.id}" title="Editar">✏️</button>`:''}
        <button class="income-icon-btn" data-income-delete="${item.id}" title="Eliminar">🗑️</button>
      </div></td>
    </tr>`;
  }).join(''):'<tr><td colspan="7" style="text-align:center;color:#667085;padding:24px">No hay ingresos que coincidan con los filtros.</td></tr>';

  rowsEl.querySelectorAll('[data-income-edit]').forEach(btn=>btn.addEventListener('click',async e=>{
    e.stopPropagation();await editManualIncome(btn.dataset.incomeEdit);
  }));
  rowsEl.querySelectorAll('[data-income-delete]').forEach(btn=>btn.addEventListener('click',async e=>{
    e.stopPropagation();
    const item=await incomeGet(btn.dataset.incomeDelete);
    if(!item)return;
    if(!confirm(`¿Eliminar este ingreso de ${money(netFor(item))}?`))return;
    await incomeDelete(btn.dataset.incomeDelete);
    toast('Ingreso eliminado.');
    await renderIncomeHistory();
  }));
  rowsEl.querySelectorAll('.income-history-row').forEach(row=>row.addEventListener('click',()=>showIncomeDetail(row.dataset.incomeId)));
}

async function editManualIncome(id){
  const item=await incomeGet(id);
  if(!item||item.entryType!=='manual')return;
  editingIncomeId=item.id;
  document.getElementById('manualPerson').value=item.person||'Ivan';
  document.getElementById('manualDate').value=item.paymentDate||'';
  document.getElementById('manualSource').value=item.source||'';
  document.getElementById('manualType').value=item.incomeType||'Ordinario';
  document.getElementById('manualConcept').value=item.concept||'';
  document.getElementById('manualAmount').value=item.amount||'';
  document.getElementById('manualNote').value=item.note||'';
  document.getElementById('manualIncomeTitle').textContent='Editar ingreso';
  document.getElementById('manualSaveBtn').textContent='Guardar cambios';
  document.getElementById('manualCancelEdit').style.display='';
  switchIncomeView('manual');
}

async function showIncomeDetail(id){
  const item=await incomeGet(id);
  if(!item)return;
  const body=document.getElementById('incomeDetailBody');
  if(item.entryType==='manual'){
    body.innerHTML=`
      <div class="income-form-grid">
        <div class="income-field"><label>Fecha</label><strong>${localDate(item.paymentDate)}</strong></div>
        <div class="income-field"><label>Persona</label><strong>${esc(normalizedPerson(item.person))}</strong></div>
        <div class="income-field"><label>Fuente</label><strong>${esc(item.source)}</strong></div>
        <div class="income-field"><label>Categoría</label><strong>${esc(item.incomeType)}</strong></div>
        <div class="income-field full"><label>Concepto</label><strong>${esc(item.concept)}</strong></div>
        <div class="income-field"><label>Monto</label><strong style="font-size:18px">${money(item.amount)}</strong></div>
        <div class="income-field full"><label>Nota</label><div>${esc(item.note||'—')}</div></div>
      </div>`;
  }else{
    const calc=Number(item.perceptions||0)-Number(item.deductions||0);
    body.innerHTML=`
      <div class="income-form-grid" style="margin-bottom:12px">
        <div class="income-field"><label>Persona</label><strong>${esc(normalizedPerson(item.person))}</strong></div>
        <div class="income-field"><label>Fuente</label><strong>${esc(item.source)}</strong></div>
        <div class="income-field"><label>Fecha de pago</label><strong>${localDate(item.paymentDate)}</strong></div>
        <div class="income-field"><label>Periodo</label><strong>${esc(item.period||'—')}</strong></div>
      </div>
      <div class="income-kpis">
        <div class="income-kpi"><span>Percepciones</span><strong>${money(item.perceptions)}</strong></div>
        <div class="income-kpi"><span>Deducciones</span><strong>${money(item.deductions)}</strong></div>
        <div class="income-kpi"><span>Impuestos</span><strong>${money(item.taxes)}</strong></div>
        <div class="income-kpi net"><span>Neto</span><strong>${money(item.net)}</strong></div>
      </div>
      <div class="income-validation ${Math.abs(calc-Number(item.net||0))<.02?'ok':'warn'}">
        ${Math.abs(calc-Number(item.net||0))<.02?'✓ Volante matemáticamente consistente.':'⚠ El volante requiere revisión matemática.'}
      </div>
      <div class="income-table-wrap">
        <table class="income-table"><thead><tr><th>Clave</th><th>Concepto</th><th>Tipo</th><th>Horas</th><th>Importe</th></tr></thead>
        <tbody>${(item.concepts||[]).map(c=>`<tr><td>${esc(c.code)}</td><td>${esc(c.description)}</td><td>${esc(c.kind)}</td><td>${c.hours??''}</td><td>${money(c.amount)}</td></tr>`).join('')}</tbody></table>
      </div>`;
  }
  document.getElementById('incomeDetailModal').classList.add('show');
}

function bindIncomeEvents(){
  document.querySelectorAll('#ingresos [data-income-view]').forEach(btn=>btn.addEventListener('click',()=>switchIncomeView(btn.dataset.incomeView)));

  document.getElementById('manualIncomeForm').addEventListener('submit',saveManualIncome);
  document.getElementById('manualCancelEdit').addEventListener('click',resetManualForm);

  const fileInput=document.getElementById('incomePdfInput');
  const drop=document.getElementById('incomeDropzone');
  document.getElementById('incomeSelectPdf').addEventListener('click',()=>fileInput.click());
  fileInput.addEventListener('change',e=>setPdfFile(e.target.files?.[0]));
  ['dragenter','dragover'].forEach(type=>drop.addEventListener(type,e=>{e.preventDefault();drop.classList.add('dragover')}));
  ['dragleave','drop'].forEach(type=>drop.addEventListener(type,e=>{e.preventDefault();drop.classList.remove('dragover')}));
  drop.addEventListener('drop',e=>setPdfFile(e.dataTransfer.files?.[0]));
  document.getElementById('incomeRemovePdf').addEventListener('click',clearPdfFile);
  document.getElementById('incomeProcessPdf').addEventListener('click',processPayslip);
  document.getElementById('incomeDemoP39').addEventListener('click',()=>{
    document.getElementById('payslipPerson').value='Ivan';
    document.getElementById('payslipProfile').value='telmex';
    renderPayslipPreview(P39_DEMO);
    toast('Ejemplo P39 cargado. Revisa y guarda cuando quieras.');
  });
  document.getElementById('savePayslipBtn').addEventListener('click',savePayslip);

  ['incomeSearch','incomeFilterPerson','incomeFilterKind','incomeFilterMonth'].forEach(id=>{
    const el=document.getElementById(id);
    el.addEventListener(id==='incomeSearch'?'input':'change',renderIncomeHistory);
  });

  document.getElementById('incomeDetailClose').addEventListener('click',()=>document.getElementById('incomeDetailModal').classList.remove('show'));
  document.getElementById('incomeDetailModal').addEventListener('click',e=>{
    if(e.target.id==='incomeDetailModal')e.currentTarget.classList.remove('show');
  });

  document.getElementById('payslipPerson').addEventListener('change',e=>{
    const profile=document.getElementById('payslipProfile');
    profile.value=e.target.value==='Yorsky'?'yorsky':'telmex';
  });
}

export async function initIngresos(){
  injectIncomeStyles();
  renderIncomeShell();
  bindIncomeEvents();
  resetManualForm();
  try{
    await openIncomeDb();
    await renderIncomeHistory();
  }catch(err){
    console.error(err);
    toast('No se pudo abrir la base local de Ingresos.','error');
  }
}
