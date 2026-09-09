let gastosDB=null;
let editingGastoId=null;
let gastoViewType='todos';
let gastoFormType='corriente';
let gastoMainView='capture';
let gastoSort={key:'date',dir:'desc'};

const GASTOS_DB='FinoFinanzaGastosDB';
const GASTOS_STORE='gastos';

const PEOPLE_KEY='finoFinanza.incomePeople';
const AI_TOKEN_KEY='finoFinanza.aiAccessToken';
const CAT_PREFIX='finoFinanza.gastoCategorias.';
const CREDIT_CARDS_KEY='finoFinanza.creditCards';
const QUICK_TEMPLATES_KEY='finoFinanza.quickExpenseTemplates';
const LEGACY_FIXED_TEMPLATES_KEY='finoFinanza.fixedExpenseTemplates';
const STATEMENT_RULES_KEY='finoFinanza.statementMerchantRules';
const STATEMENT_FINANCING_KEY='finoFinanza.statementFinancingPlans';
const CARD_REWARDS_KEY='finoFinanza.cardRewards';

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

let statementPdfFile=null;
let statementPdfDoc=null;
let statementMovements=[];
let statementFinancing=[];
let statementRewards=null;
let statementMeta={};
let statementProfile='auto';
let statementDetectedProfile='';
const PDFJS_CDN='https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
const PDFJS_WORKER='https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
const TESSERACT_CDN='https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

function ensureScript(src,id){
  return new Promise((resolve,reject)=>{
    if(id&&document.getElementById(id))return resolve();
    const existing=[...document.scripts].find(s=>s.src===src);
    if(existing){
      if(existing.dataset.loaded==='1')return resolve();
      existing.addEventListener('load',()=>resolve(),{once:true});
      existing.addEventListener('error',()=>reject(new Error('No fue posible cargar '+src)),{once:true});
      return;
    }
    const s=document.createElement('script');
    if(id)s.id=id;
    s.src=src;
    s.async=true;
    s.addEventListener('load',()=>{s.dataset.loaded='1';resolve()},{once:true});
    s.addEventListener('error',()=>reject(new Error('No fue posible cargar '+src)),{once:true});
    document.head.appendChild(s);
  });
}

async function ensureStatementLibraries(){
  if(!window.pdfjsLib){
    await ensureScript(PDFJS_CDN,'ffPdfJs');
    window.pdfjsLib.GlobalWorkerOptions.workerSrc=PDFJS_WORKER;
  }
  if(!window.Tesseract){
    await ensureScript(TESSERACT_CDN,'ffTesseractJs');
  }
}

function parseMoneyMX(raw=''){
  let s=String(raw).replace(/[^\d.,-]/g,'').trim();
  if(!s)return 0;
  if(s.includes(',')&&s.includes('.'))s=s.replace(/,/g,'');
  else if(s.includes(',')&&!s.includes('.'))s=s.replace(',','.');
  return Number(s)||0;
}

function parseHsbcDate(raw='',year=2026){
  const m=String(raw).match(/(\d{1,2})[-\/](\w{3})[-\/](\d{4})/i);
  if(!m)return '';
  const months={ene:'01',feb:'02',mar:'03',abr:'04',may:'05',jun:'06',jul:'07',ago:'08',sep:'09',oct:'10',nov:'11',dic:'12'};
  const mon=months[norm(m[2]).slice(0,3)];
  if(!mon)return '';
  return `${m[3]}-${mon}-${String(m[1]).padStart(2,'0')}`;
}

function parseCardDate(raw=''){
  return parseHsbcDate(raw);
}

function getStoredFinancingPlans(){
  try{
    const v=JSON.parse(localStorage.getItem(STATEMENT_FINANCING_KEY)||'[]');
    return Array.isArray(v)?v:[];
  }catch{return []}
}
function saveStoredFinancingPlans(v){
  localStorage.setItem(STATEMENT_FINANCING_KEY,JSON.stringify((v||[]).slice(-500)));
}
function getStoredCardRewards(){
  try{
    const v=JSON.parse(localStorage.getItem(CARD_REWARDS_KEY)||'{}');
    return v&&typeof v==='object'?v:{};
  }catch{return {}}
}
function saveStoredCardReward(cardName,reward){
  if(!cardName||!reward)return;
  const all=getStoredCardRewards();
  all[cardName]={...reward,updatedAt:new Date().toISOString()};
  localStorage.setItem(CARD_REWARDS_KEY,JSON.stringify(all));
}

async function extractPdfPageLines(pdf,pageNum){
  const page=await pdf.getPage(pageNum);
  const content=await page.getTextContent();
  const items=(content.items||[]).filter(x=>String(x.str||'').trim()).map(x=>({
    text:String(x.str||'').trim(),
    x:Number(x.transform?.[4]||0),
    y:Number(x.transform?.[5]||0)
  }));
  const rows=[];
  const tolerance=2.2;
  for(const item of items.sort((a,b)=>b.y-a.y||a.x-b.x)){
    let row=rows.find(r=>Math.abs(r.y-item.y)<=tolerance);
    if(!row){row={y:item.y,items:[]};rows.push(row)}
    row.items.push(item);
  }
  rows.sort((a,b)=>b.y-a.y);
  return rows.map(r=>r.items.sort((a,b)=>a.x-b.x).map(i=>i.text).join(' ').replace(/\s+/g,' ').trim()).filter(Boolean);
}

async function extractPdfText(pdf,pageNums=[]){
  const out=[];
  for(const pageNum of pageNums){
    if(pageNum<1||pageNum>pdf.numPages)continue;
    const lines=await extractPdfPageLines(pdf,pageNum);
    out.push({pageNum,lines,text:lines.join('\n')});
  }
  return out;
}

function scoreStatementProfile(rawText='',fileName=''){
  const text=norm(`${fileName} ${rawText}`);
  let hsbc=0,costco=0;

  // Costco Banamex suele ser muy explícito en el PDF.
  if(text.includes('costco'))costco+=5;
  if(text.includes('banamex'))costco+=4;
  if(text.includes('tarjeta de credito costco banamex'))costco+=8;
  if(text.includes('reembolso anual'))costco+=3;

  // HSBC 2Now cambia ligeramente de formato entre estados y no siempre
  // conserva la cadena exacta "HSBC 2Now" en la capa de texto.
  if(text.includes('hsbc'))hsbc+=5;
  if(text.includes('2now')||text.includes('2 now'))hsbc+=7;
  if(text.includes('saldo 2now')||text.includes('saldo hsbc 2now'))hsbc+=6;
  if(text.includes('cashback')||text.includes('saldo cashback'))hsbc+=2;
  if(text.includes('tarjeta de credito hsbc'))hsbc+=3;
  if(text.includes('cargos abonos y compras regulares')||text.includes('cargos, abonos y compras regulares'))hsbc+=2;

  if(costco>=7 && costco>hsbc)return {profile:'costco-banamex',score:costco};
  if(hsbc>=5 && hsbc>=costco)return {profile:'hsbc-2now',score:hsbc};
  return {profile:'',score:Math.max(hsbc,costco)};
}

async function ocrStatementIdentityPages(pdf,pageNums=[1,2]){
  if(!window.Tesseract)return '';
  const worker=await window.Tesseract.createWorker('spa');
  const chunks=[];
  try{
    for(const pageNum of pageNums){
      if(pageNum<1||pageNum>pdf.numPages)continue;
      setStatementStatus(`Identificando estado de cuenta · revisando página ${pageNum}…`);
      const canvas=await renderPdfPageToCanvas(pdf,pageNum,1.8);
      const result=await worker.recognize(canvas);
      chunks.push(result?.data?.text||'');
    }
  }finally{
    await worker.terminate();
  }
  return chunks.join('\n');
}

