const SUMMARY_INCOME_DB='FinoFinanzaIngresosDB';
const SUMMARY_INCOME_STORE='ingresos';
const SUMMARY_EXPENSE_DB='FinoFinanzaGastosDB';
const SUMMARY_EXPENSE_STORE='gastos';

let summaryMonth='';
let summaryRange=6;
let summarySeries={income:true,expense:true,balance:false};
let summaryObserver=null;

function money(v){
  return Number(v||0).toLocaleString('es-MX',{style:'currency',currency:'MXN'});
}
function esc(v=''){
  return String(v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function todayMonth(){
  const d=new Date();
  const local=new Date(d.getTime()-d.getTimezoneOffset()*60000);
  return local.toISOString().slice(0,7);
}
function monthLabel(key){
  const m=String(key||'').match(/^(\d{4})-(\d{2})$/);
  if(!m)return key||'—';
  const d=new Date(Number(m[1]),Number(m[2])-1,1);
  const text=new Intl.DateTimeFormat('es-MX',{month:'long',year:'numeric'}).format(d);
  return text.charAt(0).toUpperCase()+text.slice(1);
}
function shortMonthLabel(key){
  const m=String(key||'').match(/^(\d{4})-(\d{2})$/);
  if(!m)return key||'';
  const d=new Date(Number(m[1]),Number(m[2])-1,1);
  const mon=new Intl.DateTimeFormat('es-MX',{month:'short'}).format(d).replace('.','');
  return `${mon.charAt(0).toUpperCase()+mon.slice(1)} ${String(m[1]).slice(-2)}`;
}
function shiftMonth(key,delta){
  const [y,m]=String(key||todayMonth()).split('-').map(Number);
  const d=new Date(y,m-1+delta,1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}
function incomeDate(x){return String(x?.paymentDate||x?.date||'').slice(0,10)}
function incomeAmount(x){
  if(x?.entryType==='manual')return Number(x.amount||0);
  return Number(x?.net||x?.amount||0);
}
function expenseAmount(x){return Number(x?.amount||0)}
function isFamilyExpense(x){return x?.expenseScope!=='amex-additional'}

function readStore(dbName,storeName){
  return new Promise(resolve=>{
    const req=indexedDB.open(dbName);
    req.onerror=()=>resolve([]);
    req.onupgradeneeded=()=>{};
    req.onsuccess=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains(storeName)){
        db.close();resolve([]);return;
      }
      const tx=db.transaction(storeName,'readonly');
      const get=tx.objectStore(storeName).getAll();
      get.onsuccess=()=>{const rows=get.result||[];db.close();resolve(rows)};
      get.onerror=()=>{db.close();resolve([])};
    };
  });
}

function injectSummaryStyles(){
  if(document.getElementById('ff-summary-styles'))return;
  const s=document.createElement('style');
  s.id='ff-summary-styles';
  s.textContent=`
    #resumen .r-wrap{display:grid;gap:14px}
    #resumen .r-toolbar{display:flex;justify-content:flex-start;align-items:center;gap:10px;flex-wrap:wrap}
    #resumen .r-month-nav{display:flex;align-items:center;gap:7px}
    #resumen .r-month-nav select,#resumen .r-range{border:1px solid #d0d5dd;border-radius:9px;background:#fff;padding:8px 10px;font-size:11px;color:#344054}
    #resumen .r-chart-controls{display:flex;gap:7px;align-items:center;justify-content:flex-end;flex-wrap:wrap}
    #resumen .r-toggle{display:inline-flex;align-items:center;gap:6px;border:1px solid #d0d5dd;background:#fff;border-radius:999px;padding:7px 10px;font-size:10px;font-weight:800;color:#475467;cursor:pointer;user-select:none}
    #resumen .r-toggle input{accent-color:auto}
    #resumen .r-toggle.active{background:#f8fbff;border-color:#84adff;color:#175cd3}
    #resumen .r-navbtn{width:34px;height:34px;border:1px solid #d0d5dd;border-radius:9px;background:#fff;cursor:pointer;color:#475467;font-weight:900}
    #resumen .r-grid{display:grid;grid-template-columns:1.4fr repeat(3,1fr);gap:10px}
    #resumen .r-card{background:#fff;border:1px solid #e4e7ec;border-radius:15px;padding:14px;box-shadow:0 1px 2px rgba(16,24,40,.03)}
    #resumen .r-card small{display:block;color:#667085;font-size:9px;text-transform:uppercase;letter-spacing:.04em;font-weight:800;margin-bottom:7px}
    #resumen .r-card strong{display:block;color:#101828;font-size:20px;line-height:1.15}
    #resumen .r-card span{display:block;color:#667085;font-size:10px;margin-top:6px;line-height:1.35}
    #resumen .r-card.primary{background:#f8fbff;border-color:#b2ccff}
    #resumen .r-card.primary strong{font-size:25px;color:#175cd3}
    #resumen .r-card.positive strong{color:#067647}
    #resumen .r-card.negative strong{color:#b42318}
    #resumen .r-section{background:#fff;border:1px solid #e4e7ec;border-radius:16px;overflow:hidden}
    #resumen .r-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:14px 16px;border-bottom:1px solid #e4e7ec}
    #resumen .r-head h3{margin:0;font-size:14px;color:#101828}
    #resumen .r-head p{margin:4px 0 0;color:#667085;font-size:10px}
    #resumen .r-chart-head{align-items:center;padding-top:11px;padding-bottom:11px}
    #resumen .r-chart-head .r-range{padding:6px 9px;font-size:10px}
    #resumen .r-chart-head .r-toggle{padding:6px 9px;font-size:9px}
    #resumen .r-chart-body{padding-top:8px;padding-bottom:10px}
    #resumen .r-body{padding:16px}
    #resumen .r-chart-wrap{width:100%;overflow-x:auto}
    #resumen .r-chart{min-width:620px;height:185px;display:block;width:100%}
    #resumen .r-legend{display:flex;gap:13px;align-items:center;flex-wrap:wrap;margin-top:5px;color:#667085;font-size:9px}
    #resumen .r-legend span{display:inline-flex;align-items:center;gap:6px}
    #resumen .r-dot{width:9px;height:9px;border-radius:3px;display:inline-block}
    #resumen .r-dot.income{background:#175cd3}.r-dot.expense{background:#f79009}.r-dot.balance{background:#12b76a}
    #resumen .r-note{margin-top:7px;padding:8px 10px;border-radius:10px;background:#f8fafc;border:1px solid #e4e7ec;color:#475467;font-size:10px;line-height:1.5}
    #resumen .r-empty{padding:34px 14px;text-align:center;color:#667085;font-size:11px}
    #resumen .r-breakdown{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    #resumen .r-mini{border:1px solid #e4e7ec;border-radius:12px;padding:12px;background:#fcfcfd}
    #resumen .r-mini small{display:block;color:#667085;font-size:9px;text-transform:uppercase;font-weight:800;margin-bottom:5px}
    #resumen .r-mini strong{font-size:15px;color:#101828}
    #resumen .r-quick-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
    #resumen .r-quick{border:1px solid #e4e7ec;border-radius:12px;padding:12px;background:#fff;min-width:0}
    #resumen .r-quick small{display:block;color:#667085;font-size:9px;text-transform:uppercase;font-weight:800;margin-bottom:6px}
    #resumen .r-quick strong{display:block;color:#101828;font-size:15px;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #resumen .r-quick span{display:block;color:#667085;font-size:10px;margin-top:5px;line-height:1.35}
    #resumen .r-quick.positive strong{color:#067647}
    #resumen .r-quick.negative strong{color:#b42318}
    #resumen .r-comparison{font-weight:800}
    @media(max-width:980px){#resumen .r-grid{grid-template-columns:1fr 1fr}#resumen .r-quick-grid{grid-template-columns:1fr 1fr}}
    @media(max-width:600px){#resumen .r-grid,#resumen .r-breakdown,#resumen .r-quick-grid{grid-template-columns:1fr}#resumen .r-card.primary strong{font-size:22px}}
  `;
  document.head.appendChild(s);
}

function renderShell(){
  const root=document.getElementById('resumen');
  if(!root)return;
  root.innerHTML=`
    <div class="topbar"><div><h2>Resumen</h2><p>Ingresos, gastos y balance familiar en una sola vista.</p></div></div>
    <div class="r-wrap">
      <div class="r-toolbar">
        <div class="r-month-nav">
          <button class="r-navbtn" id="rPrevMonth" type="button" title="Mes anterior">‹</button>
          <select id="rMonthSelect" aria-label="Mes del resumen"></select>
          <button class="r-navbtn" id="rNextMonth" type="button" title="Mes siguiente">›</button>
        </div>

      </div>

      <div class="r-grid">
        <div class="r-card primary"><small>Ganado en el mes</small><strong id="rIncomeMonth">$0.00</strong><span id="rIncomeMonthSub">Ingresos recibidos en el periodo</span></div>
        <div class="r-card"><small>Total ganado</small><strong id="rIncomeTotal">$0.00</strong><span>Acumulado de todo el historial</span></div>
        <div class="r-card"><small>Gastado en el mes</small><strong id="rExpenseMonth">$0.00</strong><span>Gastos familiares registrados</span></div>
        <div class="r-card" id="rBalanceCard"><small>Balance del mes</small><strong id="rBalanceMonth">$0.00</strong><span>Ingresos menos gastos</span></div>
      </div>

      <section class="r-section">
        <div class="r-head"><div><h3>Lectura rápida del mes</h3><p>Comparaciones y datos clave sin entrar al detalle de movimientos.</p></div></div>
        <div class="r-body"><div class="r-quick-grid">
          <div class="r-quick" id="rExpenseCompareCard"><small>Gasto vs. mes anterior</small><strong id="rExpenseCompare">—</strong><span id="rExpenseCompareSub">Sin comparación disponible</span></div>
          <div class="r-quick" id="rIncomeCompareCard"><small>Ingreso vs. mes anterior</small><strong id="rIncomeCompare">—</strong><span id="rIncomeCompareSub">Sin comparación disponible</span></div>
          <div class="r-quick" id="rSavingsRateCard"><small>Tasa de balance</small><strong id="rSavingsRate">—</strong><span>Porcentaje de ingresos que quedó libre</span></div>
          <div class="r-quick"><small>Concepto con mayor gasto</small><strong id="rTopConcept">—</strong><span id="rTopConceptSub">Sin gastos registrados</span></div>
          <div class="r-quick"><small>Categoría con mayor gasto</small><strong id="rTopCategory">—</strong><span id="rTopCategorySub">Sin gastos registrados</span></div>
          <div class="r-quick"><small>Movimientos del mes</small><strong id="rExpenseCount">0</strong><span id="rAvgExpense">Promedio por gasto: $0.00</span></div>
        </div></div>
      </section>

      <section class="r-section">
        <div class="r-head r-chart-head">
          <div><h3>Evolución financiera</h3><p>Ingresos, gastos y balance mes a mes.</p></div>
          <div class="r-chart-controls" aria-label="Controles de la gráfica">
            <select class="r-range" id="rRangeSelect" aria-label="Periodo de la gráfica">
              <option value="6">6 meses</option>
              <option value="12">12 meses</option>
              <option value="year">Este año</option>
              <option value="0">Todo</option>
            </select>
            <label class="r-toggle active"><input id="rShowIncome" type="checkbox" checked> Ingresos</label>
            <label class="r-toggle active"><input id="rShowExpense" type="checkbox" checked> Gastos</label>
            <label class="r-toggle"><input id="rShowBalance" type="checkbox"> Balance</label>
          </div>
        </div>
        <div class="r-body r-chart-body">
          <div class="r-chart-wrap" id="rChartWrap"></div>
          <div class="r-legend" id="rLegend"></div>
          <div class="r-note" id="rInsight">Aún no hay suficientes datos para generar una lectura del periodo.</div>
        </div>
      </section>

      <section class="r-section">
        <div class="r-head"><div><h3>Acumulados</h3><p>Totales históricos registrados hasta ahora.</p></div></div>
        <div class="r-body"><div class="r-breakdown">
          <div class="r-mini"><small>Total de ingresos</small><strong id="rIncomeTotal2">$0.00</strong></div>
          <div class="r-mini"><small>Total de gastos familiares</small><strong id="rExpenseTotal">$0.00</strong></div>
          <div class="r-mini"><small>Balance histórico</small><strong id="rBalanceTotal">$0.00</strong></div>
          <div class="r-mini"><small>Gasto mensual promedio</small><strong id="rExpenseAverageMonth">$0.00</strong></div>
        </div></div>
      </section>
    </div>`;
}

function buildMonthOptions(months){
  const sel=document.getElementById('rMonthSelect');
  if(!sel)return;
  const list=[...new Set(months)].sort().reverse();
  if(!list.includes(todayMonth()))list.unshift(todayMonth());
  if(!summaryMonth)summaryMonth=list.find(Boolean)||todayMonth();
  if(!list.includes(summaryMonth))list.unshift(summaryMonth);
  sel.innerHTML=list.map(m=>`<option value="${m}">${esc(monthLabel(m))}</option>`).join('');
  sel.value=summaryMonth;
}

function chartSvg(series){
  const active=[];
  if(summarySeries.income)active.push({key:'income',label:'Ingresos',stroke:'#175cd3'});
  if(summarySeries.expense)active.push({key:'expense',label:'Gastos',stroke:'#f79009'});
  if(summarySeries.balance)active.push({key:'balance',label:'Balance',stroke:'#12b76a'});
  if(!series.length)return '<div class="r-empty">Todavía no hay movimientos para construir la gráfica.</div>';
  if(!active.length)return '<div class="r-empty">Selecciona al menos una serie para mostrar en la gráfica.</div>';

  const W=Math.max(650,series.length*86+80),H=205;
  const pad={l:60,r:18,t:14,b:38};
  const plotW=W-pad.l-pad.r,plotH=H-pad.t-pad.b;
  const vals=[];
  for(const d of series)for(const a of active)vals.push(Number(d[a.key]||0));
  let min=Math.min(0,...vals),max=Math.max(0,...vals);
  if(min===max){max=min+1}
  const span=max-min;
  const stepBase=Math.max(1,span/4);
  const mag=Math.pow(10,Math.floor(Math.log10(stepBase)));
  const niceCandidates=[1,2,5,10].map(x=>x*mag);
  const tickStep=niceCandidates.find(x=>x>=stepBase)||10*mag;
  min=Math.floor(min/tickStep)*tickStep;
  max=Math.ceil(max/tickStep)*tickStep;
  if(min===max)max=min+tickStep;
  const y=v=>pad.t+(max-v)/(max-min)*plotH;
  const x=i=>pad.l+(series.length===1?plotW/2:(plotW*i/(series.length-1)));

  const grid=[];
  for(let i=0;i<=4;i++){
    const val=min+(max-min)*(i/4),yy=y(val);
    const label=Math.abs(val)>=1000?`${(val/1000).toFixed(Math.abs(val)>=10000?0:1)}k`:Math.round(val);
    grid.push(`<line x1="${pad.l}" y1="${yy}" x2="${W-pad.r}" y2="${yy}" stroke="#eaecf0" stroke-width="1"/><text x="${pad.l-9}" y="${yy+3}" text-anchor="end" font-size="9" fill="#98a2b3">${label}</text>`);
  }
  if(min<0&&max>0){
    const zeroY=y(0);
    grid.push(`<line x1="${pad.l}" y1="${zeroY}" x2="${W-pad.r}" y2="${zeroY}" stroke="#98a2b3" stroke-width="1.2"/>`);
  }

  const lines=active.map(a=>{
    const pts=series.map((d,i)=>`${x(i)},${y(d[a.key])}`).join(' ');
    const circles=series.map((d,i)=>`<circle cx="${x(i)}" cy="${y(d[a.key])}" r="3" fill="${a.stroke}" stroke="#fff" stroke-width="1.5"><title>${esc(monthLabel(d.month))} · ${a.label}: ${money(d[a.key])}</title></circle>`).join('');
    return `<polyline points="${pts}" fill="none" stroke="${a.stroke}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>${circles}`;
  }).join('');

  const labels=series.map((d,i)=>`<text x="${x(i)}" y="${H-14}" text-anchor="middle" font-size="9" fill="#667085">${esc(shortMonthLabel(d.month))}</text>`).join('');
  return `<svg class="r-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfica lineal mensual de evolución financiera">${grid.join('')}${lines}${labels}</svg>`;
}

function renderLegend(){
  const legend=document.getElementById('rLegend');
  if(!legend)return;
  const items=[];
  if(summarySeries.income)items.push('<span><i class="r-dot income"></i> Ingresos</span>');
  if(summarySeries.expense)items.push('<span><i class="r-dot expense"></i> Gastos</span>');
  if(summarySeries.balance)items.push('<span><i class="r-dot balance"></i> Balance</span>');
  legend.innerHTML=items.join('');
}

function syncSeriesToggles(){
  const defs=[['rShowIncome','income'],['rShowExpense','expense'],['rShowBalance','balance']];
  for(const [id,key] of defs){
    const input=document.getElementById(id);
    if(!input)continue;
    input.checked=Boolean(summarySeries[key]);
    input.closest('.r-toggle')?.classList.toggle('active',Boolean(summarySeries[key]));
  }
}

function pctChange(current,previous){
  const c=Number(current||0),p=Number(previous||0);
  if(p===0)return c===0?null:null;
  return ((c-p)/Math.abs(p))*100;
}
function setCompare(prefix,current,previous,goodWhenLower=false){
  const strong=document.getElementById(prefix);
  const sub=document.getElementById(prefix+'Sub');
  const card=document.getElementById(prefix+'Card');
  if(!strong||!sub)return;
  card?.classList.remove('positive','negative');
  if(previous===0){
    strong.textContent=current===0?'Sin cambio':'Sin base';
    sub.textContent=current===0?'Ambos meses están en $0.00':'El mes anterior no tuvo movimientos';
    return;
  }
  const pct=pctChange(current,previous);
  const diff=current-previous;
  const up=diff>0;
  strong.textContent=`${up?'↑':diff<0?'↓':'='} ${Math.abs(pct||0).toFixed(1)}%`;
  sub.textContent=`${up?'Más':diff<0?'Menos':'Igual'} que el mes anterior · ${money(Math.abs(diff))}`;
  const favorable=goodWhenLower?!up:up;
  if(diff!==0)card?.classList.add(favorable?'positive':'negative');
}
function topBy(rows,keyFn){
  const map=new Map();
  for(const x of rows){
    const key=String(keyFn(x)||'Sin clasificar').trim()||'Sin clasificar';
    map.set(key,(map.get(key)||0)+expenseAmount(x));
  }
  return [...map.entries()].sort((a,b)=>b[1]-a[1])[0]||null;
}

async function refreshSummary(){
  const [incomes,expensesRaw]=await Promise.all([
    readStore(SUMMARY_INCOME_DB,SUMMARY_INCOME_STORE),
    readStore(SUMMARY_EXPENSE_DB,SUMMARY_EXPENSE_STORE)
  ]);
  const expenses=expensesRaw.filter(isFamilyExpense);
  const months=[
    ...incomes.map(x=>incomeDate(x).slice(0,7)).filter(x=>/^\d{4}-\d{2}$/.test(x)),
    ...expenses.map(x=>String(x.date||'').slice(0,7)).filter(x=>/^\d{4}-\d{2}$/.test(x))
  ];
  if(!summaryMonth){
    const sorted=[...new Set(months)].sort().reverse();
    summaryMonth=sorted[0]||todayMonth();
  }
  buildMonthOptions(months);
  const rangeSelect=document.getElementById('rRangeSelect');
  if(rangeSelect)rangeSelect.value=String(summaryRange);

  const incomeTotal=incomes.reduce((s,x)=>s+incomeAmount(x),0);
  const expenseTotal=expenses.reduce((s,x)=>s+expenseAmount(x),0);
  const incomeMonth=incomes.filter(x=>incomeDate(x).slice(0,7)===summaryMonth).reduce((s,x)=>s+incomeAmount(x),0);
  const expenseMonth=expenses.filter(x=>String(x.date||'').slice(0,7)===summaryMonth).reduce((s,x)=>s+expenseAmount(x),0);
  const balance=incomeMonth-expenseMonth;
  const prevMonth=shiftMonth(summaryMonth,-1);
  const prevIncome=incomes.filter(x=>incomeDate(x).slice(0,7)===prevMonth).reduce((s,x)=>s+incomeAmount(x),0);
  const prevExpense=expenses.filter(x=>String(x.date||'').slice(0,7)===prevMonth).reduce((s,x)=>s+expenseAmount(x),0);
  const monthExpenses=expenses.filter(x=>String(x.date||'').slice(0,7)===summaryMonth);

  document.getElementById('rIncomeMonth').textContent=money(incomeMonth);
  document.getElementById('rIncomeTotal').textContent=money(incomeTotal);
  document.getElementById('rIncomeTotal2').textContent=money(incomeTotal);
  document.getElementById('rExpenseMonth').textContent=money(expenseMonth);
  document.getElementById('rExpenseTotal').textContent=money(expenseTotal);
  document.getElementById('rBalanceTotal').textContent=money(incomeTotal-expenseTotal);
  const expenseMonths=[...new Set(expenses.map(x=>String(x.date||'').slice(0,7)).filter(x=>/^\d{4}-\d{2}$/.test(x)))];
  document.getElementById('rExpenseAverageMonth').textContent=money(expenseMonths.length?expenseTotal/expenseMonths.length:0);
  document.getElementById('rBalanceMonth').textContent=money(balance);
  document.getElementById('rIncomeMonthSub').textContent=`Ingresos recibidos en ${monthLabel(summaryMonth)}`;
  const bc=document.getElementById('rBalanceCard');
  bc.classList.toggle('positive',balance>0);bc.classList.toggle('negative',balance<0);

  setCompare('rExpenseCompare',expenseMonth,prevExpense,true);
  setCompare('rIncomeCompare',incomeMonth,prevIncome,false);
  const savingsRate=incomeMonth>0?(balance/incomeMonth)*100:null;
  const sr=document.getElementById('rSavingsRate');
  const src=document.getElementById('rSavingsRateCard');
  src?.classList.remove('positive','negative');
  if(sr){
    sr.textContent=savingsRate===null?'—':`${savingsRate.toFixed(1)}%`;
    if(savingsRate!==null)src?.classList.add(savingsRate>=0?'positive':'negative');
  }
  const topConcept=topBy(monthExpenses,x=>x.description||x.originalDescription||'Sin concepto');
  const topCategory=topBy(monthExpenses,x=>x.category||'Sin categoría');
  document.getElementById('rTopConcept').textContent=topConcept?topConcept[0]:'—';
  document.getElementById('rTopConceptSub').textContent=topConcept?`${money(topConcept[1])} en el mes`:'Sin gastos registrados';
  document.getElementById('rTopCategory').textContent=topCategory?topCategory[0]:'—';
  document.getElementById('rTopCategorySub').textContent=topCategory?`${money(topCategory[1])} en el mes`:'Sin gastos registrados';
  document.getElementById('rExpenseCount').textContent=String(monthExpenses.length);
  document.getElementById('rAvgExpense').textContent=`Promedio por gasto: ${money(monthExpenses.length?expenseMonth/monthExpenses.length:0)}`;

  let allMonths=[...new Set(months)].sort();
  if(!allMonths.length)allMonths=[summaryMonth];
  if(summaryRange==='year'){
    const y=summaryMonth.slice(0,4);
    allMonths=allMonths.filter(m=>m.startsWith(y+'-'));
  }else if(Number(summaryRange)>0){
    allMonths=allMonths.slice(-Number(summaryRange));
  }
  const series=allMonths.map(month=>{
    const income=incomes.filter(x=>incomeDate(x).slice(0,7)===month).reduce((s,x)=>s+incomeAmount(x),0);
    const expense=expenses.filter(x=>String(x.date||'').slice(0,7)===month).reduce((s,x)=>s+expenseAmount(x),0);
    return {month,income,expense,balance:income-expense};
  });
  syncSeriesToggles();
  renderLegend();
  document.getElementById('rChartWrap').innerHTML=chartSvg(series);

  const periodIncome=series.reduce((s,x)=>s+x.income,0);
  const periodExpense=series.reduce((s,x)=>s+x.expense,0);
  const diff=periodIncome-periodExpense;
  const insight=document.getElementById('rInsight');
  if(periodIncome===0&&periodExpense===0){
    insight.textContent='Aún no hay ingresos o gastos registrados para este periodo.';
  }else if(diff>=0){
    insight.innerHTML=`En el periodo mostrado ingresaron <strong>${money(periodIncome)}</strong> y gastaron <strong>${money(periodExpense)}</strong>. El balance acumulado es favorable por <strong>${money(diff)}</strong>.`;
  }else{
    insight.innerHTML=`En el periodo mostrado ingresaron <strong>${money(periodIncome)}</strong> y gastaron <strong>${money(periodExpense)}</strong>. Los gastos superan a los ingresos por <strong>${money(Math.abs(diff))}</strong>.`;
  }
}

function bindSummaryEvents(){
  document.getElementById('rMonthSelect')?.addEventListener('change',e=>{summaryMonth=e.target.value;refreshSummary()});
  document.getElementById('rPrevMonth')?.addEventListener('click',()=>{summaryMonth=shiftMonth(summaryMonth,-1);refreshSummary()});
  document.getElementById('rNextMonth')?.addEventListener('click',()=>{summaryMonth=shiftMonth(summaryMonth,1);refreshSummary()});
  document.getElementById('rRangeSelect')?.addEventListener('change',e=>{summaryRange=e.target.value==='year'?'year':(Number(e.target.value)||0);refreshSummary()});
  [['rShowIncome','income'],['rShowExpense','expense'],['rShowBalance','balance']].forEach(([id,key])=>{
    document.getElementById(id)?.addEventListener('change',e=>{
      const next={...summarySeries,[key]:e.target.checked};
      if(!next.income&&!next.expense&&!next.balance){
        e.target.checked=true;
        return;
      }
      summarySeries=next;
      syncSeriesToggles();
      refreshSummary();
    });
  });
  window.addEventListener('focus',refreshSummary);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshSummary()});

  const root=document.getElementById('resumen');
  if(root){
    summaryObserver?.disconnect();
    summaryObserver=new MutationObserver(muts=>{
      if(muts.some(m=>m.attributeName==='class')&&root.classList.contains('active'))refreshSummary();
    });
    summaryObserver.observe(root,{attributes:true,attributeFilter:['class']});
  }
}

export function initResumen(){
  injectSummaryStyles();
  renderShell();
  bindSummaryEvents();
  refreshSummary();
}
