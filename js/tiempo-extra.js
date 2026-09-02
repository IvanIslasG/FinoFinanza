const dayNames=['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];

let currentWeek=[];
let savedWeekData=[];
let editingId=null;
let savedWeeksSort={key:'start',direction:'desc'};
let selectedSavedWeekIds=new Set();
let db=null;

const DB_NAME='FinanzasFamiliaresDB';
const DB_VERSION=1;
const STORE='tiempoExtraSemanas';

function openDB(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=()=>{
      const database=req.result;
      if(!database.objectStoreNames.contains(STORE)){
        database.createObjectStore(STORE,{keyPath:'id',autoIncrement:true});
      }
    };
    req.onsuccess=()=>{db=req.result;resolve(db)};
    req.onerror=()=>reject(req.error);
  });
}
function getAll(){
  return new Promise((resolve,reject)=>{
    const req=db.transaction(STORE,'readonly').objectStore(STORE).getAll();
    req.onsuccess=()=>resolve(req.result||[]);
    req.onerror=()=>reject(req.error);
  });
}
function addItem(item){
  return new Promise((resolve,reject)=>{
    const req=db.transaction(STORE,'readwrite').objectStore(STORE).add(item);
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}
function putItem(item){
  return new Promise((resolve,reject)=>{
    const req=db.transaction(STORE,'readwrite').objectStore(STORE).put(item);
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}
function delItem(id){
  return new Promise((resolve,reject)=>{
    const req=db.transaction(STORE,'readwrite').objectStore(STORE).delete(id);
    req.onsuccess=()=>resolve();
    req.onerror=()=>reject(req.error);
  });
}

function toInputDate(d){
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function formatDateEs(s){
  if(!s)return'—';
  const [y,m,d]=s.split('-');
  return `${d}/${m}/${y}`;
}
function minutesBetween(start,end){
  if(!start||!end)return 0;
  const [sh,sm]=start.split(':').map(Number);
  const [eh,em]=end.split(':').map(Number);
  let a=sh*60+sm,b=eh*60+em;
  if(b<a)b+=1440;
  return Math.max(0,b-a);
}
function hhmm(mins){
  return `${String(Math.floor(mins/60)).padStart(2,'0')}:${String(mins%60).padStart(2,'0')}`;
}
function nearestMonday(date){
  const d=new Date(date);
  const day=d.getDay();
  const diff=(day===0?-6:1-day);
  d.setDate(d.getDate()+diff);
  d.setHours(12,0,0,0);
  return d;
}
function isoWeekNumber(date){
  const d=new Date(Date.UTC(date.getFullYear(),date.getMonth(),date.getDate()));
  const dayNum=d.getUTCDay()||7;
  d.setUTCDate(d.getUTCDate()+4-dayNum);
  const yearStart=new Date(Date.UTC(d.getUTCFullYear(),0,1));
  return Math.ceil((((d-yearStart)/86400000)+1)/7);
}
function secondSaturdayAfter(dateStr){
  if(!dateStr)return'';
  const d=new Date(dateStr+'T12:00:00');
  let daysToSaturday=(6-d.getDay()+7)%7;
  if(daysToSaturday===0)daysToSaturday=7;
  d.setDate(d.getDate()+daysToSaturday+7);
  return toInputDate(d);
}
function setExpectedPay(){
  document.getElementById('weekPayDate').value=
    secondSaturdayAfter(document.getElementById('weekReportDate').value);
}

function initWeek(){
  const monday=nearestMonday(new Date());
  document.getElementById('weekStart').value=toInputDate(monday);
  document.getElementById('weekPeriod').value=isoWeekNumber(monday);
  const report=new Date(monday);
  report.setDate(monday.getDate()+7);
  document.getElementById('weekReportDate').value=toInputDate(report);
  setExpectedPay();
  buildWeek();
}
function buildWeek(){
  const value=document.getElementById('weekStart').value;
  if(!value)return;
  const monday=nearestMonday(new Date(value+'T12:00:00'));
  document.getElementById('weekStart').value=toInputDate(monday);
  document.getElementById('weekPeriod').value=isoWeekNumber(monday);

  currentWeek=[];
  const grid=document.getElementById('weekGrid');
  grid.innerHTML='';

  for(let i=0;i<7;i++){
    const d=new Date(monday);
    d.setDate(monday.getDate()+i);
    const date=toInputDate(d);
    currentWeek.push({date,start:i<5?'16:00':'',end:'',activity:'',minutes:0});

    const card=document.createElement('div');
    card.className='day-card';
    card.innerHTML=`
      <div class="dow">${dayNames[i]}</div>
      <div class="date">${formatDateEs(date)}</div>
      <input type="time" data-i="${i}" data-f="start" value="${i<5?'16:00':''}">
      <input type="time" data-i="${i}" data-f="end">
      <textarea data-i="${i}" data-f="activity" placeholder="Actividad"></textarea>
      <div class="hours" id="hours-${i}">00:00</div>`;
    grid.appendChild(card);
  }

  grid.querySelectorAll('input,textarea').forEach(el=>{
    el.addEventListener('input',e=>{
      const i=Number(e.target.dataset.i);
      const field=e.target.dataset.f;
      currentWeek[i][field]=e.target.value;
      currentWeek[i].minutes=minutesBetween(currentWeek[i].start,currentWeek[i].end);
      document.getElementById('hours-'+i).textContent=hhmm(currentWeek[i].minutes);
      updateWeekTotal();
    });
  });
  updateWeekTotal();
}
function updateWeekTotal(){
  document.getElementById('weekTotal').textContent=
    hhmm(currentWeek.reduce((sum,row)=>sum+row.minutes,0));
}

async function saveCurrentWeek(){
  if(!currentWeek.some(r=>r.minutes>0||(r.activity||'').trim())){
    alert('No hay tiempo extra capturado.');
    return;
  }
  const item={
    periodo:document.getElementById('weekPeriod').value,
    start:currentWeek[0].date,
    end:currentWeek[6].date,
    total:currentWeek.reduce((s,r)=>s+r.minutes,0),
    report:document.getElementById('weekReportDate').value,
    pay:document.getElementById('weekPayDate').value,
    status:'Borrador',
    entries:JSON.parse(JSON.stringify(currentWeek)),
    createdAt:new Date().toISOString()
  };
  await addItem(item);
  await loadSavedWeeks();
  alert('Semana guardada localmente.');
}

async function loadSavedWeeks(){
  savedWeekData=await getAll();
  savedWeekData.sort((a,b)=>b.start.localeCompare(a.start));
  renderSavedWeeks();
}

function sortValueForWeek(week,key){
  switch(key){
    case 'periodo':{
      const match=String(week.periodo??'').match(/\d+/);
      return match?Number(match[0]):-1;
    }
    case 'start':
      return week.start||'';
    case 'total':
      return Number(week.total||0);
    case 'report':
      return week.report||'';
    case 'pay':
      return week.pay||'';
    case 'status':
      return String(week.status||'Borrador').toLocaleLowerCase('es');
    default:
      return '';
  }
}

function getSortedSavedWeeks(){
  const {key,direction}=savedWeeksSort;
  const factor=direction==='asc'?1:-1;

  return [...savedWeekData].sort((a,b)=>{
    const av=sortValueForWeek(a,key);
    const bv=sortValueForWeek(b,key);

    if(typeof av==='number' && typeof bv==='number'){
      return (av-bv)*factor;
    }

    return String(av).localeCompare(String(bv),'es',{numeric:true,sensitivity:'base'})*factor;
  });
}

function updateSavedWeeksHeaderIndicators(){
  document.querySelectorAll('#savedWeeks').forEach(()=>{});
  const table=document.getElementById('savedWeeks')?.closest('table');
  if(!table)return;

  table.querySelectorAll('th[data-sort]').forEach(th=>{
    const label=th.dataset.label||th.textContent.replace(/[▲▼↕]/g,'').trim();
    th.dataset.label=label;
    th.style.cursor='pointer';
    th.style.userSelect='none';
    th.title='Haz clic para ordenar';

    if(savedWeeksSort.key===th.dataset.sort){
      th.textContent=`${label} ${savedWeeksSort.direction==='asc'?'▲':'▼'}`;
      th.setAttribute('aria-sort',savedWeeksSort.direction==='asc'?'ascending':'descending');
    }else{
      th.textContent=`${label} ↕`;
      th.setAttribute('aria-sort','none');
    }
  });
}

function enableSavedWeeksSorting(){
  const table=document.getElementById('savedWeeks')?.closest('table');
  if(!table)return;

  const sortable=[
    ['periodo','periodo'],
    ['semana','start'],
    ['total','total'],
    ['reporte','report'],
    ['pago estimado','pay'],
    ['estado','status']
  ];

  const headers=[...table.querySelectorAll('thead th')];
  sortable.forEach(([label,key])=>{
    const th=headers.find(h=>normalizeHeader(h.textContent)===label);
    if(!th || th.dataset.sortBound==='1')return;

    th.dataset.sort=key;
    th.dataset.sortBound='1';
    th.dataset.label=th.textContent.trim();
    th.addEventListener('click',()=>{
      if(savedWeeksSort.key===key){
        savedWeeksSort.direction=savedWeeksSort.direction==='asc'?'desc':'asc';
      }else{
        savedWeeksSort.key=key;
        savedWeeksSort.direction=key==='start'?'desc':'asc';
      }
      renderSavedWeeks();
    });
  });

  updateSavedWeeksHeaderIndicators();
}


function ensureSavedWeeksBulkUI(){
  const body=document.getElementById('savedWeeks');
  const table=body?.closest('table');
  if(!table)return;

  // Insert selection header if missing.
  const headerRow=table.querySelector('thead tr');
  if(headerRow && !headerRow.querySelector('[data-select-header]')){
    const th=document.createElement('th');
    th.setAttribute('data-select-header','1');
    th.style.width='38px';
    th.innerHTML='<input type="checkbox" id="selectAllSavedWeeks" aria-label="Seleccionar todas las semanas">';
    headerRow.insertBefore(th,headerRow.firstChild);

    th.querySelector('input').addEventListener('change',e=>{
      const visibleIds=[...document.querySelectorAll('#savedWeeks input[data-select-week]')]
        .map(cb=>Number(cb.dataset.selectWeek));
      if(e.target.checked){
        visibleIds.forEach(id=>selectedSavedWeekIds.add(id));
      }else{
        visibleIds.forEach(id=>selectedSavedWeekIds.delete(id));
      }
      document.querySelectorAll('#savedWeeks input[data-select-week]').forEach(cb=>{
        cb.checked=selectedSavedWeekIds.has(Number(cb.dataset.selectWeek));
      });
      updateBulkDeleteUI();
    });
  }

  // Add compact bulk toolbar close to the records area.
  const exportButton=document.getElementById('exportTEJson');
  const actionArea=exportButton?.parentElement;
  if(actionArea){
    actionArea.classList.add('te-compact-tools');

    ['pasteTETableBtn','importTEExcelBtn','importTEJsonBtn','exportTEJson'].forEach(id=>{
      const btn=document.getElementById(id);
      if(btn){
        btn.classList.remove('secondary-btn');
        btn.classList.add('te-tool-btn');
      }
    });

    if(!document.getElementById('deleteSelectedWeeks')){
      const deleteBtn=document.createElement('button');
      deleteBtn.id='deleteSelectedWeeks';
      deleteBtn.type='button';
      deleteBtn.className='te-tool-btn te-tool-danger';
      deleteBtn.textContent='Eliminar seleccionados';
      deleteBtn.disabled=true;
      deleteBtn.addEventListener('click',deleteSelectedWeeks);
      actionArea.appendChild(deleteBtn);
    }
  }

  if(!document.getElementById('teBulkStyle')){
    const style=document.createElement('style');
    style.id='teBulkStyle';
    style.textContent=`
      .te-compact-tools{display:flex!important;gap:6px!important;align-items:center!important;flex-wrap:wrap!important}
      .te-tool-btn{
        min-height:30px;border:1px solid #e4e7ec;background:#fff;color:#475467;border-radius:8px;
        padding:5px 9px;font-size:11px;font-weight:700;cursor:pointer;box-shadow:none
      }
      .te-tool-btn:hover{background:#f8fafc;border-color:#d0d5dd;color:#344054}
      .te-tool-btn:disabled{opacity:.45;cursor:not-allowed}
      .te-tool-danger{color:#b42318;border-color:#fecdca}
      .te-tool-danger:not(:disabled):hover{background:#fef3f2;border-color:#fda29b}
      #savedWeeks td:first-child,#savedWeeks th:first-child{text-align:center}
      #savedWeeks input[type="checkbox"],#selectAllSavedWeeks{width:15px;height:15px;cursor:pointer;accent-color:#155eef}
    `;
    document.head.appendChild(style);
  }

  updateBulkDeleteUI();
}

function updateBulkDeleteUI(){
  const button=document.getElementById('deleteSelectedWeeks');
  const count=selectedSavedWeekIds.size;
  if(button){
    button.disabled=count===0;
    button.textContent=count>0?`Eliminar seleccionados (${count})`:'Eliminar seleccionados';
  }

  const selectAll=document.getElementById('selectAllSavedWeeks');
  const rowChecks=[...document.querySelectorAll('#savedWeeks input[data-select-week]')];
  if(selectAll){
    const selectedVisible=rowChecks.filter(cb=>selectedSavedWeekIds.has(Number(cb.dataset.selectWeek))).length;
    selectAll.checked=rowChecks.length>0 && selectedVisible===rowChecks.length;
    selectAll.indeterminate=selectedVisible>0 && selectedVisible<rowChecks.length;
  }
}

async function deleteSelectedWeeks(){
  const ids=[...selectedSavedWeekIds];
  if(!ids.length)return;

  if(!confirm(`¿Eliminar ${ids.length} registro(s) de Tiempo Extra?\n\nEsta acción no se puede deshacer.`))return;

  for(const id of ids){
    try{
      await delItem(id);
    }catch(error){
      console.error('No se pudo eliminar el registro',id,error);
    }
  }

  selectedSavedWeekIds.clear();
  await loadSavedWeeks();
  updateBulkDeleteUI();
}

function bindSavedWeekSelectors(){
  document.querySelectorAll('#savedWeeks input[data-select-week]').forEach(cb=>{
    const id=Number(cb.dataset.selectWeek);
    cb.checked=selectedSavedWeekIds.has(id);
    cb.addEventListener('change',()=>{
      if(cb.checked)selectedSavedWeekIds.add(id);
      else selectedSavedWeekIds.delete(id);
      updateBulkDeleteUI();
    });
  });
  updateBulkDeleteUI();
}

function renderSavedWeeks(){
  const body=document.getElementById('savedWeeks');
  if(!savedWeekData.length){
    body.innerHTML='<tr><td colspan="8" style="text-align:center;color:#667085;padding:24px">Aún no hay semanas guardadas.</td></tr>';
    enableSavedWeeksSorting();
    updateSavedWeeksHeaderIndicators();
    ensureSavedWeeksBulkUI();
    bindSavedWeekSelectors();
    return;
  }

  const orderedWeeks=getSortedSavedWeeks();
  body.innerHTML=orderedWeeks.map(w=>`
    <tr>
      <td><input type="checkbox" data-select-week="${w.id}" aria-label="Seleccionar periodo ${w.periodo}"></td>
      <td>${w.periodo}</td>
      <td>${formatDateEs(w.start)} – ${formatDateEs(w.end)}</td>
      <td><strong>${hhmm(w.total||0)}</strong></td>
      <td>${formatDateEs(w.report)}</td>
      <td>${formatDateEs(w.pay)}</td>
      <td><span class="status-pill">${w.status||'Borrador'}</span></td>
      <td>
        <button class="action-btn" data-view="${w.id}">Ver</button>
        <button class="action-btn" data-edit="${w.id}">Editar</button>
        <button class="action-btn danger" data-delete="${w.id}">Eliminar</button>
      </td>
    </tr>`).join('');

  body.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>openWeekView(Number(b.dataset.view))));
  body.querySelectorAll('[data-edit]').forEach(b=>b.addEventListener('click',()=>openEditor(Number(b.dataset.edit))));
  body.querySelectorAll('[data-delete]').forEach(b=>b.addEventListener('click',()=>deleteWeek(Number(b.dataset.delete))));
  enableSavedWeeksSorting();
  updateSavedWeeksHeaderIndicators();
  ensureSavedWeeksBulkUI();
  bindSavedWeekSelectors();
}

function buildWeekMessageText(w){
  const lines=[
    `TIEMPO EXTRA - PERIODO ${w.periodo}`,
    `Semana: ${formatDateEs(w.start)} al ${formatDateEs(w.end)}`,
    `Fecha de reporte: ${formatDateEs(w.report)}`,
    `Pago estimado: ${formatDateEs(w.pay)}`,
    '',
    'Detalle:'
  ];
  (w.entries||[]).forEach((r,i)=>{
    if((r.minutes||0)>0||(r.activity||'').trim()){
      lines.push(`${dayNames[i]} ${formatDateEs(r.date)} | ${r.start||'—'}-${r.end||'—'} | ${hhmm(r.minutes||minutesBetween(r.start,r.end))} h | ${r.activity||''}`);
    }
  });
  lines.push('',`TOTAL: ${hhmm(w.total||0)} h`);
  return lines.join(String.fromCharCode(10));
}
function buildExcelTSV(w){
  const rows=[['Día','Fecha','Hora inicio','Hora fin','Horas','Actividad']];
  (w.entries||[]).forEach((r,i)=>{
    if((r.minutes||0)>0||(r.activity||'').trim()){
      const activity=(r.activity||'')
        .split(String.fromCharCode(9)).join(' ')
        .split(String.fromCharCode(10)).join(' ')
        .split(String.fromCharCode(13)).join(' ');
      rows.push([dayNames[i],formatDateEs(r.date),r.start||'',r.end||'',hhmm(r.minutes||minutesBetween(r.start,r.end)),activity]);
    }
  });
  rows.push(['TOTAL','','','',hhmm(w.total||0),'']);
  return rows.map(r=>r.join(String.fromCharCode(9))).join(String.fromCharCode(10));
}
async function copyText(text,button){
  try{
    await navigator.clipboard.writeText(text);
  }catch{
    const ta=document.createElement('textarea');
    ta.value=text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  const old=button.textContent;
  button.textContent='Copiado ✓';
  setTimeout(()=>button.textContent=old,1500);
}

function openWeekView(id){
  const w=savedWeekData.find(x=>x.id===id);
  if(!w)return;

  document.getElementById('weekViewMeta').textContent=`Periodo ${w.periodo} · ${formatDateEs(w.start)} – ${formatDateEs(w.end)} · ${hhmm(w.total||0)} h`;
  document.getElementById('reportTitle').textContent=`Periodo ${w.periodo}`;
  document.getElementById('reportSubtitle').textContent=`Semana del ${formatDateEs(w.start)} al ${formatDateEs(w.end)}`;
  document.getElementById('reportTotal').textContent=`${hhmm(w.total||0)} h`;
  document.getElementById('reportPeriod').textContent=w.periodo||'—';
  document.getElementById('reportDate').textContent=formatDateEs(w.report);
  document.getElementById('reportPay').textContent=formatDateEs(w.pay);
  document.getElementById('reportStatus').textContent=w.status||'Borrador';
  document.getElementById('reportFootTotal').textContent=hhmm(w.total||0);

  const body=document.getElementById('reportRows');
  body.innerHTML='';
  (w.entries||[]).forEach((r,i)=>{
    if((r.minutes||0)>0||(r.activity||'').trim()){
      const tr=document.createElement('tr');
      tr.innerHTML=`<td><strong>${dayNames[i]}</strong></td><td>${formatDateEs(r.date)}</td><td>${r.start||'—'}</td><td>${r.end||'—'}</td><td><strong>${hhmm(r.minutes||minutesBetween(r.start,r.end))}</strong></td><td>${r.activity||''}</td>`;
      body.appendChild(tr);
    }
  });

  const panel=document.getElementById('weekViewPanel');
  panel.dataset.weekId=String(id);
  panel.classList.add('show');
  document.getElementById('weekEditor').classList.remove('show');
  panel.scrollIntoView({behavior:'smooth',block:'start'});
}

function openEditor(id){
  const w=savedWeekData.find(x=>x.id===id);
  if(!w)return;
  editingId=id;
  document.getElementById('editPeriod').value=w.periodo||'';
  document.getElementById('editReport').value=w.report||'';
  document.getElementById('editPay').value=w.pay||'';
  document.getElementById('editStatus').value=w.status||'Borrador';

  const box=document.getElementById('editorDays');
  box.innerHTML='';
  (w.entries||[]).forEach((r,i)=>{
    const row=document.createElement('div');
    row.className='editor-day';
    row.innerHTML=`
      <div class="ed-label"><strong>${dayNames[i]}</strong><br><small>${formatDateEs(r.date)}</small></div>
      <input type="time" data-ei="${i}" data-ef="start" value="${r.start||''}">
      <input type="time" data-ei="${i}" data-ef="end" value="${r.end||''}">
      <input type="text" data-ei="${i}" data-ef="activity" value="${(r.activity||'').replace(/"/g,'&quot;')}" placeholder="Actividad">`;
    box.appendChild(row);
  });

  document.getElementById('weekEditor').classList.add('show');
  document.getElementById('weekViewPanel').classList.remove('show');
  document.getElementById('weekEditor').scrollIntoView({behavior:'smooth'});
}

async function deleteWeek(id){
  const w=savedWeekData.find(x=>x.id===id);
  if(!w)return;
  if(!confirm(`¿Eliminar la semana ${formatDateEs(w.start)} – ${formatDateEs(w.end)}?`))return;
  await delItem(id);
  await loadSavedWeeks();
}

async function saveEdit(){
  const w=savedWeekData.find(x=>x.id===editingId);
  if(!w)return;

  const entries=JSON.parse(JSON.stringify(w.entries||[]));
  document.querySelectorAll('#editorDays [data-ei]').forEach(el=>{
    entries[Number(el.dataset.ei)][el.dataset.ef]=el.value;
  });
  entries.forEach(r=>{ if(r.start && r.end) r.minutes=minutesBetween(r.start,r.end); });

  await putItem({
    ...w,
    periodo:document.getElementById('editPeriod').value,
    report:document.getElementById('editReport').value,
    pay:document.getElementById('editPay').value,
    status:document.getElementById('editStatus').value,
    entries,
    total:entries.reduce((s,r)=>s+r.minutes,0),
    updatedAt:new Date().toISOString()
  });

  await loadSavedWeeks();
  document.getElementById('weekEditor').classList.remove('show');
  alert('Cambios guardados.');
}


// ---------- Importador flexible de tablas / Excel ----------
let tableImportState={
  rows:[],
  headerRow:0,
  mapping:{},
  sourceLabel:'Tabla pegada'
};

const TABLE_FIELDS=[
  {value:'',label:'Ignorar'},
  {value:'date',label:'Fecha'},
  {value:'start',label:'Hora inicio'},
  {value:'end',label:'Hora fin'},
  {value:'hours',label:'Horas'},
  {value:'activity',label:'Actividad'},
  {value:'period',label:'Periodo / Semana'},
  {value:'report',label:'Fecha de reporte'},
  {value:'pay',label:'Fecha de pago'}
];

function normalizeHeader(value){
  return String(value??'')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase().trim()
    .replace(/\s+/g,' ');
}

function guessField(header){
  const h=normalizeHeader(header);
  if(!h)return'';
  if(/^(fecha|dia|date)$/.test(h) || h.includes('fecha actividad')) return 'date';
  if(h.includes('hora inicio') || h==='inicio' || h==='entrada' || h==='desde') return 'start';
  if(h.includes('hora fin') || h==='fin' || h==='salida' || h==='hasta') return 'end';
  if(h==='horas' || h==='hora' || h.includes('total horas')) return 'hours';
  if(h.includes('actividad') || h.includes('descripcion') || h.includes('detalle') || h.includes('trabajo') || h.includes('motivo') || h.includes('concepto')) return 'activity';
  if(h.includes('periodo') || h.includes('semana')) return 'period';
  if(h.includes('fecha reporte') || h==='reporte' || h.includes('reportado')) return 'report';
  if(h.includes('fecha pago') || h==='pago' || h.includes('pago estimado')) return 'pay';
  return '';
}

function headerScore(row){
  return row.reduce((score,cell)=>score+(guessField(cell)?1:0),0);
}

function detectHeaderRow(rows){
  let bestIndex=0,bestScore=-1;
  rows.slice(0,25).forEach((row,i)=>{
    const score=headerScore(row);
    if(score>bestScore){bestScore=score;bestIndex=i;}
  });
  return bestIndex;
}

function parseDelimitedText(text){
  const clean=String(text||'').replace(/\r\n/g,'\n').replace(/\r/g,'\n').trim();
  if(!clean)return[];
  const lines=clean.split('\n').filter(line=>line.trim().length);
  const tabCount=(lines[0].match(/\t/g)||[]).length;
  const semicolonCount=(lines[0].match(/;/g)||[]).length;
  const commaCount=(lines[0].match(/,/g)||[]).length;
  const delimiter=tabCount>=Math.max(semicolonCount,commaCount)?'\t':(semicolonCount>=commaCount?';':',');
  return lines.map(line=>line.split(delimiter).map(v=>v.trim()));
}

function parseFlexibleDate(value){
  if(value==null || value==='')return'';
  if(value instanceof Date && !isNaN(value))return toInputDate(value);
  const s=String(value).trim();

  function validYMD(year,month,day){
    const d=new Date(year,month-1,day,12,0,0);
    if(
      d.getFullYear()!==year ||
      d.getMonth()!==month-1 ||
      d.getDate()!==day
    ) return '';
    return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }

  let m=s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if(m)return validYMD(Number(m[1]),Number(m[2]),Number(m[3]));

  m=s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if(m){
    const a=Number(m[1]), b=Number(m[2]);
    let year=Number(m[3]);
    if(year<100)year+=year>=70?1900:2000;

    // Si una de las dos primeras partes es > 12, la interpretación es inequívoca.
    if(a>12 && b<=12) return validYMD(year,b,a); // DD/MM/YY
    if(b>12 && a<=12) return validYMD(year,a,b); // MM/DD/YY

    // Para fechas ambiguas (p. ej. 01/02/26) preferimos DD/MM,
    // que es el formato habitual en México.
    return validYMD(year,b,a) || validYMD(year,a,b);
  }

  const d=new Date(s);
  if(!isNaN(d))return toInputDate(d);
  return '';
}

function parseFlexibleTime(value){
  if(value==null || value==='')return'';
  if(typeof value==='number' && value>=0 && value<1){
    const mins=Math.round(value*24*60);
    return `${String(Math.floor(mins/60)%24).padStart(2,'0')}:${String(mins%60).padStart(2,'0')}`;
  }

  let s=String(value).trim().toLowerCase()
    .replace(/\./g,'')
    .replace(/\s+/g,' ');

  const am=/\b(am|a m)\b/.test(s);
  const pm=/\b(pm|p m)\b/.test(s);
  s=s.replace(/\b(am|pm|a m|p m)\b/g,'').trim();

  const m=s.match(/(\d{1,2})[:.](\d{2})/);
  if(!m)return'';
  let h=Number(m[1]),min=Number(m[2]);
  if(pm && h<12)h+=12;
  if(am && h===12)h=0;
  if(h>23 || min>59)return'';
  return `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
}

function parseDurationMinutes(value){
  if(value==null || value==='')return 0;
  if(typeof value==='number'){
    if(value>=0 && value<1)return Math.round(value*24*60);
    if(value>=0 && value<=24)return Math.round(value*60);
  }
  const s=String(value).trim().toLowerCase().replace(',','.');
  let m=s.match(/^(\d{1,3}):(\d{2})$/);
  if(m)return Number(m[1])*60+Number(m[2]);
  m=s.match(/^(\d+(?:\.\d+)?)\s*(h|hrs?|horas?)?$/);
  if(m)return Math.round(Number(m[1])*60);
  return 0;
}

function mondayFromDateString(dateStr){
  const d=new Date(dateStr+'T12:00:00');
  return toInputDate(nearestMonday(d));
}

function sundayFromMonday(mondayStr){
  const d=new Date(mondayStr+'T12:00:00');
  d.setDate(d.getDate()+6);
  return toInputDate(d);
}

function nextMondayFromWeek(mondayStr){
  const d=new Date(mondayStr+'T12:00:00');
  d.setDate(d.getDate()+7);
  return toInputDate(d);
}

function createImportUI(){
  if(document.getElementById('teTableImportModal'))return;

  const style=document.createElement('style');
  style.textContent=`
    .te-import-tools{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
    .te-import-overlay{display:none;position:fixed;inset:0;background:rgba(15,23,42,.48);z-index:9999;padding:28px;overflow:auto}
    .te-import-overlay.show{display:block}
    .te-import-modal{max-width:1080px;margin:0 auto;background:#fff;border-radius:18px;border:1px solid #e4e7ec;box-shadow:0 24px 70px rgba(15,23,42,.22);overflow:hidden}
    .te-import-head{padding:18px 20px;border-bottom:1px solid #e4e7ec;display:flex;justify-content:space-between;gap:14px;align-items:flex-start}
    .te-import-head h3{margin:0 0 4px;font-size:18px}.te-import-head p{margin:0;color:#667085;font-size:12px}
    .te-import-body{padding:20px}.te-import-area{width:100%;min-height:170px;border:1px solid #d0d5dd;border-radius:12px;padding:12px;resize:vertical;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
    .te-import-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
    .te-import-preview{display:none;margin-top:18px}.te-import-preview.show{display:block}
    .te-import-summary{padding:11px 12px;background:#f8fafc;border:1px solid #e4e7ec;border-radius:10px;color:#475467;font-size:12px;margin-bottom:12px}
    .te-map-wrap{overflow:auto;border:1px solid #e4e7ec;border-radius:12px}
    .te-map-table{width:100%;border-collapse:collapse;min-width:760px}.te-map-table th,.te-map-table td{padding:8px;border-bottom:1px solid #e4e7ec;font-size:11px;text-align:left;vertical-align:top}
    .te-map-table th{background:#f8fafc}.te-map-table select{width:100%;min-width:115px;border:1px solid #d0d5dd;border-radius:8px;padding:6px;background:#fff}
    .te-import-error{display:none;margin-top:10px;padding:10px 12px;border-radius:9px;background:#fef3f2;color:#b42318;font-size:12px}
    @media(max-width:720px){.te-import-overlay{padding:10px}.te-import-body{padding:14px}}
  `;
  document.head.appendChild(style);

  const overlay=document.createElement('div');
  overlay.id='teTableImportModal';
  overlay.className='te-import-overlay';
  overlay.innerHTML=`
    <div class="te-import-modal" role="dialog" aria-modal="true" aria-labelledby="teImportTitle">
      <div class="te-import-head">
        <div>
          <h3 id="teImportTitle">Importar tiempo extra desde una tabla</h3>
          <p>Pega celdas copiadas desde Excel/Google Sheets o selecciona un archivo Excel. Revisa las columnas antes de guardar.</p>
        </div>
        <button class="copy-btn" id="teImportClose" type="button">Cerrar</button>
      </div>
      <div class="te-import-body">
        <textarea class="te-import-area" id="teImportPaste" placeholder="Pega aquí tu tabla. Ejemplo:&#10;Fecha    Inicio    Fin    Horas    Actividad    Periodo&#10;31/08/2026    16:00    19:00    03:00    Atención INS2748    36"></textarea>
        <div class="te-import-actions">
          <button class="primary-btn" id="teAnalyzePaste" type="button">Analizar tabla</button>
          <button class="secondary-btn" id="teChooseExcel" type="button">Seleccionar Excel</button>
          <input id="teExcelInput" type="file" accept=".xlsx,.xls,.xlsm" hidden>
        </div>
        <div class="te-import-error" id="teImportError"></div>
        <div class="te-import-preview" id="teImportPreview">
          <div class="te-import-summary" id="teImportSummary"></div>
          <div class="te-map-wrap">
            <table class="te-map-table">
              <thead id="teMapHead"></thead>
              <tbody id="teMapBody"></tbody>
            </table>
          </div>
          <div class="te-import-actions">
            <button class="primary-btn" id="teCommitImport" type="button">Importar registros</button>
            <button class="secondary-btn" id="teResetImport" type="button">Limpiar</button>
          </div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const actionArea=document.getElementById('exportTEJson')?.parentElement;
  if(actionArea){
    const pasteBtn=document.createElement('button');
    pasteBtn.type='button';
    pasteBtn.className='secondary-btn';
    pasteBtn.id='pasteTETableBtn';
    pasteBtn.textContent='Pegar tabla';

    const excelBtn=document.createElement('button');
    excelBtn.type='button';
    excelBtn.className='secondary-btn';
    excelBtn.id='importTEExcelBtn';
    excelBtn.textContent='Importar Excel';

    actionArea.insertBefore(pasteBtn,actionArea.firstChild);
    actionArea.insertBefore(excelBtn,pasteBtn.nextSibling);
  }

  document.getElementById('pasteTETableBtn')?.addEventListener('click',()=>openImportModal());
  document.getElementById('importTEExcelBtn')?.addEventListener('click',()=>{
    openImportModal();
    document.getElementById('teExcelInput').click();
  });
  document.getElementById('teImportClose').addEventListener('click',closeImportModal);
  overlay.addEventListener('click',e=>{if(e.target===overlay)closeImportModal();});
  document.getElementById('teAnalyzePaste').addEventListener('click',analyzePastedTable);
  document.getElementById('teChooseExcel').addEventListener('click',()=>document.getElementById('teExcelInput').click());
  document.getElementById('teExcelInput').addEventListener('change',handleExcelFile);
  document.getElementById('teCommitImport').addEventListener('click',commitMappedTableImport);
  document.getElementById('teResetImport').addEventListener('click',resetTableImport);
}

function openImportModal(){
  document.getElementById('teTableImportModal')?.classList.add('show');
}
function closeImportModal(){
  document.getElementById('teTableImportModal')?.classList.remove('show');
}
function showImportError(message){
  const box=document.getElementById('teImportError');
  box.textContent=message;
  box.style.display='block';
}
function clearImportError(){
  const box=document.getElementById('teImportError');
  box.textContent='';
  box.style.display='none';
}
function resetTableImport(){
  tableImportState={rows:[],headerRow:0,mapping:{},sourceLabel:'Tabla pegada'};
  document.getElementById('teImportPaste').value='';
  document.getElementById('teImportPreview').classList.remove('show');
  clearImportError();
}

function analyzeRows(rows,sourceLabel='Tabla pegada'){
  clearImportError();
  const normalized=rows
    .map(row=>Array.from(row||[]).map(v=>v==null?'':String(v).trim()))
    .filter(row=>row.some(cell=>cell!==''));

  if(normalized.length<2){
    showImportError('No se detectaron suficientes filas para importar.');
    return;
  }

  const headerRow=detectHeaderRow(normalized);
  const headers=normalized[headerRow];
  const mapping={};
  headers.forEach((h,i)=>mapping[i]=guessField(h));

  // Formato frecuente: una celda "TE" combinada sobre dos columnas:
  // TE | [vacío] | Horas  => Inicio | Fin | Horas
  headers.forEach((header,i)=>{
    if(normalizeHeader(header)==='te'){
      const nextHeader=normalizeHeader(headers[i+1]??'');
      const afterNext=normalizeHeader(headers[i+2]??'');
      if(!nextHeader && (afterNext==='horas' || afterNext==='hora')){
        mapping[i]='start';
        mapping[i+1]='end';
        mapping[i+2]='hours';
      }
    }
  });

  tableImportState={rows:normalized,headerRow,mapping,sourceLabel};
  renderMappingPreview();
}

function analyzePastedTable(){
  const rows=parseDelimitedText(document.getElementById('teImportPaste').value);
  analyzeRows(rows,'Tabla pegada');
}

function renderMappingPreview(){
  const {rows,headerRow,mapping,sourceLabel}=tableImportState;
  const headers=rows[headerRow];
  const dataRows=rows.slice(headerRow+1);
  const mappedCount=Object.values(mapping).filter(Boolean).length;

  document.getElementById('teImportSummary').textContent=
    `${sourceLabel} · ${dataRows.length} filas de datos · ${headers.length} columnas · ${mappedCount} columnas reconocidas automáticamente.`;

  const head=document.getElementById('teMapHead');
  const body=document.getElementById('teMapBody');

  const selects=headers.map((header,i)=>{
    const options=TABLE_FIELDS.map(field=>
      `<option value="${field.value}" ${mapping[i]===field.value?'selected':''}>${field.label}</option>`
    ).join('');
    return `<th><div style="font-weight:800;margin-bottom:5px">${header||`Columna ${i+1}`}</div><select data-map-col="${i}">${options}</select></th>`;
  }).join('');

  head.innerHTML=`<tr>${selects}</tr>`;

  const previewRows=dataRows.slice(0,8);
  body.innerHTML=previewRows.map(row=>
    `<tr>${headers.map((_,i)=>`<td>${row[i]??''}</td>`).join('')}</tr>`
  ).join('');

  head.querySelectorAll('[data-map-col]').forEach(select=>{
    select.addEventListener('change',e=>{
      tableImportState.mapping[Number(e.target.dataset.mapCol)]=e.target.value;
    });
  });

  document.getElementById('teImportPreview').classList.add('show');
}

async function handleExcelFile(event){
  const file=event.target.files?.[0];
  event.target.value='';
  if(!file)return;

  clearImportError();
  document.getElementById('teImportSummary').textContent='Leyendo archivo Excel…';
  document.getElementById('teImportPreview').classList.add('show');

  try{
    const XLSX=await import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm');
    const buffer=await file.arrayBuffer();
    const workbook=XLSX.read(buffer,{type:'array',cellDates:true});

    let best=null;
    for(const sheetName of workbook.SheetNames){
      const sheet=workbook.Sheets[sheetName];
      const rows=XLSX.utils.sheet_to_json(sheet,{header:1,raw:false,defval:''});
      const normalized=rows.filter(row=>Array.isArray(row)&&row.some(cell=>String(cell).trim()));
      if(!normalized.length)continue;
      const header=detectHeaderRow(normalized);
      const score=headerScore(normalized[header]||[]);
      if(!best || score>best.score){
        best={sheetName,rows:normalized,score};
      }
    }

    if(!best){
      showImportError('No se encontraron tablas utilizables en el archivo.');
      return;
    }

    analyzeRows(best.rows,`${file.name} · hoja "${best.sheetName}"`);
  }catch(error){
    console.error(error);
    showImportError('No se pudo leer el archivo Excel. Puedes copiar la tabla desde Excel y usar “Pegar tabla” como alternativa.');
  }
}

function mappedColumnIndex(field){
  const entry=Object.entries(tableImportState.mapping).find(([,value])=>value===field);
  return entry?Number(entry[0]):-1;
}

function valueAt(row,field){
  const index=mappedColumnIndex(field);
  return index>=0?(row[index]??''):'';
}

function rowsToImportedWeeks(){
  const dataRows=tableImportState.rows.slice(tableImportState.headerRow+1);
  if(mappedColumnIndex('date')<0){
    throw new Error('Debes asignar una columna como Fecha.');
  }
  if(mappedColumnIndex('hours')<0 && (mappedColumnIndex('start')<0 || mappedColumnIndex('end')<0)){
    throw new Error('Necesitamos Horas, o bien Hora inicio + Hora fin.');
  }

  const groups=new Map();
  let carryPeriod='',carryReport='',carryPay='';

  for(const row of dataRows){
    const date=parseFlexibleDate(valueAt(row,'date'));
    if(!date)continue;

    const rawPeriod=String(valueAt(row,'period')||'').trim();
    const rawReport=parseFlexibleDate(valueAt(row,'report'));
    const rawPay=parseFlexibleDate(valueAt(row,'pay'));
    if(rawPeriod)carryPeriod=rawPeriod;
    if(rawReport)carryReport=rawReport;
    if(rawPay)carryPay=rawPay;

    const start=parseFlexibleTime(valueAt(row,'start'));
    const end=parseFlexibleTime(valueAt(row,'end'));
    let minutes=parseDurationMinutes(valueAt(row,'hours'));
    if(!minutes && start && end)minutes=minutesBetween(start,end);

    const activity=String(valueAt(row,'activity')||'').trim();

    // Ignore apparent total/footer rows with no usable daily record.
    if(!minutes && !activity && !start && !end)continue;

    const monday=mondayFromDateString(date);
    if(!groups.has(monday)){
      const mondayDate=new Date(monday+'T12:00:00');
      groups.set(monday,{
        periodo:carryPeriod || String(isoWeekNumber(mondayDate)),
        start:monday,
        end:sundayFromMonday(monday),
        report:carryReport || nextMondayFromWeek(monday),
        pay:carryPay || secondSaturdayAfter(carryReport || nextMondayFromWeek(monday)),
        status:'Borrador',
        importedAt:new Date().toISOString(),
        importSource:tableImportState.sourceLabel,
        entries:Array.from({length:7},(_,i)=>{
          const d=new Date(monday+'T12:00:00');d.setDate(d.getDate()+i);
          return {date:toInputDate(d),start:'',end:'',activity:'',minutes:0};
        })
      });
    }

    const week=groups.get(monday);
    if(carryPeriod)week.periodo=carryPeriod;
    if(carryReport){week.report=carryReport;week.pay=carryPay||secondSaturdayAfter(carryReport);}
    if(carryPay)week.pay=carryPay;

    const dateObj=new Date(date+'T12:00:00');
    if(isNaN(dateObj))continue;
    const jsDay=dateObj.getDay();
    const index=jsDay===0?6:jsDay-1;
    if(index<0 || index>6)continue;
    const existing=week.entries[index];
    if(!existing)continue;

    // If a source has multiple entries on the same date, preserve the total and concatenate activity.
    if(existing.minutes>0 || existing.activity){
      existing.minutes+=minutes;
      if(activity)existing.activity=[existing.activity,activity].filter(Boolean).join(' / ');
      if(!existing.start && start)existing.start=start;
      if(end)existing.end=end;
    }else{
      week.entries[index]={date,start,end,activity,minutes};
    }
  }

  return Array.from(groups.values()).map(week=>({
    ...week,
    total:week.entries.reduce((sum,r)=>sum+(r.minutes||0),0)
  })).filter(week=>week.total>0 || week.entries.some(r=>r.activity));
}

async function commitMappedTableImport(){
  clearImportError();

  let weeks;
  try{
    weeks=rowsToImportedWeeks();
  }catch(error){
    showImportError(error.message);
    return;
  }

  if(!weeks.length){
    showImportError('No se pudieron construir semanas con los datos proporcionados.');
    return;
  }

  const existing=await getAll();
  const existingByStart=new Map(existing.map(w=>[w.start,w]));
  const duplicateCount=weeks.filter(w=>existingByStart.has(w.start)).length;

  let duplicateMode='skip';
  if(duplicateCount){
    const replace=confirm(
      `Se detectaron ${duplicateCount} semana(s) que ya existen.\n\nAceptar = reemplazar esas semanas.\nCancelar = omitir duplicados.`
    );
    duplicateMode=replace?'replace':'skip';
  }

  let imported=0,replaced=0,skipped=0;
  for(const week of weeks){
    const duplicate=existingByStart.get(week.start);
    if(duplicate){
      if(duplicateMode==='skip'){skipped++;continue;}
      await putItem({...week,id:duplicate.id,createdAt:duplicate.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()});
      replaced++;
    }else{
      await addItem({...week,createdAt:new Date().toISOString()});
      imported++;
    }
  }

  await loadSavedWeeks();
  closeImportModal();
  alert(`Importación terminada.\nNuevas: ${imported}\nReemplazadas: ${replaced}\nOmitidas: ${skipped}`);
}

async function clearStore(){return new Promise((resolve,reject)=>{const req=db.transaction(STORE,'readwrite').objectStore(STORE).clear();req.onsuccess=()=>resolve();req.onerror=()=>reject(req.error);});}
async function importTiempoExtraJSON(file){let parsed;try{parsed=JSON.parse(await file.text());}catch{alert('El archivo no contiene JSON válido.');return;}const records=Array.isArray(parsed)?parsed:parsed.data;if(!Array.isArray(records)){alert('El archivo no tiene el formato esperado.');return;}const valid=records.filter(r=>r&&typeof r==='object'&&typeof r.start==='string'&&Array.isArray(r.entries));if(!valid.length){alert('No se encontraron semanas válidas.');return;}const replace=confirm(`Se encontraron ${valid.length} semanas.\n\nAceptar = reemplazar historial.\nCancelar = agregar al historial actual.`);if(replace)await clearStore();let imported=0;for(const original of valid){const copy={...original};delete copy.id;copy.importedAt=new Date().toISOString();try{await addItem(copy);imported++;}catch(error){console.error(error);}}await loadSavedWeeks();alert(`${imported} semana(s) importada(s).`);}
async function exportTiempoExtraJSON(){
  const records=await getAll();
  records.sort((a,b)=>a.start.localeCompare(b.start));

  const payload={
    app:'FinoFinanza',
    modulo:'Tiempo Extra',
    version:1,
    exportedAt:new Date().toISOString(),
    totalSemanas:records.length,
    data:records
  };

  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  const date=new Date().toISOString().slice(0,10);
  a.href=url;
  a.download=`fino-finanza_tiempo-extra_${date}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function initTiempoExtra(){
  setTimeout(ensureSavedWeeksBulkUI,0);
  createImportUI();
  document.getElementById('weekReportDate').addEventListener('change',setExpectedPay);
  document.getElementById('weekStart').addEventListener('change',buildWeek);
  document.getElementById('saveWeek').addEventListener('click',saveCurrentWeek);
  document.getElementById('closeWeekView').addEventListener('click',()=>document.getElementById('weekViewPanel').classList.remove('show'));
  document.getElementById('cancelEditWeek').addEventListener('click',()=>document.getElementById('weekEditor').classList.remove('show'));
  document.getElementById('saveEditWeek').addEventListener('click',saveEdit);
  document.getElementById('copyExcelBtn').addEventListener('click',()=>{
    const id=Number(document.getElementById('weekViewPanel').dataset.weekId);
    const w=savedWeekData.find(x=>x.id===id);
    if(w)copyText(buildExcelTSV(w),document.getElementById('copyExcelBtn'));
  });
  document.getElementById('copyMessageBtn').addEventListener('click',()=>{
    const id=Number(document.getElementById('weekViewPanel').dataset.weekId);
    const w=savedWeekData.find(x=>x.id===id);
    if(w)copyText(buildWeekMessageText(w),document.getElementById('copyMessageBtn'));
  });
  document.getElementById('exportTEJson').addEventListener('click',exportTiempoExtraJSON);
  document.getElementById('importTEJsonBtn').addEventListener('click',()=>document.getElementById('importTEJsonInput').click());
  document.getElementById('importTEJsonInput').addEventListener('change',async e=>{const file=e.target.files?.[0];if(file)await importTiempoExtraJSON(file);e.target.value='';});

  try{
    await openDB();
    initWeek();
    await loadSavedWeeks();
  }catch(error){
    console.error(error);
    alert('No fue posible abrir el almacenamiento local.');
    initWeek();
  }
}