async function detectStatementProfile(pdf,fileName=''){
  // Primero usamos la capa de texto: es rápida y suficiente para la mayoría.
  const pageNums=[1,2,3,4].filter(n=>n<=pdf.numPages);
  const pages=await extractPdfText(pdf,pageNums);
  const nativeText=pages.map(p=>p.text).join('\n');
  let result=scoreStatementProfile(nativeText,fileName);
  if(result.profile)return {profile:result.profile,pages,detectionSource:'text'};

  // Algunos estados HSBC 2Now traen una capa de texto pobre o fragmentada.
  // En ese caso hacemos OCR únicamente de las primeras páginas para identificarlo.
  const ocrText=await ocrStatementIdentityPages(pdf,[1,2].filter(n=>n<=pdf.numPages));
  result=scoreStatementProfile(`${nativeText}\n${ocrText}`,fileName);
  if(result.profile)return {profile:result.profile,pages,detectionSource:'ocr',identityOcr:ocrText};

  return {profile:'',pages,detectionSource:'none',identityOcr:ocrText};
}

function profileCardName(profile=''){
  if(profile==='costco-banamex')return 'Costco Banamex';
  if(profile==='hsbc-2now')return 'HSBC 2Now';
  return 'Tarjeta de crédito';
}

function financingPlanKey(x={}){
  return [norm(x.card||''),norm(x.description||''),x.operationDate||'',Number(x.originalAmount||0).toFixed(2),x.installments||''].join('|');
}

function persistStatementFinancing(){
  if(!statementFinancing.length)return;
  const current=getStoredFinancingPlans();
  for(const plan of statementFinancing){
    const item={...plan,card:statementCardName(),person:document.getElementById('gStatementPerson')?.value||'',updatedAt:new Date().toISOString()};
    const key=financingPlanKey(item);
    const idx=current.findIndex(x=>financingPlanKey(x)===key);
    if(idx>=0)current[idx]={...current[idx],...item}; else current.push(item);
  }
  saveStoredFinancingPlans(current);
}

const BUILTIN_STATEMENT_RULES=[
  {match:['spotify'],concept:'Spotify',type:'fijo',category:'Suscripciones'},
  {match:['netflix'],concept:'Netflix',type:'fijo',category:'Suscripciones'},
  {match:['openai','chatgpt'],concept:'ChatGPT',type:'fijo',category:'Suscripciones'},
  {match:['telcel'],concept:'Telcel',type:'fijo',category:'Telefonía'},
  {match:['walmart','wal mart'],concept:'Walmart',type:'corriente',category:'Supermercado'},
  {match:['bodega aurrera','aurrera'],concept:'Bodega Aurrera',type:'corriente',category:'Supermercado'},
  {match:['soriana'],concept:'Soriana',type:'corriente',category:'Supermercado'},
  {match:['chedraui'],concept:'Chedraui',type:'corriente',category:'Supermercado'},
  {match:['costco'],concept:'Costco',type:'corriente',category:'Supermercado'},
  {match:['cinemex'],concept:'Cinemex',type:'corriente',category:'Entretenimiento'},
  {match:['cinepolis','cinépolis'],concept:'Cinépolis',type:'corriente',category:'Entretenimiento'},
  {match:['uber'],concept:'Uber',type:'corriente',category:'Transporte'},
  {match:['didi'],concept:'DiDi',type:'corriente',category:'Transporte'},
  {match:['farmacias del ahorro','farmacia del ahorro'],concept:'Farmacias del Ahorro',type:'corriente',category:'Salud / Farmacia'},
  {match:['farmacia guadalajara'],concept:'Farmacia Guadalajara',type:'corriente',category:'Salud / Farmacia'},
  {match:['starbucks'],concept:'Starbucks',type:'corriente',category:'Comida fuera'},
  {match:['appleb'],concept:"Applebee's",type:'corriente',category:'Comida fuera'}
];

function statementSignature(description=''){
  const stop=new Set(['mex','mexico','pue','puebla','mx','compra','venta','pos','terminal','tarjeta']);
  const parts=norm(description)
    .replace(/\b\d{3,}\b/g,' ')
    .replace(/[^a-z0-9ñ ]+/g,' ')
    .split(/\s+/)
    .filter(x=>x&&x.length>1&&!stop.has(x));
  return parts.slice(0,6).join(' ').trim();
}

function getStatementRules(){
  try{
    const parsed=JSON.parse(localStorage.getItem(STATEMENT_RULES_KEY)||'[]');
    return Array.isArray(parsed)?parsed.filter(x=>x&&x.signature&&x.concept):[];
  }catch{return []}
}
function saveStatementRules(rules){
  localStorage.setItem(STATEMENT_RULES_KEY,JSON.stringify(rules.slice(-500)));
}
function rememberStatementRule(movement){
  if(!movement?.originalDescription||!movement?.importable)return;
  const signature=statementSignature(movement.originalDescription);
  if(!signature)return;
  const rule={
    signature,
    concept:String(movement.description||'').trim()||genericStatementConcept(movement.originalDescription),
    type:movement.type||'corriente',
    category:movement.category||'Otro',
    updatedAt:new Date().toISOString()
  };
  const rules=getStatementRules();
  const idx=rules.findIndex(x=>x.signature===signature);
  if(idx>=0)rules[idx]=rule; else rules.push(rule);
  saveStatementRules(rules);
}
function findStatementRule(description=''){
  const d=norm(description);
  const signature=statementSignature(description);
  const custom=getStatementRules()
    .filter(r=>signature===r.signature || (r.signature.length>=6&&d.includes(r.signature)))
    .sort((a,b)=>b.signature.length-a.signature.length)[0];
  if(custom)return {...custom,source:'learned'};
  const builtin=BUILTIN_STATEMENT_RULES.find(rule=>rule.match.some(token=>d.includes(norm(token))));
  if(builtin)return {...builtin,source:'builtin'};
  return null;
}
function titleCaseMerchant(value=''){
  const keep=new Set(['OXXO','BP','HSBC','BBVA','KFC','VIPS','CFE']);
  return String(value).split(/\s+/).filter(Boolean).map(w=>{
    const u=w.toUpperCase();
    return keep.has(u)?u:w.charAt(0).toUpperCase()+w.slice(1).toLowerCase();
  }).join(' ');
}
function genericStatementConcept(description=''){
  let s=String(description)
    .replace(/\*+/g,' ')
    .replace(/\b(?:MXN|MEX|MEXICO|MÉXICO|PUE|PUEBLA)\b/gi,' ')
    .replace(/\b\d{3,}\b/g,' ')
    .replace(/\s{2,}/g,' ')
    .trim();
  return titleCaseMerchant(s||description||'Movimiento');
}

function classifyHsbcMovement(description='',signedAmount=0){
  const d=norm(description);
  if(d.includes('su pago')||d.includes('pago gracias')||signedAmount<0){
    return {kind:'payment',importable:false,type:'',category:'',concept:'Pago de tarjeta',reason:'Pago/abono: no es gasto nuevo'};
  }
  if(d.includes('intereses')||d.includes('iva sobre comisiones')||d.includes('iva promocion')){
    return {kind:'financial',importable:false,type:'corriente',category:'Trámites',concept:genericStatementConcept(description),reason:'Cargo financiero: revisar antes de importar'};
  }

  const rule=findStatementRule(description);
  if(rule){
    return {kind:'purchase',importable:true,concept:rule.concept,type:rule.type,category:rule.category,reason:rule.source==='learned'?'Clasificación aprendida':'Clasificación automática'};
  }

  let type='corriente',category='Otro';
  if(d.includes('gasol')||d.includes('gaso')||d.includes('pemex'))category='Gasolina';
  else if(d.includes('mercado'))category='Supermercado';
  else if(d.includes('tacos')||d.includes('restaurant')||d.includes('cafe')||d.includes('comida')||d.includes('dulcer')||d.includes('pastel')||d.includes('frutas')||d.includes('helado'))category='Comida fuera';
  else if(d.includes('cine'))category='Entretenimiento';
  else if(d.includes('clinica')||d.includes('farm')||d.includes('doctor'))category='Salud / Farmacia';

  return {kind:'purchase',importable:true,concept:genericStatementConcept(description),type,category,reason:'Compra regular'};
}

