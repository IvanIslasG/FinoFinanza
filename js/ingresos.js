const INCOME_DB_NAME='FinoFinanzaIngresosDB';
const INCOME_DB_VERSION=1;
const INCOME_STORE='ingresos';

let incomeDb=null;
let selectedIncomeFiles=[];
let payslipQueue=[];
let currentPayslipPreview=null;
let currentPayslipQueueIndex=null;
let editingIncomeId=null;
let incomeView='manual';

let pdfJsReadyPromise=null;
let tesseractReadyPromise=null;
let telmexOcrWorker=null;

const PDFJS_CDN='https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
const PDFJS_WORKER_CDN='https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
const TESSERACT_CDN='https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

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
    #ingresos .income-selected-files{display:grid;gap:5px;margin-top:8px;max-height:145px;overflow:auto}
    #ingresos .income-selected-file{display:flex;justify-content:space-between;gap:8px;align-items:center;padding:6px 8px;background:#f8fafc;border:1px solid var(--line);border-radius:8px;font-size:10px}
    #ingresos .income-selected-file button{border:0;background:transparent;cursor:pointer;color:#b42318;font-size:12px}
    #ingresos .income-batch-status{display:inline-flex;align-items:center;border-radius:999px;padding:3px 7px;font-size:9px;font-weight:800;border:1px solid var(--line);white-space:nowrap}
    #ingresos .income-batch-status.pending{background:#f8fafc;color:#667085}
    #ingresos .income-batch-status.processing{background:#eff8ff;color:#175cd3;border-color:#b2ddff}
    #ingresos .income-batch-status.valid{background:#ecfdf3;color:#067647;border-color:#abefc6}
    #ingresos .income-batch-status.review{background:#fffaeb;color:#b54708;border-color:#fedf89}
    #ingresos .income-batch-status.error{background:#fef3f2;color:#b42318;border-color:#fecdca}
    #ingresos .income-ocr-details{margin-top:9px;border:1px solid var(--line);border-radius:9px;background:#f8fafc}
    #ingresos .income-ocr-details summary{cursor:pointer;padding:8px 10px;font-size:10px;font-weight:800;color:#475467}
    #ingresos .income-ocr-text{margin:0;padding:10px;white-space:pre-wrap;word-break:break-word;max-height:220px;overflow:auto;font:10px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace;color:#475467;border-top:1px solid var(--line)}
    #ingresos .income-ocr-source{font-size:9px;color:#667085;margin-top:5px}
    
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
        <p>Nómina, volantes e ingresos familiares en un solo historial. <span style="font-size:9px;color:#98a2b3">Lector TELMEX v4</span></p>
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
                    <strong>Arrastra aquí uno o varios volantes</strong>
                    <p>o selecciona múltiples PDF desde tu equipo.</p>
                    <button class="income-btn" id="incomeSelectPdf" type="button">Seleccionar PDF</button>
                    <input id="incomePdfInput" type="file" accept="application/pdf,.pdf" multiple hidden>
                  </div>
                </div>
                <div class="income-file-meta" id="incomeFileMeta">
                  <div style="width:100%">
                    <div style="display:flex;justify-content:space-between;gap:10px;align-items:center">
                      <strong id="incomeFileCount">0 archivos</strong>
                      <button class="income-btn" id="incomeRemovePdf" type="button">Vaciar cola</button>
                    </div>
                    <div id="incomeSelectedFiles" class="income-selected-files"></div>
                  </div>
                </div>
                <div class="income-actions" style="justify-content:flex-start">
                  <button class="income-btn primary" id="incomeProcessPdf" type="button" disabled>Procesar todos</button>
                  <button class="income-btn good" id="saveAllPayslipsBtn" type="button" disabled>Guardar todos los válidos</button>
                  <button class="income-btn" id="incomeDemoP39" type="button">Ejemplo P39</button>
                </div>
                <div class="income-toolbar-note">
                  TELMEX se lee localmente en tu navegador con PDF.js + OCR + reglas. La primera carga puede tardar mientras se descarga el motor OCR. Yorsky queda preparado para incorporar su perfil cuando tengamos un volante real.
                </div>
              </div>

              <div>
                <div id="incomeBatchPanel" style="display:none;margin-bottom:12px">
                  <div class="income-table-wrap">
                    <table class="income-table" style="min-width:720px">
                      <thead><tr><th>Archivo</th><th>Fecha</th><th>Periodo</th><th>Neto</th><th>Estado</th><th></th></tr></thead>
                      <tbody id="incomeBatchRows"></tbody>
                    </table>
                  </div>
                </div>
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
                  <div class="income-ocr-source" id="previewOcrSource"></div>
                  <details class="income-ocr-details" id="previewOcrDetails" style="display:none">
                    <summary>Ver texto detectado</summary>
                    <pre class="income-ocr-text" id="previewOcrText"></pre>
                  </details>
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


