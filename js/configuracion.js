const AI_ENDPOINT_STORAGE_KEY='finoFinanza.aiFallbackEndpoint';
const AI_ACCESS_TOKEN_STORAGE_KEY='finoFinanza.aiAccessToken';

function esc(s=''){
  return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function injectConfigStyles(){
  if(document.getElementById('finofinanza-config-styles'))return;
  const style=document.createElement('style');
  style.id='finofinanza-config-styles';
  style.textContent=`
    #configuracion .ff-config-wrap{max-width:900px}
    #configuracion .ff-config-card{background:#fff;border:1px solid #e4e7ec;border-radius:16px;overflow:hidden}
    #configuracion .ff-config-head{padding:18px 20px;border-bottom:1px solid #e4e7ec;display:flex;justify-content:space-between;gap:12px;align-items:center}
    #configuracion .ff-config-head h3{margin:0;font-size:16px}
    #configuracion .ff-config-head p{margin:4px 0 0;color:#667085;font-size:11px}
    #configuracion .ff-config-body{padding:20px}
    #configuracion .ff-config-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
    #configuracion .ff-config-field label{display:block;margin-bottom:6px;font-size:10px;font-weight:800;color:#475467;text-transform:uppercase}
    #configuracion .ff-config-field input{width:100%;border:1px solid #d0d5dd;border-radius:10px;padding:10px 11px;font-size:12px;background:#fff}
    #configuracion .ff-config-password{display:flex;gap:7px}
    #configuracion .ff-config-password input{flex:1;min-width:0}
    #configuracion .ff-config-btn{border:1px solid #d0d5dd;border-radius:9px;background:#fff;color:#344054;padding:8px 11px;font-size:11px;font-weight:800;cursor:pointer}
    #configuracion .ff-config-primary{background:#155eef;border-color:#155eef;color:#fff}
    #configuracion .ff-config-danger{color:#b42318}
    #configuracion .ff-config-actions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:18px}
    #configuracion .ff-config-status{display:flex;align-items:center;gap:8px;font-size:11px;font-weight:800}
    #configuracion .ff-dot{width:9px;height:9px;border-radius:50%;background:#d92d20}
    #configuracion .ff-dot.ok{background:#17b26a}
    #configuracion .ff-config-note{margin-top:14px;padding:11px 12px;background:#f8fafc;border:1px solid #e4e7ec;border-radius:10px;color:#667085;font-size:11px;line-height:1.5}
    @media(max-width:700px){#configuracion .ff-config-grid{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);
}

function currentConfig(){
  return {
    endpoint:localStorage.getItem(AI_ENDPOINT_STORAGE_KEY)||'',
    token:localStorage.getItem(AI_ACCESS_TOKEN_STORAGE_KEY)||''
  };
}

function updateStatus(){
  const {endpoint,token}=currentConfig();
  const ready=Boolean(endpoint&&token);
  const dot=document.getElementById('ffAiStatusDot');
  const text=document.getElementById('ffAiStatusText');
  if(dot)dot.classList.toggle('ok',ready);
  if(text)text.textContent=ready?'IA privada habilitada':'IA privada no configurada';
}

function saveAiConfig(){
  const endpoint=(document.getElementById('ffAiEndpoint')?.value||'').trim();
  const token=(document.getElementById('ffAiToken')?.value||'').trim();

  if(!endpoint || !/^https:\/\//i.test(endpoint)){
    alert('Ingresa una dirección HTTPS válida para el endpoint de IA.');
    return;
  }
  if(!token){
    alert('Ingresa la clave familiar de IA.');
    return;
  }

  localStorage.setItem(AI_ENDPOINT_STORAGE_KEY,endpoint);
  localStorage.setItem(AI_ACCESS_TOKEN_STORAGE_KEY,token);
  updateStatus();

  const btn=document.getElementById('ffSaveAiConfig');
  if(btn){
    const before=btn.textContent;
    btn.textContent='✓ Guardado';
    setTimeout(()=>btn.textContent=before,1200);
  }
}

function clearAiConfig(){
  if(!confirm('¿Quitar el acceso privado a IA de este dispositivo?'))return;
  localStorage.removeItem(AI_ENDPOINT_STORAGE_KEY);
  localStorage.removeItem(AI_ACCESS_TOKEN_STORAGE_KEY);
  const endpoint=document.getElementById('ffAiEndpoint');
  const token=document.getElementById('ffAiToken');
  if(endpoint)endpoint.value='';
  if(token)token.value='';
  updateStatus();
}

export async function initConfiguracion(){
  injectConfigStyles();

  const root=document.getElementById('configuracion');
  if(!root)return;

  const {endpoint,token}=currentConfig();

  root.innerHTML=`
    <div class="topbar">
      <div>
        <h2>Configuración</h2>
        <p>Preferencias y acceso a funciones privadas de FinoFinanza.</p>
      </div>
    </div>

    <div class="ff-config-wrap">
      <section class="ff-config-card">
        <div class="ff-config-head">
          <div>
            <h3>Inteligencia artificial</h3>
            <p>Configura una vez el acceso privado al lector de volantes con IA.</p>
          </div>
          <div class="ff-config-status">
            <span class="ff-dot" id="ffAiStatusDot"></span>
            <span id="ffAiStatusText">—</span>
          </div>
        </div>

        <div class="ff-config-body">
          <div class="ff-config-grid">
            <div class="ff-config-field">
              <label for="ffAiEndpoint">Dirección de acceso</label>
              <input id="ffAiEndpoint" type="url" value="${esc(endpoint)}" placeholder="https://...workers.dev" autocomplete="off">
            </div>

            <div class="ff-config-field">
              <label for="ffAiToken">Clave familiar de IA</label>
              <div class="ff-config-password">
                <input id="ffAiToken" type="password" value="${esc(token)}" placeholder="Clave familiar" autocomplete="off">
                <button class="ff-config-btn" id="ffToggleAiToken" type="button">Mostrar</button>
              </div>
            </div>
          </div>

          <div class="ff-config-note">
            Esta configuración se guarda únicamente en este navegador. La clave de OpenAI no se almacena aquí:
            permanece protegida dentro de Cloudflare. Si compartes FinoFinanza con otros usuarios, ellos no tendrán
            acceso a la IA mientras no tengan configurada la clave familiar.
          </div>

          <div class="ff-config-actions">
            <button class="ff-config-btn ff-config-danger" id="ffClearAiConfig" type="button">Quitar acceso de este dispositivo</button>
            <button class="ff-config-btn ff-config-primary" id="ffSaveAiConfig" type="button">Guardar configuración</button>
          </div>
        </div>
      </section>
    </div>
  `;

  document.getElementById('ffToggleAiToken')?.addEventListener('click',()=>{
    const input=document.getElementById('ffAiToken');
    const btn=document.getElementById('ffToggleAiToken');
    if(!input||!btn)return;
    const showing=input.type==='text';
    input.type=showing?'password':'text';
    btn.textContent=showing?'Mostrar':'Ocultar';
  });

  document.getElementById('ffSaveAiConfig')?.addEventListener('click',saveAiConfig);
  document.getElementById('ffClearAiConfig')?.addEventListener('click',clearAiConfig);

  updateStatus();
}