function extractHsbcMovementsFromOCR(text=''){
  const lines=String(text).split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  const rows=[];

  // HSBC 2Now: filas comienzan con fecha operación, fecha cargo, descripción y monto.
  const datePattern=/^(\d{1,2}[-\/][A-Za-zÁÉÍÓÚáéíóú]{3}[-\/]\d{4})\s+(\d{1,2}[-\/][A-Za-zÁÉÍÓÚáéíóú]{3}[-\/]\d{4})\s+(.+?)\s+([+-]?\s*\$?\s*[\d,\s]+\.\d{2})$/i;

  for(const line of lines){
    const clean=line.replace(/\s{2,}/g,' ');
    const m=clean.match(datePattern);
    if(!m)continue;

    let amountText=m[4].replace(/\s/g,'');
    const negative=/^-/.test(amountText);
    const amount=parseMoneyMX(amountText);
    const signedAmount=negative?-Math.abs(amount):Math.abs(amount);
    const classification=classifyHsbcMovement(m[3],signedAmount);

    rows.push({
      operationDate:parseHsbcDate(m[1]),
      chargeDate:parseHsbcDate(m[2]),
      originalDescription:m[3].trim(),
      description:classification.concept||genericStatementConcept(m[3]),
      amount:Math.abs(amount),
      signedAmount,
      ...classification,
      selected:classification.importable,
      source:'HSBC 2Now'
    });
  }

  // Deduplicate OCR echoes.
  const seen=new Set();
  return rows.filter(r=>{
    const key=[r.operationDate,r.chargeDate,norm(r.originalDescription||r.description),r.signedAmount].join('|');
    if(seen.has(key))return false;
    seen.add(key);
    return true;
  });
}


function classifyBanamexMovement(description='',signedAmount=0){
  const d=norm(description);
  if(signedAmount<0||d.includes('pago interbancario')||d.includes('pago recibido')){
    return {kind:'payment',importable:false,type:'',category:'',concept:'Pago de tarjeta',reason:'Pago/abono: no es gasto nuevo'};
  }
  if(d.includes('interes')||d.includes('iva por intereses')||d.includes('diferimiento de saldo')){
    return {kind:'financial',importable:false,type:'corriente',category:'Trámites',concept:genericStatementConcept(description),reason:'Financiamiento/intereses: se controla aparte'};
  }
  const installment=/\b0*([1-9]\d*)\s+de\s+0*([1-9]\d*)\b/i.exec(description);
  const rule=findStatementRule(description);
  let concept=rule?.concept||genericStatementConcept(description.replace(/\b0*\d+\s+de\s+0*\d+\b/ig,' '));
  let type=rule?.type||'corriente',category=rule?.category||'Otro';
  if(!rule){
    if(d.includes('farm'))category='Salud / Farmacia';
    else if(d.includes('gasol'))category='Gasolina';
    else if(d.includes('walmart')||d.includes('bodega')||d.includes('sams'))category='Supermercado';
    else if(d.includes('rest ')||d.includes('antojitos')||d.includes('paleteria')||d.includes('heladeria')||d.includes('zarza'))category='Comida fuera';
    else if(d.includes('ticket'))category='Entretenimiento';
  }
  return {
    kind:installment?'installment':'purchase',importable:true,concept,type,category,
    reason:installment?`Mensualidad ${Number(installment[1])} de ${Number(installment[2])}`:(rule?.source==='learned'?'Clasificación aprendida':'Compra regular'),
    installmentNumber:installment?Number(installment[1]):null,
    installments:installment?Number(installment[2]):null
  };
}

function extractBanamexRegularMovements(lines=[]){
  const rows=[];
  const dateRx='(\\d{1,2}[-/][A-Za-zÁÉÍÓÚáéíóú]{3}[-/]\\d{4})';
  const rx=new RegExp('^'+dateRx+'\\s+'+dateRx+'\\s+(.+?)\\s+([+-])?\\s*\\$?\\s*([\\d,]+\\.\\d{2})$','i');
  for(let i=0;i<lines.length;i++){
    let line=String(lines[i]||'').replace(/\s+/g,' ').trim();
    let m=line.match(rx);
    if(!m)continue;
    const description=m[3].trim();
    const amount=parseMoneyMX(m[5]);
    const signedAmount=m[4]==='-'?-Math.abs(amount):Math.abs(amount);
    const cls=classifyBanamexMovement(description,signedAmount);
    rows.push({
      operationDate:parseCardDate(m[1]),chargeDate:parseCardDate(m[2]),originalDescription:description,
      description:cls.concept||genericStatementConcept(description),amount:Math.abs(amount),signedAmount,
      ...cls,selected:cls.importable,source:'Costco Banamex'
    });
  }
  const seen=new Set();
  return rows.filter(r=>{
    const key=[r.operationDate,r.chargeDate,norm(r.originalDescription),r.signedAmount].join('|');
    if(seen.has(key))return false;seen.add(key);return true;
  });
}

function parseBanamexFinancing(lines=[]){
  const plans=[];
  for(const raw of lines){
    const line=String(raw||'').replace(/\s+/g,' ').trim();
    // MSI: fecha + descripción + monto original + saldo pendiente + pago requerido + N de M + NA
    let m=line.match(/^(\d{1,2}[-/][A-Za-zÁÉÍÓÚáéíóú]{3}[-/]\d{4})\s+(.+?)\s+\$?([\d,]+\.\d{2})\s+\$?([\d,]+\.\d{2})\s+\$?([\d,]+\.\d{2})\s+(\d+)\s+de\s+(\d+)\s+(?:NA|N\/?A)$/i);
    if(m){
      plans.push({
        operationDate:parseCardDate(m[1]),description:genericStatementConcept(m[2]),originalDescription:m[2].trim(),
        financingType:'MSI',originalAmount:parseMoneyMX(m[3]),pendingBalance:parseMoneyMX(m[4]),monthlyPayment:parseMoneyMX(m[5]),
        installmentNumber:Number(m[6]),installments:Number(m[7]),interestRate:0,periodInterest:0,interestTax:0,active:Number(m[6])<Number(m[7])
      });
      continue;
    }
    // Meses con intereses: fecha + descripción + original + pendiente + interés + IVA + pago + N de M + tasa%
    m=line.match(/^(\d{1,2}[-/][A-Za-zÁÉÍÓÚáéíóú]{3}[-/]\d{4})\s+(.+?)\s+\$?([\d,]+\.\d{2})\s+\$?([\d,]+\.\d{2})\s+\$?([\d,]+\.\d{2})\s+\$?([\d,]+\.\d{2})\s+\$?([\d,]+\.\d{2})\s+(\d+)\s+de\s+(\d+)\s+([\d.]+)%$/i);
    if(m){
      plans.push({
        operationDate:parseCardDate(m[1]),description:genericStatementConcept(m[2]),originalDescription:m[2].trim(),
        financingType:'CON_INTERESES',originalAmount:parseMoneyMX(m[3]),pendingBalance:parseMoneyMX(m[4]),periodInterest:parseMoneyMX(m[5]),interestTax:parseMoneyMX(m[6]),monthlyPayment:parseMoneyMX(m[7]),
        installmentNumber:Number(m[8]),installments:Number(m[9]),interestRate:Number(m[10])||0,active:Number(m[8])<Number(m[9])
      });
    }
  }
  return plans;
}

function extractNumberNear(text='',label=''){
  const idx=norm(text).indexOf(norm(label));
  if(idx<0)return null;
  const seg=String(text).slice(idx,idx+260);
  const m=seg.match(/\$?\s*([\d,]+\.\d{2})/);
  return m?parseMoneyMX(m[1]):null;
}