function refreshSelectedFiles(){
  const meta=document.getElementById('incomeFileMeta');
  const list=document.getElementById('incomeSelectedFiles');
  const count=document.getElementById('incomeFileCount');
  const process=document.getElementById('incomeProcessPdf');
  count.textContent=`${selectedIncomeFiles.length} archivo${selectedIncomeFiles.length===1?'':'s'}`;
  list.innerHTML=selectedIncomeFiles.map((file,index)=>`
    <div class="income-selected-file">
      <span title="${esc(file.name)}">${esc(file.name)} · ${(file.size/1024).toFixed(1)} KB</span>
      <button type="button" data-remove-selected="${index}" title="Quitar">×</button>
    </div>`).join('');
  list.querySelectorAll('[data-remove-selected]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      selectedIncomeFiles.splice(Number(btn.dataset.removeSelected),1);
      refreshSelectedFiles();
    });
  });
  meta.classList.toggle('show',selectedIncomeFiles.length>0);
  process.disabled=selectedIncomeFiles.length===0;
}

function addPdfFiles(files){
  const incoming=[...(files||[])].filter(file=>
    file.type==='application/pdf'||file.name.toLowerCase().endsWith('.pdf')
  );
  if(!incoming.length){toast('Selecciona archivos PDF.','warn');return;}
  for(const file of incoming){
    if(!selectedIncomeFiles.some(f=>f.name===file.name&&f.size===file.size)){
      selectedIncomeFiles.push(file);
    }
  }
  refreshSelectedFiles();
}

function clearPdfFile(){
  selectedIncomeFiles=[];
  payslipQueue=[];
  currentPayslipQueueIndex=null;
  document.getElementById('incomePdfInput').value='';
  document.getElementById('incomeBatchPanel').style.display='none';
  document.getElementById('incomeBatchRows').innerHTML='';
  document.getElementById('saveAllPayslipsBtn').disabled=true;
  document.getElementById('incomePreview').classList.remove('show');
  document.getElementById('incomePreviewEmpty').style.display='';
  refreshSelectedFiles();
}

function validationState(d){
  const p=Number(d.perceptions||0);
  const de=Number(d.deductions||0);
  const n=Number(d.net||0);
  const calc=p-de;
  if(!d.paymentDate||!d.period)return 'review';
  if(!(p>0)||!(de>=0)||!(n>=0))return 'review';
  if(!d.totalsReliable)return 'review';
  return Math.abs(calc-n)<0.02?'valid':'review';
}

function renderBatchQueue(){
  const panel=document.getElementById('incomeBatchPanel');
  const tbody=document.getElementById('incomeBatchRows');
  if(!payslipQueue.length){
    panel.style.display='none';
    tbody.innerHTML='';
    document.getElementById('saveAllPayslipsBtn').disabled=true;
    return;
  }
  panel.style.display='';
  const labels={pending:'Pendiente',processing:'Procesando',valid:'Validado',review:'Revisar',error:'Error'};
  tbody.innerHTML=payslipQueue.map((item,index)=>{
    const d=item.data||{};
    return `<tr>
      <td><strong>${esc(item.file.name)}</strong></td>
      <td>${d.paymentDate?localDate(d.paymentDate):'—'}</td>
      <td>${esc(d.period||'—')}</td>
      <td>${item.data?money(d.net):'—'}</td>
      <td>
        <span class="income-batch-status ${item.status}">${
          item.status==='processing' && Number.isFinite(item.progress)
            ? `OCR ${Math.round(item.progress)}%`
            : (labels[item.status]||item.status)
        }</span>
      </td>
      <td><button class="income-icon-btn" type="button" data-open-batch="${index}" title="Revisar">👁</button></td>
    </tr>`;
  }).join('');
  tbody.querySelectorAll('[data-open-batch]').forEach(btn=>{
    btn.addEventListener('click',()=>openBatchPreview(Number(btn.dataset.openBatch)));
  });
  document.getElementById('saveAllPayslipsBtn').disabled=!payslipQueue.some(x=>x.status==='valid');
}

function openBatchPreview(index){
  const item=payslipQueue[index];
  if(!item?.data)return;
  currentPayslipQueueIndex=index;
  renderPayslipPreview(item.data);
}


function loadExternalScript(src,globalName){
  return new Promise((resolve,reject)=>{
    if(globalName && window[globalName]){resolve(window[globalName]);return;}
    const existing=[...document.scripts].find(s=>s.src===src);
    if(existing){
      const wait=()=>{
        if(!globalName || window[globalName])resolve(globalName?window[globalName]:true);
        else setTimeout(wait,60);
      };
      wait();
      return;
    }
    const script=document.createElement('script');
    script.src=src;
    script.async=true;
    script.crossOrigin='anonymous';
    script.onload=()=>resolve(globalName?window[globalName]:true);
    script.onerror=()=>reject(new Error(`No se pudo cargar ${src}`));
    document.head.appendChild(script);
  });
}

