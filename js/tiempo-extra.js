const dayNames=['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];

let currentWeek=[];
let savedWeekData=[];
let editingId=null;
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
function renderSavedWeeks(){
  const body=document.getElementById('savedWeeks');
  if(!savedWeekData.length){
    body.innerHTML='<tr><td colspan="7" style="text-align:center;color:#667085;padding:24px">Aún no hay semanas guardadas.</td></tr>';
    return;
  }

  body.innerHTML=savedWeekData.map(w=>`
    <tr>
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
  entries.forEach(r=>r.minutes=minutesBetween(r.start,r.end));

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