function parseBanamexRewards(text=''){
  const clean=String(text).replace(/\s+/g,' ');
  const ready=extractNumberNear(clean,'Listo para usar');
  const previous=extractNumberNear(clean,'Acumulado al corte anterior');
  const total=extractNumberNear(clean,'Acumulado total');
  let generated=null;
  // En el recuadro Banamex aparecen porcentajes; sumamos importes de 5%, 4%, 3%, 2%, 1% si están presentes.
  const pct=[...clean.matchAll(/(?:5%|4%|3%|2%|1%)\s*\$?\s*([\d,]+\.\d{2})/g)].map(m=>parseMoneyMX(m[1]));
  if(pct.length)generated=pct.reduce((a,b)=>a+b,0);
  if(ready==null&&previous==null&&total==null&&generated==null)return null;
  return {program:'Reembolso Anual Costco Banamex',availableBalance:ready,previousAccumulated:previous,earnedThisPeriod:generated,totalAccumulated:total};
}

function parseHsbc2NowRewards(text='',movements=[]){
  const clean=String(text).replace(/\s+/g,' ');
  const has2now=/2\s*now/i.test(clean)||/saldo\s+2\s*now/i.test(clean);
  let current=null,earned=null;
  const currentMatch=clean.match(/saldo\s+(?:hsbc\s*)?2\s*now[^$\d]{0,80}\$?\s*([\d,]+\.\d{2})/i);
  if(currentMatch)current=parseMoneyMX(currentMatch[1]);
  const earnedMatch=clean.match(/(?:cashback|saldo\s+2\s*now)[^$\d]{0,120}(?:generado|bonificad[oa]|acumulad[oa])[^$\d]{0,60}\$?\s*([\d,]+\.\d{2})/i);
  if(earnedMatch)earned=parseMoneyMX(earnedMatch[1]);
  const eligible=movements.filter(x=>x.importable&&x.kind==='purchase').reduce((sum,x)=>sum+Number(x.amount||0),0);
  const estimated=Math.min(eligible,42500)*0.02;
  if(!has2now&&current==null&&!movements.length)return null;
  return {program:'Saldo 2Now',cashbackRate:0.02,currentBalance:current,earnedThisPeriod:earned,eligiblePurchases:eligible,estimatedNextCredit:estimated,eligibleCap:42500,estimatedMaxCashback:850};
}

async function extractCostcoBanamexStatement(pdf,prefetchedPages=[]){
  const pageNums=[1,2,3].filter(n=>n<=pdf.numPages);
  const pages=prefetchedPages?.length?prefetchedPages:await extractPdfText(pdf,pageNums);
  const lines=pages.flatMap(p=>p.lines||[]);
  const text=pages.map(p=>p.text).join('\n');
  const movements=extractBanamexRegularMovements(lines);
  const financing=parseBanamexFinancing(lines);
  const rewards=parseBanamexRewards(text);
  const period=(text.match(/Periodo:?\s*(\d{1,2}-[A-Za-zÁÉÍÓÚáéíóú]{3}-\d{4})\s+al\s+(\d{1,2}-[A-Za-zÁÉÍÓÚáéíóú]{3}-\d{4})/i)||[]);
  const cut=(text.match(/Fecha de corte:?\s*(\d{1,2}-[A-Za-zÁÉÍÓÚáéíóú]{3}-\d{4})/i)||[])[1];
  const due=(text.match(/Fecha l[ií]mite de pago:?[^\d]*(\d{1,2}-[A-Za-zÁÉÍÓÚáéíóú]{3}-\d{4})/i)||[])[1];
  return {movements,financing,rewards,text,meta:{periodStart:parseCardDate(period[1]||''),periodEnd:parseCardDate(period[2]||''),cutDate:parseCardDate(cut||''),dueDate:parseCardDate(due||'')}};
}

async function renderPdfPageToCanvas(pdf,pageNum,scale=2){
  const page=await pdf.getPage(pageNum);
  const viewport=page.getViewport({scale});
  const canvas=document.createElement('canvas');
  canvas.width=Math.ceil(viewport.width);
  canvas.height=Math.ceil(viewport.height);
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  await page.render({canvasContext:ctx,viewport}).promise;
  return canvas;
}

function isHsbcMovementsPage(text=''){
  const t=norm(text);
  const hasMainTitle=
    t.includes('cargos abonos y compras regulares') ||
    t.includes('cargos, abonos y compras regulares') ||
    (t.includes('compras regulares') && t.includes('no a meses'));

  const hasDateHeaders=
    (t.includes('fecha de la operacion') || t.includes('fecha operacion')) &&
    (t.includes('fecha de cargo') || t.includes('fecha cargo'));

  const hasDescriptionHeader=
    t.includes('descripcion del movimiento') ||
    t.includes('descripcion');

  const hasAmountHeader=t.includes('monto');

  const dateHits=(String(text).match(/\d{1,2}[-\/][A-Za-zÁÉÍÓÚáéíóú]{3}[-\/]\d{4}/g)||[]).length;

  return hasMainTitle && hasDateHeaders && hasDescriptionHeader && hasAmountHeader && dateHits>=4;
}

async function ocrHsbcMovementPage(pdf){
  const candidates=[];
  if(pdf.numPages>=4)candidates.push(4);
  for(const n of [5,3,6,2]){
    if(n<=pdf.numPages&&!candidates.includes(n))candidates.push(n);
  }

  const worker=await window.Tesseract.createWorker('spa');
  let best={pageNum:null,text:'',score:0};

  try{
    for(const pageNum of candidates){
      setStatementStatus(`Buscando movimientos · página ${pageNum} de ${pdf.numPages}…`);
      const canvas=await renderPdfPageToCanvas(pdf,pageNum,2.35);
      const result=await worker.recognize(canvas);
      const text=result?.data?.text||'';

      if(isHsbcMovementsPage(text)){
        return {pageNum,text};
      }

      const score=(String(text).match(/\d{1,2}[-\/][A-Za-zÁÉÍÓÚáéíóú]{3}[-\/]\d{4}/g)||[]).length;
      if(score>best.score)best={pageNum,text,score};
    }
  }finally{
    await worker.terminate();
  }

  return best.score>=4 ? best : {pageNum:null,text:''};
}

function setStatementStatus(text='',kind=''){
  const el=document.getElementById('gStatementStatus');
  if(!el)return;
  el.textContent=text;
  el.dataset.kind=kind;
}

function statementCardName(){
  return document.getElementById('gStatementCardName')?.value?.trim()||profileCardName(statementDetectedProfile||statementProfile);
}

function ensureStatementCardCatalog(){
  const name=statementCardName();
  if(!name)return;
  const cards=getCreditCards();
  if(!cards.some(x=>norm(x)===norm(name))){
    saveCreditCards([...cards,name]);
  }
}

async function processStatement(){
  if(!statementPdfFile){
    alert('Selecciona primero un estado de cuenta PDF.');
    return;
  }

  try{
    await ensureStatementLibraries();
    setStatementStatus('Abriendo PDF…');

    const data=await statementPdfFile.arrayBuffer();
    statementPdfDoc=await window.pdfjsLib.getDocument({data}).promise;
    statementMovements=[];statementFinancing=[];statementRewards=null;statementMeta={};

    let prefetched=[];
    let profile=statementProfile;
    if(profile==='auto'){
      setStatementStatus('Identificando banco y producto…');
      const detected=await detectStatementProfile(statementPdfDoc,statementPdfFile?.name||'');
      profile=detected.profile;
      prefetched=detected.pages||[];
      if(!profile)throw new Error('No pude identificar automáticamente el tipo de estado de cuenta. Prueba seleccionando el perfil manualmente.');
    }
    statementDetectedProfile=profile;
    const cardInput=document.getElementById('gStatementCardName');
    if(cardInput)cardInput.value=profileCardName(profile);

    if(profile==='hsbc-2now'){
      const {pageNum,text}=await ocrHsbcMovementPage(statementPdfDoc);
      if(!pageNum||!text){
        setStatementStatus('Identifiqué HSBC 2Now, pero no encontré su tabla de movimientos.','warn');
        return;
      }
      statementMovements=extractHsbcMovementsFromOCR(text);
      statementRewards=parseHsbc2NowRewards(text,statementMovements);
      statementMeta={movementPage:pageNum};
      const dbg=document.getElementById('gStatementOcr');
      if(dbg)dbg.value=text;
    }else if(profile==='costco-banamex'){
      setStatementStatus('Leyendo Costco Banamex…');
      const parsed=await extractCostcoBanamexStatement(statementPdfDoc,prefetched);
      statementMovements=parsed.movements;
      statementFinancing=parsed.financing;
      statementRewards=parsed.rewards;
      statementMeta=parsed.meta||{};
      const dbg=document.getElementById('gStatementOcr');
      if(dbg)dbg.value=parsed.text||'';
    }else{
      throw new Error('Perfil bancario todavía no compatible.');
    }

    if(!statementMovements.length && !statementFinancing.length && !statementRewards){
      setStatementStatus('Identifiqué el estado de cuenta, pero no pude estructurar sus datos. Usa “Ver texto” para revisar la extracción.','warn');
      return;
    }

    renderStatementPreview();
    renderStatementExtras();
    persistStatementFinancing();
    if(statementRewards)saveStoredCardReward(statementCardName(),statementRewards);

    const profileLabel=profileCardName(profile);
    setStatementStatus(`${profileLabel} detectada · ${statementMovements.length} movimientos · ${statementFinancing.length} compras/planes a meses.`,'ok');
  }catch(err){
    console.error(err);
    setStatementStatus('No fue posible leer el estado de cuenta: '+(err?.message||err),'warn');
  }
}