async function ensurePdfJs(){
  if(window.pdfjsLib)return window.pdfjsLib;
  if(!pdfJsReadyPromise){
    pdfJsReadyPromise=loadExternalScript(PDFJS_CDN,'pdfjsLib').then(pdfjs=>{
      pdfjs.GlobalWorkerOptions.workerSrc=PDFJS_WORKER_CDN;
      return pdfjs;
    });
  }
  return pdfJsReadyPromise;
}

async function ensureTesseract(){
  if(window.Tesseract)return window.Tesseract;
  if(!tesseractReadyPromise){
    tesseractReadyPromise=loadExternalScript(TESSERACT_CDN,'Tesseract');
  }
  return tesseractReadyPromise;
}

function normalizeOcrText(text=''){
  return String(text)
    .replace(/\r/g,'')
    .replace(/[ \t]+/g,' ')
    .replace(/[“”]/g,'"')
    .replace(/[‘’]/g,"'")
    .trim();
}

function parseTelmexMoney(raw){
  if(raw===null||raw===undefined)return null;
  let s=String(raw).trim()
    .replace(/\s/g,'')
    .replace(/\$/g,'')
    .replace(/[Oo](?=\d)/g,'0')
    .replace(/(?<=\d)[Oo]/g,'0');
  if(!s)return null;
  let negative=false;
  if(/^\-/.test(s)){negative=true;s=s.slice(1);}
  s=s.replace(/,/g,'');
  const n=Number(s);
  return Number.isFinite(n)?(negative?-n:n):null;
}

function moneyTokens(line=''){
  const matches=String(line).match(/-?\$?\d{1,3}(?:,\d{3})*(?:\.\d{2})|-?\$?\d+\.\d{2}/g)||[];
  return matches.map(parseTelmexMoney).filter(Number.isFinite);
}

function toIsoTelmexDate(raw){
  const m=String(raw||'').match(/(\d{1,2})[.\/-](\d{1,2})[.\/-](20\d{2})/);
  if(!m)return '';
  const d=String(Number(m[1])).padStart(2,'0');
  const mo=String(Number(m[2])).padStart(2,'0');
  return `${m[3]}-${mo}-${d}`;
}

function findTelmexDate(text){
  const patterns=[
    /Fecha\s+de\s+pago[\s\S]{0,100}?(\d{1,2}[.\/-]\d{1,2}[.\/-]20\d{2})/i,
    /\b(\d{1,2}[.\/-]\d{1,2}[.\/-]20\d{2})\b/
  ];
  for(const p of patterns){
    const m=text.match(p);
    if(m)return toIsoTelmexDate(m[1]);
  }
  return '';
}

function findTelmexPeriod(text,fileName=''){
  if(/\b00\s*\/\s*0000\b/.test(text))return '';
  const m=text.match(/(?:Sindicalizado|Periodo|Per[ií]odo)[\s\S]{0,100}?\b(\d{1,2})\s*\/\s*(20\d{2})\b/i)
    || text.match(/\b(\d{1,2})\s*\/\s*(20\d{2})\b/);
  if(m)return `${String(Number(m[1])).padStart(2,'0')}/${m[2]}`;
  const fm=String(fileName).match(/\bP(\d{1,2})\b/i);
  if(fm){
    const year=(text.match(/\b20\d{2}\b/)||[])[0]||new Date().getFullYear();
    return `${String(Number(fm[1])).padStart(2,'0')}/${year}`;
  }
  return '';
}

