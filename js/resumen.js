const RESUMEN_GASTOS_DB='FinoFinanzaGastosDB';
const RESUMEN_GASTOS_STORE='gastos';

let resumenDb=null;
let resumenSelectedMonth='';

function escResumen(s=''){
  return String(s).replace(/[&<>"']/g,m=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[m]));
}

function moneyResumen(n){
  return Number(n||0).toLocaleString('es-MX',{
    style:'currency',
    currency:'MXN'
  });
}

function currentMonthKey(){
  const d=new Date();
  const tz=d.getTimezoneOffset()*60000;
  return new Date(d-tz).toISOString().slice(0,7);
}

function monthLabel(key){
  if(!key||!/^\d{4}-\d{2}$/.test(key))return '—';
  const [y,m]=key.split('-').map(Number);
  return new Intl.DateTimeFormat('es-MX',{
    month:'long',
    year:'numeric'
  }).format(new Date(y,m-1,1));
}

function personLabelResumen(v){
  if(v==='Ivan')return 'Iván';
  if(v==='Yorsky')return 'Diana / Yorsky';
  return v||'—';
}

function openResumenGastosDb(){
  if(resumenDb)return Promise.resolve(resumenDb);
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(RESUMEN_GASTOS_DB,1);
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains(RESUMEN_GASTOS_STORE)){
        const store=db.createObjectStore(RESUMEN_GASTOS_STORE,{keyPath:'id',autoIncrement:true});
        store.createIndex('date','date');
        store.createIndex('type','type');
        store.createIndex('person','person');
      }
    };
    req.onsuccess=()=>{
      resumenDb=req.result;
      resolve(resumenDb);
    };
    req.onerror=()=>reject(req.error);
  });
}

function getAllResumenGastos(){
  return new Promise((resolve,reject)=>{
    if(!resumenDb){
      resolve([]);
      return;
    }
    const req=resumenDb
      .transaction(RESUMEN_GASTOS_STORE,'readonly')
      .objectStore(RESUMEN_GASTOS_STORE)
      .getAll();
    req.onsuccess=()=>resolve(req.result||[]);
    req.onerror=()=>reject(req.error);
  });
}

