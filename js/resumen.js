const SUMMARY_INCOME_DB='FinoFinanzaIngresosDB';
const SUMMARY_INCOME_STORE='ingresos';
const SUMMARY_EXPENSE_DB='FinoFinanzaGastosDB';
const SUMMARY_EXPENSE_STORE='gastos';

let summaryMonth='';
let summaryRange=6;
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
    #resumen .r-toolbar{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
    #resumen .r-month-nav{display:flex;align-items:center;gap:7px}
    #resumen .r-month-nav select,#resumen .r-range{border:1px solid #d0d5dd;border-radius:9px;background:#fff;padding:8px 10px;font-size:11px;color:#344054}
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
    #resumen .r-body{padding:16px}
    #resumen .r-chart-wrap{width:100%;overflow-x:auto}
    #resumen .r-chart{min-width:620px;height:300px;display:block;width:100%}
    #resumen .r-legend{display:flex;gap:15px;align-items:center;flex-wrap:wrap;margin-top:9px;color:#667085;font-size:10px}
    #resumen .r-legend span{display:inline-flex;align-items:center;gap:6px}
    #resumen .r-dot{width:9px;height:9px;border-radius:3px;display:inline-block}
    #resumen .r-dot.income{background:#175cd3}.r-dot.expense{background:#f79009}
    #resumen .r-note{margin-top:12px;padding:10px 12px;border-radius:10px;background:#f8fafc;border:1px solid #e4e7ec;color:#475467;font-size:10px;line-height:1.5}
    #resumen .r-empty{padding:34px 14px;text-align:center;color:#667085;font-size:11px}
    #resumen .r-breakdown{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    #resumen .r-mini{border:1px solid #e4e7ec;border-radius:12px;padding:12px;background:#fcfcfd}
    #resumen .r-mini small{display:block;color:#667085;font-size:9px;text-transform:uppercase;font-weight:800;margin-bottom:5px}
    #resumen .r-mini strong{font-size:15px;color:#101828}
    @media(max-width:980px){#resumen .r-grid{grid-template-columns:1fr 1fr}}
    @media(max-width:600px){#resumen .r-grid,#resumen .r-breakdown{grid-template-columns:1fr}#resumen .r-card.primary strong{font-size:22px}}
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
        <select class="r-range" id="rRangeSelect" aria-label="Periodo de la gráfica">
          <option value="6">Gráfica · últimos 6 meses</option>
          <option value="12">Gráfica · últimos 12 meses</option>
          <option value="0">Gráfica · todo el historial</option>
        </select>
      </div>

      <div class="r-grid">
        <div class="r-card primary"><small>Ganado en el mes</small><strong id="rIncomeMonth">$0.00</strong><span id="rIncomeMonthSub">Ingresos recibidos en el periodo</span></div>
        <div class="r-card"><small>Total ganado</small><strong id="rIncomeTotal">$0.00</strong><span>Acumulado de todo el historial</span></div>
        <div class="r-card"><small>Gastado en el mes</small><strong id="rExpenseMonth">$0.00</strong><span>Gastos familiares registrados</span></div>
        <div class="r-card" id="rBalanceCard"><small>Balance del mes</small><strong id="rBalanceMonth">$0.00</strong><span>Ingresos menos gastos</span></div>
      </div>

      <section class="r-section">
        <div class="r-head">
          <div><h3>Ingresos vs. gastos</h3><p>Comparación mensual para ver si la familia está gastando por encima o por debajo de lo que recibe.</p></div>
        </div>
        <div class="r-body">
          <div class="r-chart-wrap" id="rChartWrap"></div>
          <div class="r-legend"><span><i class="r-dot income"></i> Ingresos</span><span><i class="r-dot expense"></i> Gastos</span></div>
          <div class="r-note" id="rInsight">Aún no hay suficientes datos para generar una lectura del periodo.</div>
        </div>
      </section>

      <section class="r-section">
        <div class="r-head"><div><h3>Acumulados</h3><p>Totales históricos registrados hasta ahora.</p></div></div>
        <div class="r-body"><div class="r-breakdown">
          <div class="r-mini"><small>Total de ingresos</small><strong id="rIncomeTotal2">$0.00</strong></div>
          <div class="r-mini"><small>Total de gastos familiares</small><strong id="rExpenseTotal">$0.00</strong></div>
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
  if(!series.length)return '<div class="r-empty">Todavía no hay movimientos para construir la gráfica.</div>';
  const W=Math.max(620,series.length*86+80),H=285;
  const pad={l:58,r:18,t:20,b:52};
  const plotW=W-pad.l-pad.r,plotH=H-pad.t-pad.b;
  const max=Math.max(1,...series.flatMap(x=>[x.income,x.expense]));
  const niceMax=Math.ceil(max/1000)*1000||max;
  const groupW=plotW/series.length;
  const barW=Math.min(24,groupW*.28);
  const y=v=>pad.t+plotH-(v/niceMax)*plotH;
  const grid=[];
  for(let i=0;i<=4;i++){
    const val=niceMax*(i/4),yy=y(val);
    grid.push(`<line x1="${pad.l}" y1="${yy}" x2="${W-pad.r}" y2="${yy}" stroke="#eaecf0" stroke-width="1"/><text x="${pad.l-8}" y="${yy+3}" text-anchor="end" font-size="9" fill="#98a2b3">${val>=1000?`${(val/1000).toFixed(val>=10000?0:1)}k`:Math.round(val)}</text>`);
  }
  const bars=series.map((d,i)=>{
    const cx=pad.l+groupW*i+groupW/2;
    const yi=y(d.income),ye=y(d.expense);
    const hi=pad.t+plotH-yi,he=pad.t+plotH-ye;
    return `<rect x="${cx-barW-2}" y="${yi}" width="${barW}" height="${Math.max(0,hi)}" rx="4" fill="#175cd3"><title>${esc(monthLabel(d.month))} · Ingresos ${money(d.income)}</title></rect>
      <rect x="${cx+2}" y="${ye}" width="${barW}" height="${Math.max(0,he)}" rx="4" fill="#f79009"><title>${esc(monthLabel(d.month))} · Gastos ${money(d.expense)}</title></rect>
      <text x="${cx}" y="${H-24}" text-anchor="middle" font-size="9" fill="#667085">${esc(shortMonthLabel(d.month))}</text>`;
  }).join('');
  return `<svg class="r-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfica mensual de ingresos y gastos">${grid.join('')}${bars}</svg>`;
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

  const incomeTotal=incomes.reduce((s,x)=>s+incomeAmount(x),0);
  const expenseTotal=expenses.reduce((s,x)=>s+expenseAmount(x),0);
  const incomeMonth=incomes.filter(x=>incomeDate(x).slice(0,7)===summaryMonth).reduce((s,x)=>s+incomeAmount(x),0);
  const expenseMonth=expenses.filter(x=>String(x.date||'').slice(0,7)===summaryMonth).reduce((s,x)=>s+expenseAmount(x),0);
  const balance=incomeMonth-expenseMonth;

  document.getElementById('rIncomeMonth').textContent=money(incomeMonth);
  document.getElementById('rIncomeTotal').textContent=money(incomeTotal);
  document.getElementById('rIncomeTotal2').textContent=money(incomeTotal);
  document.getElementById('rExpenseMonth').textContent=money(expenseMonth);
  document.getElementById('rExpenseTotal').textContent=money(expenseTotal);
  document.getElementById('rBalanceMonth').textContent=money(balance);
  document.getElementById('rIncomeMonthSub').textContent=`Ingresos recibidos en ${monthLabel(summaryMonth)}`;
  const bc=document.getElementById('rBalanceCard');
  bc.classList.toggle('positive',balance>0);bc.classList.toggle('negative',balance<0);

  let allMonths=[...new Set(months)].sort();
  if(!allMonths.length)allMonths=[summaryMonth];
  if(summaryRange>0)allMonths=allMonths.slice(-summaryRange);
  const series=allMonths.map(month=>({
    month,
    income:incomes.filter(x=>incomeDate(x).slice(0,7)===month).reduce((s,x)=>s+incomeAmount(x),0),
    expense:expenses.filter(x=>String(x.date||'').slice(0,7)===month).reduce((s,x)=>s+expenseAmount(x),0)
  }));
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
  document.getElementById('rRangeSelect')?.addEventListener('change',e=>{summaryRange=Number(e.target.value)||0;refreshSummary()});
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