function findTotalsFromText(text){
  const lines=normalizeOcrText(text).split('\n').map(x=>x.trim()).filter(Boolean);

  // Best case: TELMEX total row contains Percepciones + Deducciones
  // and usually the same or following line contains Neto.
  for(let i=0;i<lines.length;i++){
    if(!/\btotal\b/i.test(lines[i]))continue;

    const vals=moneyTokens(lines[i]).filter(v=>Math.abs(v)>=1);
    let net=null;

    const neighborhood=lines.slice(i,Math.min(lines.length,i+4)).join(' ');
    const nm=neighborhood.match(/(?:Pago\s+Neto|Neto)[:\s$]*([0-9][0-9,]*\.\d{2})/i);
    if(nm)net=parseTelmexMoney(nm[1]);

    if(vals.length>=3){
      // Pick a triple that satisfies percepciones - deducciones = neto.
      for(let a=0;a<vals.length-2;a++){
        for(let b=a+1;b<vals.length-1;b++){
          for(let c=b+1;c<vals.length;c++){
            if(Math.abs((vals[a]-vals[b])-vals[c])<0.05){
              return {perceptions:vals[a],deductions:vals[b],net:vals[c]};
            }
          }
        }
      }
    }

    if(vals.length>=2 && Number.isFinite(net)){
      const p=vals[0],d=vals[1];
      if(Math.abs((p-d)-net)<1){
        return {perceptions:p,deductions:d,net};
      }
    }
  }

  // Search a larger neighborhood around "Pago Neto" / "Neto".
  const joined=lines.join(' ');
  const netMatch=joined.match(/(?:Pago\s+Neto|Neto)[:\s$]*([0-9][0-9,]*\.\d{2})/i);
  const net=netMatch?parseTelmexMoney(netMatch[1]):0;

  // Bottom summary commonly reads:
  // Percepciones 11,157.79 Deducciones 8,380.79 ... Pago Neto 2,777.00
  const summary=joined.match(
    /Percepciones[\s\S]{0,90}?([0-9][0-9,]*\.\d{2})[\s\S]{0,90}?Deducciones[\s\S]{0,90}?([0-9][0-9,]*\.\d{2})/i
  );
  if(summary){
    const p=parseTelmexMoney(summary[1])||0;
    const d=parseTelmexMoney(summary[2])||0;
    if(net && Math.abs((p-d)-net)<1){
      return {perceptions:p,deductions:d,net};
    }
  }

  return {perceptions:0,deductions:0,net};
}
const TELMEX_CONCEPTS=[
  {code:'03',desc:'Sueldo',kind:'percepcion'},
  {code:'12',desc:'Productividad',kind:'percepcion'},
  {code:'17',desc:'Aguinaldo',kind:'percepcion'},
  {code:'13',desc:'Manejo',kind:'percepcion'},
  {code:'20',desc:'Ayuda renta',kind:'percepcion'},
  {code:'21',desc:'Ayuda pasajes',kind:'percepcion'},
  {code:'22',desc:'Ayuda despensa',kind:'percepcion'},
  {code:'23',desc:'Tiempo ext doble',kind:'percepcion'},
  {code:'24',desc:'Indem dia descanso',kind:'percepcion'},
  {code:'38',desc:'Ahorro acumulado',kind:'percepcion'},
  {code:'39',desc:'Premio del Ahorro',kind:'percepcion'},
  {code:'51',desc:'Ahorro 11.53%',kind:'ahorro'},
  {code:'53',desc:'Cuotas sindicales',kind:'deduccion'},
  {code:'54',desc:'Seguro sindicato',kind:'deduccion'},
  {code:'55',desc:'Impuesto',kind:'impuesto'},
  {code:'69',desc:'Amort INFONAVIT',kind:'deduccion'},
  {code:'74',desc:'Descuento caja',kind:'deduccion'},
  {code:'93',desc:'Retención caja',kind:'deduccion'},
  {code:'95',desc:'Seguro',kind:'deduccion'},
  {code:'99',desc:'Ajuste redondeo',kind:'deduccion'}
];

function normalizeSearchText(s=''){
  return String(s).toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9.% ]+/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

