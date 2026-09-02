import { initResumen } from './resumen.js';
import { initIngresos } from './ingresos.js';
import { initTiempoExtra } from './tiempo-extra.js';
import { initGastos } from './gastos.js';
import { initDeudas } from './deudas.js';
import { initAhorro } from './ahorro.js';
import { initInversiones } from './inversiones.js';
import { initConfiguracion } from './configuracion.js';

const screens=[...document.querySelectorAll('.screen')];
const navButtons=[...document.querySelectorAll('.nav button')];

export function openScreen(id){
  screens.forEach(s=>s.classList.toggle('active',s.id===id));
  navButtons.forEach(b=>b.classList.toggle('active',b.dataset.screen===id));
  window.scrollTo({top:0,behavior:'smooth'});
}

document.querySelectorAll('[data-open]').forEach(el=>{
  el.addEventListener('click',()=>openScreen(el.dataset.open));
});
navButtons.forEach(btn=>{
  btn.addEventListener('click',()=>openScreen(btn.dataset.screen));
});

initResumen();
initIngresos();
initTiempoExtra();
initGastos();
initDeudas();
initAhorro();
initInversiones();
initConfiguracion();