function renderStatementPreview(){
  const area=document.getElementById('gStatementPreview');
  const body=document.getElementById('gStatementBody');
  if(!area||!body)return;

  area.style.display='';
  body.innerHTML=statementMovements.map((r,i)=>`
    <tr class="${r.importable?'':'g-statement-muted'}">
      <td><input type="checkbox" data-st-check="${i}" ${r.selected?'checked':''} ${r.importable?'':'disabled'}></td>
      <td>${fmtDate(r.operationDate)}</td>
      <td>${fmtDate(r.chargeDate)}</td>
      <td>
        ${r.importable?`<input class="g-statement-concept" data-st-concept="${i}" value="${esc(r.description)}" aria-label="Concepto simplificado">`:`<strong>${esc(r.description)}</strong>`}
        ${r.originalDescription?`<br><small class="g-original-desc" title="Descripción original del banco">${esc(r.originalDescription)}</small>`:''}
        <br><small>${esc(r.reason)}</small>
      </td>
      <td>
        ${r.importable?`
          <select data-st-type="${i}">
            <option value="fijo" ${r.type==='fijo'?'selected':''}>Fijo</option>
            <option value="corriente" ${r.type==='corriente'?'selected':''}>Corriente</option>
            <option value="manutencion" ${r.type==='manutencion'?'selected':''}>Manutención</option>
          </select>
        `:`<span>${r.kind==='payment'?'Pago/abono':'Cargo financiero'}</span>`}
      </td>
      <td>
        ${r.importable?`<select data-st-cat="${i}">${getCategories(r.type).map(c=>`<option value="${esc(c)}" ${c===r.category?'selected':''}>${esc(c)}</option>`).join('')}</select>`:'—'}
      </td>
      <td class="g-money">${r.signedAmount<0?'- ':''}${money(r.amount)}</td>
    </tr>
  `).join('');

  body.querySelectorAll('[data-st-check]').forEach(el=>{
    el.addEventListener('change',()=>statementMovements[Number(el.dataset.stCheck)].selected=el.checked);
  });
  body.querySelectorAll('[data-st-concept]').forEach(el=>{
    el.addEventListener('change',()=>{
      const i=Number(el.dataset.stConcept);
      statementMovements[i].description=el.value.trim()||statementMovements[i].description;
      rememberStatementRule(statementMovements[i]);
      statementMovements[i].reason='Clasificación aprendida';
    });
  });
  body.querySelectorAll('[data-st-type]').forEach(el=>{
    el.addEventListener('change',()=>{
      const i=Number(el.dataset.stType);
      statementMovements[i].type=el.value;
      statementMovements[i].category=getCategories(el.value)[0]||'Otro';
      rememberStatementRule(statementMovements[i]);
      statementMovements[i].reason='Clasificación aprendida';
      renderStatementPreview();
    });
  });
  body.querySelectorAll('[data-st-cat]').forEach(el=>{
    el.addEventListener('change',()=>{
      const i=Number(el.dataset.stCat);
      statementMovements[i].category=el.value;
      rememberStatementRule(statementMovements[i]);
      statementMovements[i].reason='Clasificación aprendida';
    });
  });

  const purchases=statementMovements.filter(x=>x.importable).length;
  const excluded=statementMovements.length-purchases;
  document.getElementById('gStatementSummary').textContent=
    `${purchases} compras importables · ${statementMovements.filter(x=>x.kind==='installment').length} mensualidades · ${excluded} movimientos excluidos/revisión`;
}


function renderStatementExtras(){
  const rewards=document.getElementById('gStatementRewards');
  const financing=document.getElementById('gStatementFinancing');
  if(rewards){
    if(!statementRewards){rewards.style.display='none';rewards.innerHTML=''}
    else{
      rewards.style.display='';
      const r=statementRewards;
      if(statementDetectedProfile==='hsbc-2now'){
        rewards.innerHTML=`<div class="g-extra-title"><strong>Saldo 2Now</strong><small>Cashback y proyección</small></div><div class="g-mini-stats">
          <div><small>Saldo actual</small><strong>${r.currentBalance==null?'—':money(r.currentBalance)}</strong></div>
          <div><small>Compras elegibles detectadas</small><strong>${money(r.eligiblePurchases||0)}</strong></div>
          <div><small>Cashback estimado próximo abono</small><strong>${money(r.estimatedNextCredit||0)}</strong></div>
          <div><small>Límite estimado por corte</small><strong>${money(r.estimatedMaxCashback||850)}</strong></div>
        </div>`;
      }else{
        rewards.innerHTML=`<div class="g-extra-title"><strong>Reembolso Costco Banamex</strong><small>Programa de beneficios</small></div><div class="g-mini-stats">
          <div><small>Disponible para usar</small><strong>${r.availableBalance==null?'—':money(r.availableBalance)}</strong></div>
          <div><small>Generado este corte</small><strong>${r.earnedThisPeriod==null?'—':money(r.earnedThisPeriod)}</strong></div>
          <div><small>Acumulado anterior</small><strong>${r.previousAccumulated==null?'—':money(r.previousAccumulated)}</strong></div>
          <div><small>Acumulado total</small><strong>${r.totalAccumulated==null?'—':money(r.totalAccumulated)}</strong></div>
        </div>`;
      }
    }
  }
  if(financing){
    if(!statementFinancing.length){financing.style.display='none';financing.innerHTML=''}
    else{
      financing.style.display='';
      const nextCommitment=statementFinancing.filter(x=>x.active!==false).reduce((s,x)=>s+Number(x.monthlyPayment||0),0);
      financing.innerHTML=`<div class="g-extra-title"><strong>Compras y planes a meses</strong><small>Compromiso mensual detectado: ${money(nextCommitment)}</small></div>
      <div class="g-table-wrap"><table class="g-fin-table"><thead><tr><th>Compra / plan</th><th>Tipo</th><th>Original</th><th>Mensualidad</th><th>Avance</th><th>Pendiente</th><th>Tasa</th></tr></thead><tbody>${statementFinancing.map(x=>`<tr>
        <td><strong>${esc(x.description)}</strong><br><small>${fmtDate(x.operationDate)}</small></td>
        <td>${x.financingType==='MSI'?'MSI':'Con intereses'}</td>
        <td class="g-money">${money(x.originalAmount)}</td><td class="g-money">${money(x.monthlyPayment)}</td>
        <td>${x.installmentNumber||'—'} / ${x.installments||'—'}</td><td class="g-money">${money(x.pendingBalance)}</td><td>${Number(x.interestRate||0).toFixed(2)}%</td>
      </tr>`).join('')}</tbody></table></div>`;
    }
  }
}