function parseConceptsFromOcr(text){
  const lines=normalizeOcrText(text).split('\n').map(x=>x.trim()).filter(Boolean);
  const out=[];

  const byCode=new Map(TELMEX_CONCEPTS.map(def=>[def.code,def]));

  for(const line of lines){
    // Prefer the printed TELMEX concept code at the beginning of the line.
    // Example: "55 Impuesto 5,397.25 ..."
    const codeMatch=line.match(/^\s*(\d{1,2})(?:[.,](\d))?\s+/);
    let def=null;
    let printedCode='';

    if(codeMatch){
      printedCode=codeMatch[2] ? `${codeMatch[1]}.${codeMatch[2]}` : codeMatch[1].padStart(2,'0');

      // TELMEX 95.0 / 95.1 share base definition 95.
      def=byCode.get(printedCode) || byCode.get(codeMatch[1].padStart(2,'0')) || byCode.get(codeMatch[1]);
    }

    // Only if OCR lost the code, fall back to a strong description match.
    if(!def){
      const clean=normalizeSearchText(line);
      for(const candidate of TELMEX_CONCEPTS){
        const words=normalizeSearchText(candidate.desc).split(' ').filter(w=>w.length>3);
        if(words.length && words.every(w=>clean.includes(w))){
          def=candidate;
          printedCode=candidate.code;
          break;
        }
      }
    }

    if(!def)continue;

    const vals=moneyTokens(line);
    if(!vals.length)continue;

    let amount;
    if(def.kind==='percepcion'){
      // Perception amount is normally the first large money value after date/hours.
      amount=vals[vals.length-1];
    }else{
      // Deduction / tax amount is the first money value in Liquidación.
      amount=vals[0];
    }

    // For adjustment, preserve OCR sign; don't force absolute value.
    if(def.code==='99' && !Number.isFinite(amount))continue;

    let hours=null;
    if(/tiempo\s+ext/i.test(line)){
      const nums=(line.match(/\b\d{1,2}\.\d{2}\b/g)||[]).map(Number)
        .filter(n=>n>=0&&n<=24&&Math.abs(n-amount)>.001);
      if(nums.length>=2)hours=nums[1];
      else if(nums.length===1)hours=nums[0];
    }

    const codeOut=printedCode || def.code;

    // Avoid duplicate OCR lines for the same exact concept/value.
    const duplicate=out.some(c=>
      c.code===codeOut &&
      c.description===def.desc &&
      Math.abs(Number(c.amount||0)-Number(amount||0))<0.01
    );
    if(duplicate)continue;

    out.push({
      code:codeOut,
      description:def.desc,
      kind:def.kind,
      hours,
      amount
    });
  }

  return out;
}
function inferSpecialTelmexDocument(text,fileName=''){
  const textNorm=normalizeSearchText(text);
  const fileNorm=normalizeSearchText(fileName);

  if(fileNorm.includes('gastos educ') || textNorm.includes('gastos educacionales')){
    return {documentType:'Nómina extraordinaria',extraordinary:true};
  }

  if(fileNorm.includes('aguinaldo') || textNorm.includes('anticipo aguinaldo')){
    return {documentType:'Nómina extraordinaria',extraordinary:true};
  }

  // "Premio del Ahorro" and "Ahorro acumulado" also occur as concepts
  // in ordinary weekly payslips. Do not classify a weekly Pxx as Ahorro
  // from those concepts alone.
  const looksWeekly=/^p\d{1,2}(?:\D|$)/i.test(String(fileName||'').trim());
  const explicitSavingsFile=fileNorm.includes('ahorro');
  const explicitSavingsTitle=/dep[oó]sito\s+en\s+banco[\s_-]*ahorro/i.test(text);

  if(!looksWeekly && (explicitSavingsFile || explicitSavingsTitle)){
    return {documentType:'Ahorro',extraordinary:true};
  }

  return {documentType:'Nómina semanal',extraordinary:false};
}
function parseTelmexOcr(text,file){
  const clean=normalizeOcrText(text);
  const totals=findTotalsFromText(clean);
  const concepts=parseConceptsFromOcr(clean);
  const taxConcept=concepts.find(c=>String(c.code).replace(/^0/,'')==='55') || concepts.find(c=>c.kind==='impuesto');
  const special=inferSpecialTelmexDocument(clean,file?.name||'');

  let perceptions=Number(totals.perceptions||0);
  let deductions=Number(totals.deductions||0);
  let net=Number(totals.net||0);

  if(!(perceptions>0) || !(deductions>0) || !(net>0)){
    const conceptPerceptions=concepts
      .filter(c=>c.kind==='percepcion')
      .reduce((s,c)=>s+Number(c.amount||0),0);

    const conceptDeductions=concepts
      .filter(c=>['deduccion','impuesto','ahorro'].includes(c.kind))
      .reduce((s,c)=>s+Number(c.amount||0),0);

    if(!(perceptions>0) && conceptPerceptions>0)perceptions=conceptPerceptions;
    if(!(deductions>0) && conceptDeductions>0)deductions=conceptDeductions;

    const calculated=perceptions-deductions;
    if(!(net>0) && calculated>0)net=calculated;
  }

  const salaryMatch=clean.replace(/\n/g,' ').match(/Salario\s+diario[\s\S]{0,50}?([0-9][0-9,]*\.\d{2})/i);
  const daysMatch=clean.replace(/\n/g,' ').match(/D[ií]as\s+Periodo[\s\S]{0,30}?(\d{1,2})\b/i);

  return {
    person:'Ivan',
    source:'TELMEX',
    entryType:'nomina',
    documentType:special.documentType,
    paymentDate:findTelmexDate(clean),
    period:findTelmexPeriod(clean,file?.name||''),
    periodDays:daysMatch?Number(daysMatch[1]):0,
    dailySalary:salaryMatch?parseTelmexMoney(salaryMatch[1])||0:0,
    perceptions,
    deductions,
    taxes:taxConcept?.amount||0,
    net,
    extraordinary:special.extraordinary,
    parserProfile:'telmex-local-ocr',
    concepts,
    fileName:file?.name||'',
    totalsReliable:false,
    totalsSource:'Reconstruido / requiere revisión',
    ocrText:clean,
    ocrSource:'OCR local · primera página',
    createdAt:new Date().toISOString(),
    updatedAt:new Date().toISOString()
  };
}

async function extractPdfTextAndCanvas(file){
  const pdfjs=await ensurePdfJs();
  const data=await file.arrayBuffer();
  const pdf=await pdfjs.getDocument({data}).promise;
  const page=await pdf.getPage(1);

  let nativeText='';
  try{
    const content=await page.getTextContent();
    nativeText=content.items.map(x=>x.str).join(' ');
  }catch{}

  const viewport=page.getViewport({scale:2.15});
  const canvas=document.createElement('canvas');
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  canvas.width=Math.ceil(viewport.width);
  canvas.height=Math.ceil(viewport.height);
  await page.render({canvasContext:ctx,viewport}).promise;

  return {nativeText:normalizeOcrText(nativeText),canvas};
}