function injectResumenStyles(){
  if(document.getElementById('ff-resumen-styles'))return;
  const style=document.createElement('style');
  style.id='ff-resumen-styles';
  style.textContent=`
    #resumen .r-wrap{display:grid;gap:14px}
    #resumen .r-toolbar{
      display:flex;justify-content:space-between;gap:12px;align-items:center;
      flex-wrap:wrap;background:#fff;border:1px solid #e4e7ec;border-radius:14px;
      padding:13px 14px
    }
    #resumen .r-toolbar-left{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
    #resumen .r-toolbar label{
      font-size:10px;text-transform:uppercase;font-weight:800;color:#667085
    }
    #resumen .r-toolbar input{
      border:1px solid #d0d5dd;border-radius:9px;padding:8px 10px;background:#fff;
      color:#101828;font-size:12px
    }
    #resumen .r-refresh{
      border:1px solid #d0d5dd;border-radius:9px;background:#fff;padding:8px 11px;
      font-size:11px;font-weight:800;color:#344054;cursor:pointer
    }
    #resumen .r-kpis{
      display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px
    }
    #resumen .r-kpi{
      background:#fff;border:1px solid #e4e7ec;border-radius:14px;padding:14px
    }
    #resumen .r-kpi small{
      display:block;color:#667085;font-size:9px;text-transform:uppercase;
      font-weight:800;margin-bottom:7px
    }
    #resumen .r-kpi strong{font-size:20px;color:#101828}
    #resumen .r-kpi span{display:block;margin-top:5px;color:#667085;font-size:10px}
    #resumen .r-grid{
      display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px
    }
    #resumen .r-card{
      background:#fff;border:1px solid #e4e7ec;border-radius:16px;overflow:hidden
    }
    #resumen .r-head{
      padding:14px 16px;border-bottom:1px solid #e4e7ec;
      display:flex;justify-content:space-between;gap:10px;align-items:center
    }
    #resumen .r-head h3{margin:0;font-size:14px}
    #resumen .r-head small{color:#667085;font-size:10px}
    #resumen .r-body{padding:14px 16px}
    #resumen .r-list{display:grid;gap:9px}
    #resumen .r-row{
      display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;
      align-items:center;padding:9px 0;border-bottom:1px solid #f2f4f7
    }
    #resumen .r-row:last-child{border-bottom:0}
    #resumen .r-row-main{min-width:0}
    #resumen .r-row-main strong{
      display:block;font-size:11px;color:#101828;
      white-space:nowrap;overflow:hidden;text-overflow:ellipsis
    }
    #resumen .r-row-main small{display:block;margin-top:3px;color:#667085;font-size:9px}
    #resumen .r-row-value{text-align:right;font-size:11px;font-weight:900;color:#101828}
    #resumen .r-bar{
      margin-top:6px;height:5px;border-radius:999px;background:#eef2f6;overflow:hidden
    }
    #resumen .r-bar > span{
      display:block;height:100%;background:#155eef;border-radius:999px
    }
    #resumen .r-empty{
      padding:28px;text-align:center;color:#667085;font-size:11px
    }
    #resumen .r-table-wrap{overflow:auto}
    #resumen table{width:100%;border-collapse:collapse;min-width:640px}
    #resumen th,#resumen td{
      padding:9px 10px;border-bottom:1px solid #f2f4f7;text-align:left;font-size:10px
    }
    #resumen th{
      background:#f8fafc;color:#667085;text-transform:uppercase;font-size:8px
    }
    #resumen td.r-money{text-align:right;font-weight:900}
    #resumen .r-type{
      display:inline-flex;border:1px solid #d0d5dd;border-radius:999px;
      padding:3px 7px;font-size:8px;font-weight:800;background:#f8fafc
    }
    #resumen .r-note{
      color:#667085;font-size:10px;line-height:1.45
    }
    @media(max-width:900px){
      #resumen .r-kpis{grid-template-columns:1fr 1fr}
      #resumen .r-grid{grid-template-columns:1fr}
    }
    @media(max-width:520px){
      #resumen .r-kpis{grid-template-columns:1fr}
    }
  `;
  document.head.appendChild(style);
}