async function importSelectedStatementMovements(){
  const selected=statementMovements.filter(x=>x.importable&&x.selected);
  if(!selected.length){
    alert('No hay compras seleccionadas para importar.');
    return;
  }

  const person=document.getElementById('gStatementPerson')?.value||document.getElementById('gPerson')?.value||'';
  if(!person){
    alert('Selecciona la persona titular del estado de cuenta.');
    return;
  }

  ensureStatementCardCatalog();
  const card=statementCardName();

  const existing=await dbGetAll();
  let imported=0,skipped=0;

  for(const r of selected){
    const duplicate=existing.some(x=>
      x.date===r.operationDate &&
      Math.abs(Number(x.amount||0)-Number(r.amount||0))<0.01 &&
      norm(x.originalDescription||x.description)===norm(r.originalDescription||r.description) &&
      norm(x.creditCard||'')===norm(card)
    );
    if(duplicate){skipped++;continue}

    await dbAdd({
      person,
      type:r.type,
      category:r.category||'Otro',
      date:r.operationDate||r.chargeDate||today(),
      description:r.description,
      originalDescription:r.originalDescription||'',
      amount:Number(r.amount||0),
      paymentMethod:'Tarjeta de crédito',
      creditCard:card,
      account:'',
      note:`Importado desde estado de cuenta ${profileCardName(statementDetectedProfile||statementProfile)} · cargo ${fmtDate(r.chargeDate)}`,
      source:`statement-${statementDetectedProfile||statementProfile}`,
      financing:r.kind==='installment'?{type:'MSI',installmentNumber:r.installmentNumber||null,installments:r.installments||null}:null,
      createdAt:new Date().toISOString(),
      updatedAt:new Date().toISOString()
    });
    imported++;
  }

  await renderAll();
  setStatementStatus(`Importación terminada: ${imported} nuevas · ${skipped} duplicadas omitidas.`,'ok');
}

function clearStatementReader(){
  statementPdfFile=null;
  statementPdfDoc=null;
  statementMovements=[];
  statementFinancing=[];
  statementRewards=null;
  statementMeta={};
  statementDetectedProfile='';
  const input=document.getElementById('gStatementFile');
  if(input)input.value='';
  const name=document.getElementById('gStatementFileName');
  if(name)name.textContent='Haz clic aquí para elegir un archivo PDF';
  const preview=document.getElementById('gStatementPreview');
  if(preview)preview.style.display='none';
  const rewards=document.getElementById('gStatementRewards');if(rewards){rewards.style.display='none';rewards.innerHTML=''}
  const financing=document.getElementById('gStatementFinancing');if(financing){financing.style.display='none';financing.innerHTML=''}
  const dbg=document.getElementById('gStatementOcr');
  if(dbg)dbg.value='';
  setStatementStatus('Selecciona un estado de cuenta. La detección es automática.');
}


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