async function getTelmexOcrWorker(onProgress){
  const T=await ensureTesseract();
  if(!telmexOcrWorker){
    telmexOcrWorker=await T.createWorker('spa',1,{
      logger:m=>{
        if(m.status==='recognizing text'&&typeof m.progress==='number'&&typeof getTelmexOcrWorker._progress==='function'){
          getTelmexOcrWorker._progress(m.progress*100);
        }
      }
    });
  }
  getTelmexOcrWorker._progress=onProgress;
  return telmexOcrWorker;
}


function cropCanvas(source,leftRatio,topRatio,widthRatio,heightRatio,scale=1.8){
  const sx=Math.floor(source.width*leftRatio);
  const sy=Math.floor(source.height*topRatio);
  const sw=Math.floor(source.width*widthRatio);
  const sh=Math.floor(source.height*heightRatio);
  const out=document.createElement('canvas');
  out.width=Math.max(1,Math.floor(sw*scale));
  out.height=Math.max(1,Math.floor(sh*scale));
  const ctx=out.getContext('2d',{willReadFrequently:true});
  ctx.drawImage(source,sx,sy,sw,sh,0,0,out.width,out.height);
  return out;
}

function parseBottomSummaryText(text){
  const clean=normalizeOcrText(text);
  const joined=clean.split('\n').join(' ');

  const p=joined.match(/Percepciones[\s:$|]*([0-9][0-9,]*\.\d{2})/i);
  const d=joined.match(/Deducciones[\s:$|]*([0-9][0-9,]*\.\d{2})/i);
  const n=joined.match(/(?:Pago\s*Neto|Neto)[\s:$|]*([0-9][0-9,]*\.\d{2})/i);

  if(p&&d&&n){
    const perceptions=parseTelmexMoney(p[1]);
    const deductions=parseTelmexMoney(d[1]);
    const net=parseTelmexMoney(n[1]);
    if([perceptions,deductions,net].every(Number.isFinite) &&
       Math.abs((perceptions-deductions)-net)<0.05){
      return {perceptions,deductions,net,reliable:true,text:clean};
    }
  }

  const vals=moneyTokens(clean).filter(v=>v>=0 && v<1000000);
  for(let i=0;i<vals.length;i++){
    for(let j=0;j<vals.length;j++){
      if(i===j)continue;
      for(let k=0;k<vals.length;k++){
        if(k===i||k===j)continue;
        const P=vals[i],D=vals[j],N=vals[k];
        if(P>=N && P>1000 && Math.abs((P-D)-N)<0.05){
          return {perceptions:P,deductions:D,net:N,reliable:true,text:clean};
        }
      }
    }
  }

  return {perceptions:0,deductions:0,net:0,reliable:false,text:clean};
}
async function readTelmexConceptTable(canvas,onProgress=()=>{}){
  const crop=cropCanvas(canvas,0.002,0.30,0.995,0.47,2.25);
  const worker=await getTelmexOcrWorker(onProgress);
  try{
    await worker.setParameters({tessedit_pageseg_mode:'11',preserve_interword_spaces:'1'});
  }catch{}
  const result=await worker.recognize(crop);
  try{ await worker.setParameters({tessedit_pageseg_mode:'3'}); }catch{}
  return parseTelmexTableText(result?.data?.text||'');
}

async function readTelmexBottomTotals(canvas,onProgress=()=>{}){
  const worker=await getTelmexOcrWorker(onProgress);
  const cropA=cropCanvas(canvas,0.005,0.68,0.94,0.17,2.3);
  const cropB=cropCanvas(canvas,0.015,0.79,0.92,0.19,2.3);

  let textA='',textB='';
  try{
    await worker.setParameters({tessedit_pageseg_mode:'11',preserve_interword_spaces:'1'});
  }catch{}
  try{ textA=(await worker.recognize(cropA))?.data?.text||''; }catch{}
  try{ textB=(await worker.recognize(cropB))?.data?.text||''; }catch{}
  try{ await worker.setParameters({tessedit_pageseg_mode:'3'}); }catch{}

  return parseBottomSummaryText([textA,textB].join('\n'));
}