function renderResumenShell(){
  const root=document.getElementById('resumen');
  if(!root)return;

  root.innerHTML=`
    <div class="topbar">
      <div>
        <h2>Resumen</h2>
        <p>Consulta cuánto se ha gastado por mes, categoría, concepto, persona y tarjeta.</p>
      </div>
    </div>

    <div class="r-wrap">
      <div class="r-toolbar">
        <div class="r-toolbar-left">
          <label for="rMonth">Mes</label>
          <input id="rMonth" type="month">
          <strong id="rMonthLabel"></strong>
        </div>
        <button class="r-refresh" id="rRefresh" type="button">↻ Actualizar</button>
      </div>

      <div class="r-kpis">
        <div class="r-kpi">
          <small>Gastado en el mes</small>
          <strong id="rTotalMonth">${moneyResumen(0)}</strong>
          <span id="rMovementCount">0 movimientos</span>
        </div>
        <div class="r-kpi">
          <small>Gasto fijo</small>
          <strong id="rFixedMonth">${moneyResumen(0)}</strong>
          <span>Servicios y compromisos recurrentes</span>
        </div>
        <div class="r-kpi">
          <small>Gasto corriente</small>
          <strong id="rCurrentMonth">${moneyResumen(0)}</strong>
          <span>Consumo cotidiano</span>
        </div>
        <div class="r-kpi">
          <small>Manutención</small>
          <strong id="rMaintenanceMonth">${moneyResumen(0)}</strong>
          <span>Casa, auto, reparaciones y mantenimiento</span>
        </div>
      </div>

      <div class="r-grid">
        <section class="r-card">
          <div class="r-head">
            <div>
              <h3>¿En qué se gastó?</h3>
              <small>Totales por categoría</small>
            </div>
          </div>
          <div class="r-body">
            <div class="r-list" id="rCategoryList"></div>
          </div>
        </section>

        <section class="r-card">
          <div class="r-head">
            <div>
              <h3>Conceptos principales</h3>
              <small>Comercios y gastos simplificados</small>
            </div>
          </div>
          <div class="r-body">
            <div class="r-list" id="rConceptList"></div>
          </div>
        </section>

        <section class="r-card">
          <div class="r-head">
            <div>
              <h3>Gasto por persona</h3>
              <small>Distribución familiar del mes</small>
            </div>
          </div>
          <div class="r-body">
            <div class="r-list" id="rPersonList"></div>
          </div>
        </section>

        <section class="r-card">
          <div class="r-head">
            <div>
              <h3>Gasto por tarjeta</h3>
              <small>Compras registradas con tarjeta de crédito</small>
            </div>
          </div>
          <div class="r-body">
            <div class="r-list" id="rCardList"></div>
          </div>
        </section>
      </div>

      <section class="r-card">
        <div class="r-head">
          <div>
            <h3>Detalle del mes</h3>
            <small>Consulta exactamente cuánto se gastó en cada categoría y concepto.</small>
          </div>
        </div>
        <div class="r-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Categoría</th>
                <th>Concepto</th>
                <th>Tipo</th>
                <th>Movimientos</th>
                <th style="text-align:right">Total</th>
              </tr>
            </thead>
            <tbody id="rDetailRows"></tbody>
          </table>
        </div>
      </section>

      <div class="r-note">
        El Resumen no duplica información: lee directamente los gastos ya guardados en el módulo Gastos.
        Una compra con tarjeta sigue siendo gasto; el pago posterior de la tarjeta deberá contabilizarse en Deudas,
        no nuevamente aquí.
      </div>
    </div>
  `;
}

function groupBy(rows,keyFn){
  const map=new Map();
  for(const row of rows){
    const key=keyFn(row)||'Sin clasificar';
    const entry=map.get(key)||{key,total:0,count:0};
    entry.total+=Number(row.amount||0);
    entry.count++;
    map.set(key,entry);
  }
  return [...map.values()].sort((a,b)=>b.total-a.total);
}

function typeLabelResumen(t){
  if(t==='fijo')return 'Fijo';
  if(t==='manutencion')return 'Manutención';
  return 'Corriente';
}

function renderGroupList(containerId,items,total){
  const el=document.getElementById(containerId);
  if(!el)return;

  if(!items.length){
    el.innerHTML='<div class="r-empty">No hay gastos para este mes.</div>';
    return;
  }

  const max=Math.max(...items.map(x=>x.total),1);
  el.innerHTML=items.map(item=>`
    <div class="r-row">
      <div class="r-row-main">
        <strong>${escResumen(item.key)}</strong>
        <small>${item.count} movimiento${item.count===1?'':'s'} · ${total>0?((item.total/total)*100).toFixed(1):'0.0'}% del mes</small>
        <div class="r-bar"><span style="width:${Math.max(2,(item.total/max)*100)}%"></span></div>
      </div>
      <div class="r-row-value">${moneyResumen(item.total)}</div>
    </div>
  `).join('');
}

function buildCategoryConceptDetail(rows){
  const map=new Map();

  for(const row of rows){
    const category=row.category||'Sin categoría';
    const concept=row.description||'Sin concepto';
    const type=row.type||'corriente';
    const key=[category,concept,type].join('|||');

    const entry=map.get(key)||{
      category,
      concept,
      type,
      count:0,
      total:0
    };

    entry.count++;
    entry.total+=Number(row.amount||0);
    map.set(key,entry);
  }

  return [...map.values()].sort((a,b)=>{
    const cat=String(a.category).localeCompare(String(b.category),'es',{sensitivity:'base'});
    if(cat!==0)return cat;
    return b.total-a.total;
  });
}