function ensureQuickTemplateModal(){
  if(document.getElementById('gQuickModal'))return;

  const overlay=document.createElement('div');
  overlay.id='gQuickModal';
  overlay.className='g-quick-overlay';
  overlay.innerHTML=`
    <div class="g-quick-modal" role="dialog" aria-modal="true" aria-labelledby="gQuickModalTitle">
      <div class="g-quick-modal-head">
        <div>
          <h3 id="gQuickModalTitle">Nuevo gasto rápido</h3>
          <p>Elige un tipo y una categoría conocida.</p>
        </div>
        <button class="g-btn" id="gQuickClose" type="button">Cerrar</button>
      </div>

      <div class="g-quick-modal-body">
        <div class="g-form-grid">
          <div class="g-field g-span2">
            <label>Nombre del acceso</label>
            <input id="gQuickName" type="text" placeholder="Ej. Disney+, Telcel, Gasolina">
          </div>

          <div class="g-field">
            <label>Tipo de gasto</label>
            <select id="gQuickType">
              <option value="fijo">Fijo</option>
              <option value="corriente">Corriente</option>
              <option value="manutencion">Manutención</option>
            </select>
          </div>

          <div class="g-field">
            <label>Categoría</label>
            <select id="gQuickCategory"></select>
          </div>

          <div class="g-field g-span2" id="gQuickOtherWrap" style="display:none">
            <label>Nueva categoría</label>
            <input id="gQuickOtherCategory" type="text" placeholder="Escribe la categoría">
          </div>
        </div>

        <div class="g-actions">
          <button class="g-btn" id="gQuickCancel" type="button">Cancelar</button>
          <button class="g-btn g-primary" id="gQuickSave" type="button">Crear acceso rápido</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('gQuickClose')?.addEventListener('click',closeQuickTemplateModal);
  document.getElementById('gQuickCancel')?.addEventListener('click',closeQuickTemplateModal);
  overlay.addEventListener('click',e=>{
    if(e.target===overlay)closeQuickTemplateModal();
  });

  document.getElementById('gQuickType')?.addEventListener('change',()=>{
    fillQuickTemplateCategories();
  });
  document.getElementById('gQuickCategory')?.addEventListener('change',()=>{
    updateQuickOtherCategory();
  });
  document.getElementById('gQuickSave')?.addEventListener('click',saveQuickTemplateFromModal);
}

function fillQuickTemplateCategories(selected=''){
  const type=document.getElementById('gQuickType')?.value||'fijo';
  const sel=document.getElementById('gQuickCategory');
  if(!sel)return;

  const list=getCategories(type);
  const known=list.filter(x=>norm(x)!=='otro');
  sel.innerHTML=known.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('')
    + '<option value="Otro">Otro</option>';

  if(selected && [...known,'Otro'].includes(selected))sel.value=selected;
  updateQuickOtherCategory();
}

function updateQuickOtherCategory(){
  const category=document.getElementById('gQuickCategory')?.value||'';
  const wrap=document.getElementById('gQuickOtherWrap');
  if(wrap)wrap.style.display=norm(category)==='otro'?'':'none';
  if(norm(category)!=='otro'){
    const input=document.getElementById('gQuickOtherCategory');
    if(input)input.value='';
  }
}

function openQuickTemplateModal(){
  ensureQuickTemplateModal();

  document.getElementById('gQuickName').value='';
  document.getElementById('gQuickType').value='fijo';
  document.getElementById('gQuickOtherCategory').value='';
  fillQuickTemplateCategories();

  document.getElementById('gQuickModal').classList.add('show');
  setTimeout(()=>document.getElementById('gQuickName')?.focus(),40);
}

function closeQuickTemplateModal(){
  document.getElementById('gQuickModal')?.classList.remove('show');
}

function saveQuickTemplateFromModal(){
  const name=(document.getElementById('gQuickName')?.value||'').trim();
  const type=document.getElementById('gQuickType')?.value||'fijo';
  let category=document.getElementById('gQuickCategory')?.value||'';

  if(!name){
    alert('Escribe el nombre del acceso rápido.');
    document.getElementById('gQuickName')?.focus();
    return;
  }

  if(norm(category)==='otro'){
    category=(document.getElementById('gQuickOtherCategory')?.value||'').trim();
    if(!category){
      alert('Escribe la nueva categoría.');
      document.getElementById('gQuickOtherCategory')?.focus();
      return;
    }
  }

  const template={
    name,
    type,
    category,
    description:name,
    paymentMethod:'Efectivo',
    creditCard:''
  };

  const list=getQuickTemplates();
  list.push(template);
  saveQuickTemplates(list);

  // Si fue una categoría nueva, queda disponible desde ahora en el catálogo.
  saveCategories(type,[...getCategories(type),category]);

  renderQuickTemplates();
  fillFilterCategories();
  closeQuickTemplateModal();
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
  const payDetails=document.getElementById('gPaymentDetails');
  if(payDetails && (t.paymentMethod!=='Efectivo'||t.creditCard))payDetails.open=true;
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
  document.getElementById('gAddQuickTemplate')?.addEventListener('click',openQuickTemplateModal);
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
    #gastos .g-main-tabs{display:flex;gap:6px;padding:5px;background:#f2f4f7;border:1px solid #e4e7ec;border-radius:13px;width:max-content;max-width:100%}
    #gastos .g-main-tab{border:0;background:transparent;color:#667085;border-radius:9px;padding:9px 14px;font-size:11px;font-weight:900;cursor:pointer;white-space:nowrap}
    #gastos .g-main-tab.active{background:#fff;color:#155eef;box-shadow:0 1px 3px rgba(16,24,40,.10)}
    #gastos .g-main-pane{display:none;gap:14px}
    #gastos .g-main-pane.active{display:grid}
    #gastos .g-history-toolbar{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}

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
    .g-quick-overlay{
      position:fixed;inset:0;background:rgba(15,23,42,.38);display:none;
      align-items:center;justify-content:center;padding:18px;z-index:9999
    }
    .g-quick-overlay.show{display:flex}
    .g-quick-modal{
      width:min(620px,100%);background:#fff;border:1px solid #e4e7ec;
      border-radius:16px;box-shadow:0 24px 70px rgba(15,23,42,.22);overflow:hidden
    }
    .g-quick-modal-head{
      padding:16px 18px;border-bottom:1px solid #e4e7ec;
      display:flex;justify-content:space-between;gap:12px;align-items:flex-start
    }
    .g-quick-modal-head h3{margin:0 0 4px;font-size:16px}
    .g-quick-modal-head p{margin:0;color:#667085;font-size:11px}
    .g-quick-modal-body{padding:18px}


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
    #gastos .g-statement-controls{
      display:grid;
      grid-template-columns:repeat(3,minmax(0,1fr));
      gap:10px;
      width:100%
    }
    #gastos .g-statement-controls .g-field{min-width:0}
    #gastos .g-statement-controls input,
    #gastos .g-statement-controls select{width:100%;min-width:0;box-sizing:border-box}
    #gastos .g-statement-drop{
      display:flex;
      flex-direction:column;
      align-items:center;
      justify-content:center;
      width:100%;
      min-height:112px;
      box-sizing:border-box;
      margin-top:12px;
      border:1.5px dashed #84adff;
      background:#f8fbff;
      border-radius:12px;
      padding:18px;
      text-align:center;
      cursor:pointer;
      color:#101828
    }
    #gastos .g-statement-drop:hover{background:#f0f6ff;border-color:#528bff}
    #gastos .g-statement-drop strong{display:block;margin:0 0 5px;font-size:13px}
    #gastos .g-statement-drop small{display:block;color:#667085;font-size:10px}
    #gastos .g-statement-actions{
      display:flex;
      gap:8px;
      flex-wrap:wrap;
      margin-top:12px;
      justify-content:flex-start;
      align-items:center
    }
    #gastos .g-statement-status{margin-top:10px;padding:9px 11px;border-radius:9px;background:#f8fafc;border:1px solid #e4e7ec;color:#475467;font-size:11px}
    #gastos .g-statement-status[data-kind="ok"]{background:#ecfdf3;border-color:#abefc6;color:#067647}
    #gastos .g-statement-status[data-kind="warn"]{background:#fffaeb;border-color:#fedf89;color:#b54708}
    #gastos .g-statement-preview{margin-top:14px}
    #gastos .g-statement-preview select{max-width:180px;border:1px solid #d0d5dd;border-radius:8px;padding:6px;background:#fff;font-size:10px}
    #gastos .g-statement-concept{width:min(230px,100%);box-sizing:border-box;border:1px solid #d0d5dd;border-radius:8px;padding:6px 7px;background:#fff;color:#101828;font-size:11px;font-weight:800}
    #gastos .g-original-desc{color:#98a2b3;font-size:9px;line-height:1.35}
    #gastos .g-disclosure{background:#fff;border:1px solid #e4e7ec;border-radius:16px;overflow:hidden}
    #gastos .g-disclosure>summary{list-style:none;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;cursor:pointer;font-weight:800;color:#101828}
    #gastos .g-disclosure>summary::-webkit-details-marker{display:none}
    #gastos .g-disclosure>summary::after{content:'＋';color:#667085;font-size:15px}
    #gastos .g-disclosure[open]>summary::after{content:'−'}
    #gastos .g-disclosure[open]>summary{border-bottom:1px solid #e4e7ec;background:#fcfcfd}
    #gastos .g-disclosure .g-disclosure-copy{min-width:0}
    #gastos .g-disclosure .g-disclosure-copy strong{display:block;font-size:13px}
    #gastos .g-disclosure .g-disclosure-copy small{display:block;margin-top:3px;color:#667085;font-size:10px;font-weight:500}
    #gastos .g-disclosure-body{padding:16px}
    #gastos .g-form-section{margin-top:12px;border-top:1px solid #eef2f6;padding-top:12px}
    #gastos .g-form-section>summary{cursor:pointer;color:#475467;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.03em}
    #gastos .g-form-section[open]>summary{margin-bottom:12px}
    #gastos .g-summary{gap:8px}
    #gastos .g-stat{padding:11px 12px}
    #gastos .g-stat strong{font-size:16px}
    #gastos .g-statement-muted{opacity:.58;background:#f8fafc}
    #gastos .g-statement-debug{display:none;margin-top:12px}
    #gastos .g-statement-debug textarea{width:100%;min-height:150px;box-sizing:border-box;border:1px solid #d0d5dd;border-radius:10px;padding:10px;font:10px ui-monospace,monospace}
    #gastos .g-statement-extra{margin-top:12px;border:1px solid #dbe7ff;background:#fbfdff;border-radius:12px;padding:12px}
    #gastos .g-extra-title{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:10px}
    #gastos .g-extra-title small{color:#667085;font-size:10px}
    #gastos .g-mini-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
    #gastos .g-mini-stats>div{background:#fff;border:1px solid #e4e7ec;border-radius:10px;padding:10px}
    #gastos .g-mini-stats small{display:block;color:#667085;font-size:9px;text-transform:uppercase;font-weight:800;margin-bottom:4px}
    #gastos .g-mini-stats strong{font-size:14px;color:#101828}
    #gastos .g-fin-table{min-width:760px}
    @media(max-width:820px){#gastos .g-mini-stats{grid-template-columns:1fr 1fr}}
    @media(max-width:820px){#gastos .g-statement-controls{grid-template-columns:1fr}}

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
      <div class="g-main-tabs" role="tablist" aria-label="Vistas de gastos">
        <button class="g-main-tab active" type="button" data-gmain="capture">＋ Registrar gasto</button>
        <button class="g-main-tab" type="button" data-gmain="history">≡ Historial</button>
      </div>

      <div class="g-main-pane active" id="gCapturePane" data-gpane="capture">
      <details class="g-disclosure" id="gQuickSection">
        <summary><span class="g-disclosure-copy"><strong>Gastos rápidos</strong><small>Accesos para servicios y gastos frecuentes.</small></span></summary>
        <div class="g-disclosure-body"><div class="g-fixed-grid" id="gQuickTemplates"></div></div>
      </details>

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
            </div>

            <details class="g-form-section" id="gPaymentDetails">
              <summary>Forma de pago y detalles adicionales</summary>
              <div class="g-form-grid">
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
            </details>

            <div class="g-actions">
              <button class="g-btn" id="gCancelEdit" type="button" style="display:none">Cancelar edición</button>
              <button class="g-btn g-primary" id="gSave" type="submit">Guardar gasto</button>
            </div>
          </form>
        </div>
      </section>


      <details class="g-disclosure" id="gStatementSection">
        <summary><span class="g-disclosure-copy"><strong>Lector de estados de cuenta</strong><small>Detección automática · HSBC 2Now + Costco Banamex · MSI, recompensas y aprendizaje.</small></span></summary>
        <div class="g-disclosure-body">
          <div class="g-statement-controls">
            <div class="g-field">
              <label>Perfil bancario</label>
              <select id="gStatementProfile">
                <option value="auto">Detectar automáticamente</option>
                <option value="hsbc-2now">HSBC 2Now · Tarjeta de crédito</option>
                <option value="costco-banamex">Costco Banamex · Tarjeta de crédito</option>
              </select>
            </div>

            <div class="g-field">
              <label>Persona</label>
              <select id="gStatementPerson"></select>
            </div>

            <div class="g-field">
              <label>Nombre de la tarjeta</label>
              <input id="gStatementCardName" type="text" value="HSBC 2Now" placeholder="Se actualizará al detectar la tarjeta">
            </div>
          </div>

          <label class="g-statement-drop" for="gStatementFile">
            <span style="font-size:24px;line-height:1;margin-bottom:7px">PDF</span>
            <strong>Seleccionar estado de cuenta</strong>
            <small id="gStatementFileName">Haz clic aquí para elegir un archivo PDF</small>
            <input id="gStatementFile" type="file" accept="application/pdf,.pdf" hidden>
          </label>

          <div class="g-statement-actions">
            <button class="g-btn g-primary" id="gStatementProcess" type="button">Leer estado de cuenta</button>
            <button class="g-btn" id="gStatementToggleOCR" type="button">Ver texto</button>
            <button class="g-btn" id="gStatementClear" type="button">Limpiar</button>
          </div>

          <div class="g-statement-status" id="gStatementStatus">Selecciona un estado de cuenta. La detección es automática.</div>

          <div class="g-statement-extra" id="gStatementRewards" style="display:none"></div>
          <div class="g-statement-extra" id="gStatementFinancing" style="display:none"></div>

          <div class="g-statement-preview" id="gStatementPreview" style="display:none">
            <div class="g-count-row">
              <strong id="gStatementSummary"></strong>
              <button class="g-btn g-primary" id="gStatementImport" type="button">Importar seleccionados</button>
            </div>

            <div class="g-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th></th>
                    <th>Operación</th>
                    <th>Cargo</th>
                    <th>Concepto</th>
                    <th>Tipo</th>
                    <th>Categoría</th>
                    <th>Monto</th>
                  </tr>
                </thead>
                <tbody id="gStatementBody"></tbody>
              </table>
            </div>
          </div>

          <div class="g-statement-debug">
            <textarea id="gStatementOcr" readonly placeholder="Texto OCR detectado"></textarea>
          </div>
        </div>
      </details>
      </div>

      <div class="g-main-pane" id="gHistoryPane" data-gpane="history">
        <div class="g-summary">
          <div class="g-stat"><small>Gasto del mes</small><strong id="gMonthTotal">$0.00</strong></div>
          <div class="g-stat"><small>Fijos</small><strong id="gFixedTotal">$0.00</strong></div>
          <div class="g-stat current"><small>Corrientes</small><strong id="gCurrentTotal">$0.00</strong></div>
          <div class="g-stat"><small>Manutención</small><strong id="gMaintenanceTotal">$0.00</strong></div>
        </div>

        <div class="g-history-toolbar">
          <div class="g-tabs">
            <button class="g-tab" data-gtype="fijo">Fijos</button>
            <button class="g-tab" data-gtype="corriente">Corrientes</button>
            <button class="g-tab" data-gtype="manutencion">Manutención</button>
            <button class="g-tab active" id="gAllTab" data-gtype="todos">Todos</button>
          </div>
        </div>

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
  const statementPerson=document.getElementById('gStatementPerson');
  if(statementPerson){
    const oldStatement=statementPerson.value;
    statementPerson.innerHTML=(family?'':'<option value="">Selecciona persona</option>')+
      people.map(p=>`<option value="${esc(p)}">${esc(personLabel(p))}</option>`).join('');
    if(oldStatement&&people.includes(oldStatement))statementPerson.value=oldStatement;
    else if(selected&&people.includes(selected))statementPerson.value=selected;
    else if(family&&people.length)statementPerson.value=people[0];
  }

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
  gastoFormType=type;
  const typeSel=document.getElementById('gType');
  if(typeSel)typeSel.value=type;
  fillCategories(type,preserveCategory?document.getElementById('gCategory')?.value:'');
  const title=document.getElementById('gFormTitle');
  if(title)title.textContent=`Registrar gasto ${type==='manutencion'?'de manutención':type}`;
}

function switchGastoMainView(view){
  gastoMainView=view==='history'?'history':'capture';
  document.querySelectorAll('#gastos [data-gmain]').forEach(btn=>{
    btn.classList.toggle('active',btn.dataset.gmain===gastoMainView);
  });
  document.querySelectorAll('#gastos [data-gpane]').forEach(pane=>{
    pane.classList.toggle('active',pane.dataset.gpane===gastoMainView);
  });
  if(gastoMainView==='history')renderHistory();
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
  setFormType(gastoFormType);
  document.getElementById('gDate').value=today();
  updatePaymentUI();
  const payDetails=document.getElementById('gPaymentDetails');
  if(payDetails)payDetails.open=false;
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
  switchGastoMainView('capture');
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
  const payDetails=document.getElementById('gPaymentDetails');
  if(payDetails)payDetails.open=true;
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
      const hay=norm([personLabel(x.person),x.category,x.description,x.originalDescription,x.paymentMethod,x.creditCard,x.account,x.note].join(' '));
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
      <td><strong>${esc(x.description)}</strong>${x.originalDescription?`<br><small class="g-original-desc">${esc(x.originalDescription)}</small>`:''}${x.account?`<br><small>${esc(x.account)}</small>`:''}</td>
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
  document.getElementById('gStatementFile')?.addEventListener('change',e=>{
    statementPdfFile=e.target.files?.[0]||null;
    const label=document.getElementById('gStatementFileName');
    if(label)label.textContent=statementPdfFile?`${statementPdfFile.name} · ${(statementPdfFile.size/1024).toFixed(0)} KB`:'Ningún archivo seleccionado';
    statementMovements=[];statementFinancing=[];statementRewards=null;statementDetectedProfile='';
    document.getElementById('gStatementPreview').style.display='none';
    const rw=document.getElementById('gStatementRewards');if(rw)rw.style.display='none';
    const fn=document.getElementById('gStatementFinancing');if(fn)fn.style.display='none';
    setStatementStatus(statementPdfFile?'PDF listo. Detectaré banco y producto al leerlo.':'Selecciona un estado de cuenta.');
  });
  document.getElementById('gStatementProfile')?.addEventListener('change',e=>{statementProfile=e.target.value;statementDetectedProfile='';if(statementProfile!=='auto'){const n=document.getElementById('gStatementCardName');if(n)n.value=profileCardName(statementProfile)}});
  document.getElementById('gStatementProcess')?.addEventListener('click',processStatement);
  document.getElementById('gStatementImport')?.addEventListener('click',importSelectedStatementMovements);
  document.getElementById('gStatementClear')?.addEventListener('click',clearStatementReader);
  document.getElementById('gStatementToggleOCR')?.addEventListener('click',()=>{
    const wrap=document.getElementById('gStatementOcr')?.closest('.g-statement-debug');
    if(!wrap)return;
    wrap.style.display=wrap.style.display==='block'?'none':'block';
  });

  document.querySelectorAll('#gastos [data-gmain]').forEach(btn=>{
    btn.addEventListener('click',()=>switchGastoMainView(btn.dataset.gmain));
  });

  document.getElementById('gType').addEventListener('change',e=>setFormType(e.target.value));
  document.getElementById('gPayment').addEventListener('change',()=>updatePaymentUI());

  document.querySelectorAll('#gastos .g-tab[data-gtype]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const type=btn.dataset.gtype;
      gastoViewType=type;
      document.querySelectorAll('#gastos .g-tab').forEach(x=>x.classList.toggle('active',x===btn));
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
  switchGastoMainView('capture');

  try{
    await openGastosDB();
    await renderAll();
  }catch(err){
    console.error(err);
    alert('No fue posible abrir el almacenamiento local del módulo Gastos.');
  }
}