async function readTelmexPdfLocally(file,onProgress=()=>{}){
  onProgress(3);
  const {nativeText,canvas}=await extractPdfTextAndCanvas(file);

  let fullText='';
  let parsed=null;

  if(nativeText.length>250 && /percepc|deducc|period|neto/i.test(nativeText)){
    fullText=nativeText;
    parsed=parseTelmexOcr(nativeText,file);
    parsed.ocrSource='Texto interno del PDF · primera página';
  }else{
    onProgress(8);
    const worker=await getTelmexOcrWorker(onProgress);
    try{ await worker.setParameters({tessedit_pageseg_mode:'3'}); }catch{}
    const result=await worker.recognize(canvas);
    fullText=result?.data?.text||'';
    parsed=parseTelmexOcr(fullText,file);
    parsed.ocrSource='OCR local · primera página';
  }

  // Read concept table independently.
  onProgress(78);
  const table=await readTelmexConceptTable(canvas,p=>onProgress(Math.min(90,78+p*0.12)));
  if(table.concepts.length){
    parsed.concepts=table.concepts;
    const tax=table.concepts.find(c=>String(c.code).replace(/^0/,'').startsWith('55'));
    parsed.taxes=tax ? Number(tax.amount||0) : 0;
  }

  if(!(parsed.taxes>0)){
    const full=normalizeOcrText(fullText).split('\n').join(' ');
    const taxMatch=full.match(/(?:^|\s)55\s+Impuesto[\s\S]{0,80}?([0-9][0-9,]*\.\d{2})/i);
    if(taxMatch)parsed.taxes=parseTelmexMoney(taxMatch[1])||0;
  }

  // Read printed totals independently.
  onProgress(91);
  const bottom=await readTelmexBottomTotals(canvas,p=>onProgress(Math.min(99,91+p*0.08)));

  if(bottom.reliable){
    parsed.perceptions=bottom.perceptions;
    parsed.deductions=bottom.deductions;
    parsed.net=bottom.net;
    parsed.totalsReliable=true;
    parsed.totalsSource='Resumen inferior TELMEX';
  }else{
    parsed.totalsReliable=false;
    parsed.totalsSource='Reconstruido / requiere revisión';
  }

  // If totals OCR fails, do not invent totals from repeated/bad concepts.
  // Keep them at zero unless a value came from the independent total reader.
  if(!bottom.reliable){
    parsed.perceptions=0;
    parsed.deductions=0;
  }

  parsed.ocrText=[
    normalizeOcrText(fullText),
    '',
    '--- OCR TABLA DE CONCEPTOS ---',
    table.text||'',
    '',
    '--- OCR RESUMEN INFERIOR ---',
    bottom.text||''
  ].join('\n');

  onProgress(100);
  return parsed;
}

async function processOnePayslip(file,person,profile,onProgress=()=>{}){
  if(profile==='yorsky'){
    return normalizePayslipData({
      person:'Yorsky',source:'Nómina Yorsky',paymentDate:'',period:'',
      perceptions:0,deductions:0,taxes:0,net:0,documentType:'Nómina',
      parserProfile:'yorsky',concepts:[],fileName:file.name,
      ocrText:'',ocrSource:'Perfil pendiente de construir'
    },file);
  }

  if(profile==='telmex'){
    const data=await readTelmexPdfLocally(file,onProgress);
    return normalizePayslipData(data,file);
  }

  // Generic profile: try the same OCR engine, but keep it in review mode.
  const {canvas}=await extractPdfTextAndCanvas(file);
  const worker=await getTelmexOcrWorker(onProgress);
  const result=await worker.recognize(canvas);
  return normalizePayslipData({
    person,source:'Nómina',paymentDate:'',period:'',
    perceptions:0,deductions:0,taxes:0,net:0,documentType:'Nómina',
    parserProfile:'generic-local-ocr',concepts:[],
    ocrText:normalizeOcrText(result?.data?.text||''),
    ocrSource:'OCR genérico · requiere revisión'
  },file);
}

async function processPayslip(){
  if(!selectedIncomeFiles.length)return;
  const person=document.getElementById('payslipPerson').value;
  const profile=document.getElementById('payslipProfile').value;
  payslipQueue=selectedIncomeFiles.map(file=>({file,status:'pending',data:null,error:null}));
  renderBatchQueue();
  for(let i=0;i<payslipQueue.length;i++){
    payslipQueue[i].status='processing';
    renderBatchQueue();
    try{
      const data=await processOnePayslip(
        payslipQueue[i].file,
        person,
        profile,
        progress=>{
          payslipQueue[i].progress=progress;
          renderBatchQueue();
        }
      );
      payslipQueue[i].data=data;
      payslipQueue[i].status=validationState(data);
    }catch(err){
      payslipQueue[i].status='error';
      payslipQueue[i].error=err?.message||'No se pudo procesar';
    }
    renderBatchQueue();
  }
  const valid=payslipQueue.filter(x=>x.status==='valid').length;
  const review=payslipQueue.filter(x=>x.status==='review').length;
  const error=payslipQueue.filter(x=>x.status==='error').length;
  if(valid)toast(`${valid} volante${valid===1?'':'s'} validado${valid===1?'':'s'}.`);
  if(review||error)toast(`${review} para revisar · ${error} con error. Abre 👁 para revisar el texto detectado.`,'warn');
  const first=payslipQueue.findIndex(x=>x.data);
  if(first>=0)openBatchPreview(first);
}