async function refreshResumen(){
  const monthInput=document.getElementById('rMonth');
  if(!monthInput)return;

  resumenSelectedMonth=monthInput.value||currentMonthKey();
  monthInput.value=resumenSelectedMonth;

  const label=document.getElementById('rMonthLabel');
  if(label)label.textContent=monthLabel(resumenSelectedMonth);

  try{
    await openResumenGastosDb();
    const all=await getAllResumenGastos();
    const rows=all.filter(x=>String(x.date||'').slice(0,7)===resumenSelectedMonth);

    const total=rows.reduce((s,x)=>s+Number(x.amount||0),0);
    const fixed=rows.filter(x=>x.type==='fijo').reduce((s,x)=>s+Number(x.amount||0),0);
    const current=rows.filter(x=>x.type==='corriente').reduce((s,x)=>s+Number(x.amount||0),0);
    const maintenance=rows.filter(x=>x.type==='manutencion').reduce((s,x)=>s+Number(x.amount||0),0);

    document.getElementById('rTotalMonth').textContent=moneyResumen(total);
    document.getElementById('rFixedMonth').textContent=moneyResumen(fixed);
    document.getElementById('rCurrentMonth').textContent=moneyResumen(current);
    document.getElementById('rMaintenanceMonth').textContent=moneyResumen(maintenance);
    document.getElementById('rMovementCount').textContent=
      `${rows.length} movimiento${rows.length===1?'':'s'}`;

    const byCategory=groupBy(rows,x=>x.category||'Sin categoría');
    const byConcept=groupBy(rows,x=>x.description||'Sin concepto');
    const byPerson=groupBy(rows,x=>personLabelResumen(x.person));
    const byCard=groupBy(
      rows.filter(x=>x.paymentMethod==='Tarjeta de crédito'&&x.creditCard),
      x=>x.creditCard
    );

    renderGroupList('rCategoryList',byCategory,total);
    renderGroupList('rConceptList',byConcept,total);
    renderGroupList('rPersonList',byPerson,total);
    renderGroupList('rCardList',byCard,total);

    const detail=buildCategoryConceptDetail(rows);
    const tbody=document.getElementById('rDetailRows');

    if(!detail.length){
      tbody.innerHTML='<tr><td colspan="5"><div class="r-empty">No hay gastos registrados en este mes.</div></td></tr>';
    }else{
      tbody.innerHTML=detail.map(x=>`
        <tr>
          <td>${escResumen(x.category)}</td>
          <td><strong>${escResumen(x.concept)}</strong></td>
          <td><span class="r-type">${escResumen(typeLabelResumen(x.type))}</span></td>
          <td>${x.count}</td>
          <td class="r-money">${moneyResumen(x.total)}</td>
        </tr>
      `).join('');
    }
  }catch(err){
    console.error('FinoFinanza Resumen:',err);
    const tbody=document.getElementById('rDetailRows');
    if(tbody){
      tbody.innerHTML='<tr><td colspan="5"><div class="r-empty">No fue posible leer los gastos guardados.</div></td></tr>';
    }
  }
}

function bindResumenEvents(){
  document.getElementById('rMonth')?.addEventListener('change',refreshResumen);
  document.getElementById('rRefresh')?.addEventListener('click',refreshResumen);

  document.addEventListener('click',e=>{
    const target=e.target.closest?.('[data-screen="resumen"],[data-open="resumen"]');
    if(target)setTimeout(refreshResumen,0);
  });

  window.addEventListener('focus',()=>{
    const root=document.getElementById('resumen');
    if(root?.classList.contains('active'))refreshResumen();
  });

  document.addEventListener('visibilitychange',()=>{
    const root=document.getElementById('resumen');
    if(!document.hidden && root?.classList.contains('active'))refreshResumen();
  });
}

export async function initResumen(){
  injectResumenStyles();
  renderResumenShell();

  const month=document.getElementById('rMonth');
  if(month){
    resumenSelectedMonth=currentMonthKey();
    month.value=resumenSelectedMonth;
  }

  bindResumenEvents();
  await refreshResumen();
}