function normalizePayslipData(raw,file=null){
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
    fileName:file?.name||d.fileName||'',
    ocrText:d.ocrText||'',
    ocrSource:d.ocrSource||'',
    totalsSource:d.totalsSource||'',
    totalsReliable:Boolean(d.totalsReliable),
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

  const ocrDetails=document.getElementById('previewOcrDetails');
  const ocrText=document.getElementById('previewOcrText');
  const ocrSource=document.getElementById('previewOcrSource');
  if(ocrSource){
    const parts=[d.ocrSource||''];
    if(d.totalsSource)parts.push(`Totales: ${d.totalsSource}`);
    if(Array.isArray(d.concepts) && d.concepts.length)parts.push(`Conceptos detectados: ${d.concepts.length}`);
    if(d.taxes>0)parts.push(`Impuesto detectado: ${money(d.taxes)}`);
    ocrSource.textContent=parts.filter(Boolean).join(' · ');
  }
  if(ocrDetails)ocrDetails.style.display=d.ocrText?'':'none';
  if(ocrText)ocrText.textContent=d.ocrText||'';

  const calc=d.perceptions-d.deductions;
  const ok=Math.abs(calc-d.net)<0.02;
  const val=document.getElementById('previewValidation');
  const trulyValid=ok && d.totalsReliable;
  val.className='income-validation '+(trulyValid?'ok':'warn');
  if(trulyValid){
    val.textContent=`✓ Validado con totales impresos: ${money(d.perceptions)} − ${money(d.deductions)} = ${money(d.net)}`;
  }else if(ok){
    val.textContent='⚠ Los valores cuadran, pero fueron reconstruidos. Revisar contra el volante.';
  }else{
    val.textContent=`⚠ Revisar: el cálculo da ${money(calc)} y el neto leído es ${money(d.net)}.`;
  }

  document.getElementById('previewConceptRows').innerHTML=d.concepts.length
    ? d.concepts.map(c=>`<tr><td>${esc(c.code)}</td><td>${esc(c.description)}</td><td>${esc(c.kind)}</td><td>${c.hours??''}</td><td>${money(c.amount)}</td></tr>`).join('')
    : '<tr><td colspan="5" style="text-align:center;color:#667085">Sin conceptos detectados</td></tr>';
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
  if(currentPayslipQueueIndex!==null && payslipQueue[currentPayslipQueueIndex]){
    payslipQueue[currentPayslipQueueIndex].data=d;
    payslipQueue[currentPayslipQueueIndex].status=validationState(d);
    renderBatchQueue();
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


async function saveAllValidPayslips(){
  const validItems=payslipQueue.filter(item=>item.status==='valid'&&item.data);
  if(!validItems.length){toast('No hay volantes validados para guardar.','warn');return;}
  const existing=await incomeGetAll();
  let saved=0,skipped=0;
  for(const item of validItems){
    const d=item.data;
    const duplicate=existing.find(x=>
      x.entryType==='nomina'&&x.person===d.person&&x.paymentDate===d.paymentDate&&
      String(x.period||'')===String(d.period||'')&&x.source===d.source
    );
    if(duplicate){skipped++;continue;}
    await incomeAdd({...d,createdAt:d.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()});
    existing.push(d);
    saved++;
  }
  await renderIncomeHistory();
  if(saved)toast(`${saved} volante${saved===1?'':'s'} guardado${saved===1?'':'s'}.`);
  if(skipped)toast(`${skipped} duplicado${skipped===1?'':'s'} omitido${skipped===1?'':'s'}.`,'warn');
  if(saved)switchIncomeView('history');
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
  fileInput.addEventListener('change',e=>addPdfFiles(e.target.files));
  ['dragenter','dragover'].forEach(type=>drop.addEventListener(type,e=>{e.preventDefault();drop.classList.add('dragover')}));
  ['dragleave','drop'].forEach(type=>drop.addEventListener(type,e=>{e.preventDefault();drop.classList.remove('dragover')}));
  drop.addEventListener('drop',e=>addPdfFiles(e.dataTransfer.files));
  document.getElementById('incomeRemovePdf').addEventListener('click',clearPdfFile);
  document.getElementById('incomeProcessPdf').addEventListener('click',processPayslip);
  document.getElementById('saveAllPayslipsBtn').addEventListener('click',saveAllValidPayslips);
  document.getElementById('incomeDemoP39').addEventListener('click',()=>{
    document.getElementById('payslipPerson').value='Ivan';
    document.getElementById('payslipProfile').value='telmex';
    const fakeFile={name:'P39_demo.pdf',size:0};
    const data=normalizePayslipData(P39_DEMO,fakeFile);
    payslipQueue=[{file:fakeFile,status:validationState(data),data,error:null}];
    renderBatchQueue();
    openBatchPreview(0);
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
  refreshSelectedFiles();
  try{
    await openIncomeDb();
    await renderIncomeHistory();
  }catch(err){
    console.error(err);
    toast('No se pudo abrir la base local de Ingresos.','error');
  }
}
