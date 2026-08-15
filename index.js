// ============================================================
// IBÉRICA SEGURIDAD - Bot de WhatsApp
// Integración: Woztell (WhatsApp) + Zoho CRM + OpenAI GPT-4o
// ============================================================

require("dotenv").config();
const express = require("express");
const axios = require("axios");
const OpenAI = require("openai");

const app = express();
// Parsear JSON con o sin Content-Type correcto (Woztell puede omitirlo)
app.use(express.json({ type: "*/*" }));
app.use(express.urlencoded({ extended: true }));
app.use('/static', require('express').static(require('path').join(__dirname, 'public')));


const PORT = process.env.PORT || 3000;

// ── Cliente OpenAI ──────────────────────────────────────────
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── ID del asistente de OpenAI ──────────────────────────────

// ── Estado de conversaciones en memoria ────────────────────
// Estructura por cliente: { step, nombre, telefono, direccion, descripcion, thread_id, memberId, channelId }
const conversaciones = {};

// ── Control del bot por cliente ─────────────────────────────
// true = bot activo (por defecto), false = agente humano atiende
const botActivo = {};

// Pausas temporales con caducidad: { "canal_telefono": timestamp_ms }
// (la pausa manual desde el panel sigue siendo indefinida)
const pausaExpira = {};
const PAUSA_TAKEOVER_H = 6; // al detectar a una persona de oficina escribiendo
const PAUSA_AGENTE_H   = 8; // cuando el cliente pide hablar con una persona

function pausarBot(clave, horas, motivo) {
  botActivo[clave] = false;
  pausaExpira[clave] = Date.now() + horas * 3600 * 1000;
  redisSet("iberica:botActivo", botActivo);
  redisSet("iberica:pausaExpira", pausaExpira);
  console.log(`[Pausa] Bot pausado ${horas}h para ${clave} — ${motivo}`);
}

// Últimos mensajes enviados por el propio bot, para distinguir su eco
// OUTBOUND del de una persona de la oficina: { telefono: [{t, ts}] }
const enviosBot = {};
function registrarEnvioBot(telefono, texto) {
  (enviosBot[telefono] = enviosBot[telefono] || []).push({ t: texto, ts: Date.now() });
  if (enviosBot[telefono].length > 25) enviosBot[telefono].shift();
}
function esEnvioDelBot(telefono, texto) {
  const ahora = Date.now();
  return (enviosBot[telefono] || []).some((e) => ahora - e.ts < 10 * 60 * 1000 && e.t === texto);
}

// IDs (wamid) de los mensajes que el propio bot ha enviado, extraídos de la
// respuesta de la API de Woztell. Los mensajes manuales de la oficina no
// generan evento de texto en el webhook, pero sí un acuse SENT con su wamid:
// un acuse cuyo wamid no está aquí = mensaje escrito a mano → auto-takeover.
const wamidsBot = new Map(); // wamid -> ts
function registrarWamidsEnvio(resData) {
  try {
    for (const r of resData?.sendResult?.result || []) {
      const ids = [
        r?.messageEvent?.messageId,
        ...(r?.result?.messages || []).map((m) => m?.id),
      ].filter(Boolean);
      for (const id of ids) wamidsBot.set(id, Date.now());
    }
    if (wamidsBot.size > 500) {
      const limite = Date.now() - 24 * 3600 * 1000;
      for (const [id, ts] of wamidsBot) if (ts < limite) wamidsBot.delete(id);
    }
  } catch (_) { /* nunca romper un envío por el registro */ }
}

// Un mensaje SALIENTE que el bot no envió = una persona de la oficina está
// atendiendo la conversación → pausamos el bot para no pisarla.
function extraerTextoEvento(body) {
  const t = (
    body?.data?.text ||
    body?.data?.message?.text ||
    body?.data?.body ||
    body?.text ||
    // Ecos de coexistencia (formato Meta): data.messages[].text.body
    body?.data?.messages?.[0]?.text?.body ||
    body?.data?.message?.text?.body ||
    (Array.isArray(body?.response) ? body.response.map((r) => r?.text).find(Boolean) : null) ||
    null
  );
  // data.text puede ser objeto ({body: "..."}) según el tipo de evento
  if (t && typeof t === "object") return t.body || null;
  return t;
}
function detectarIntervencionHumana(body) {
  const texto = extraerTextoEvento(body);
  const canal = body?.channel || body?.channelId;
  if (!texto || !canal) return;
  // Buscar al cliente entre varios campos posibles, normalizando el número
  // (Woztell puede mandarlo con +, espacios o prefijos distintos).
  const candidatos = [
    body?.to, body?.from, body?.recipient,
    body?.data?.to, body?.data?.recipient,
    body?.data?.messages?.[0]?.to,   // ecos de coexistencia (formato Meta)
    body?.member,
  ]
    .filter(Boolean)
    .map((t) => String(t));
  const clavesConv = Object.keys(conversaciones);
  let telefono = candidatos.find((t) => conversaciones[t]);
  if (!telefono) {
    const digitos = (s) => String(s).replace(/\D/g, "");
    for (const cand of candidatos) {
      const d = digitos(cand);
      if (!d) continue;
      const hit = clavesConv.find((k) => digitos(k) === d || digitos(k).endsWith(d.slice(-9)));
      if (hit) { telefono = hit; break; }
    }
  }
  if (!telefono) return;                       // no es un cliente conocido
  if (esEnvioDelBot(telefono, texto)) return;  // es el eco de un envío del bot
  const clave = `${canal}_${telefono}`;
  if (botActivo[clave] === false) {
    // Ya pausado: si era pausa temporal, extenderla mientras la persona siga escribiendo
    if (pausaExpira[clave]) {
      pausaExpira[clave] = Date.now() + PAUSA_TAKEOVER_H * 3600 * 1000;
      redisSet("iberica:pausaExpira", pausaExpira);
    }
    return;
  }
  pausarBot(clave, PAUSA_TAKEOVER_H, "intervención humana detectada (mensaje manual de oficina)");
}

// ¿wamid de un mensaje escrito desde la app de WhatsApp Business (modo
// coexistencia)? Los mensajes enviados por la API llevan el número del
// destinatario codificado en el wamid; los escritos a mano desde la app
// llevan un id interno tipo "ES.2075163706548740". Es la única señal que
// Woztell nos da de esos mensajes (no llegan ecos con el texto, y tampoco
// generan acuse SENT — solo DELIVERED y READ).
function esWamidDeApp(wamid) {
  try {
    const dec = Buffer.from(String(wamid).replace(/^wamid\./, ""), "base64").toString("latin1");
    return /[A-Z]{2}\.\d{6,}/.test(dec);
  } catch (_) { return false; }
}

function pausarPorIntervencion(canal, telefono, motivo) {
  const clave = `${canal}_${telefono}`;
  if (botActivo[clave] === false) {
    // Ya pausado: si era pausa temporal, extenderla mientras siga la persona
    if (pausaExpira[clave]) {
      pausaExpira[clave] = Date.now() + PAUSA_TAKEOVER_H * 3600 * 1000;
      redisSet("iberica:pausaExpira", pausaExpira);
    }
    return;
  }
  console.log(`[Takeover] ${motivo} — ${telefono} (canal ${canal})`);
  pausarBot(clave, PAUSA_TAKEOVER_H, motivo);
}

// Acuses de envío (SENT/DELIVERED/READ): llegan para TODO mensaje que sale
// del número de empresa, con from = teléfono del cliente y data.messageId =
// wamid. Si el wamid no lo generó el bot, lo envió una persona.
function manejarAcuseEnvio(body, tipo) {
  const wamid    = body?.data?.messageId || body?.messageId;
  const telefono = body?.from;   // en los acuses, from = cliente
  const canal    = body?.channel;
  if (!wamid || !telefono || !canal) return;
  if (wamidsBot.has(wamid)) return;        // acuse de un envío del propio bot
  if (NOMBRES_AGENTES[telefono]) return;   // notificación interna a un agente

  // Mensaje escrito desde la app del móvil → intervención humana segura
  if (esWamidDeApp(wamid)) {
    if (!conversaciones[telefono]) return; // chat que el bot no atiende
    pausarPorIntervencion(canal, telefono, "respuesta manual desde la app de WhatsApp");
    return;
  }

  // DELIVERED/READ de envíos API con wamid desconocido: pueden ser mensajes
  // del propio bot anteriores a un reinicio (el registro vive en memoria) —
  // no son señal fiable. Solo el acuse SENT desconocido indica un envío
  // API ajeno (p. ej. inbox de Woztell), con margen por si el acuse llega
  // antes que la respuesta HTTP del envío del bot.
  if (tipo !== "SENT") return;
  setTimeout(() => {
    if (wamidsBot.has(wamid)) return;
    if (!conversaciones[telefono]) return;
    pausarPorIntervencion(canal, telefono, "respuesta manual de oficina (acuse SENT ajeno)");
  }, 4000);
}

// ── Registro de actividad por cliente (para el panel admin) ─
// { [telefono]: { ultimoMensaje, ultimaActividad, mensajesTotal } }
const actividad = {};

// ── Nombres conocidos de agentes internos ───────────────────
const NOMBRES_AGENTES = {
  "34664658254": "Isabel",
  "34674163818": "Jose",
  "34674163817": "Mari",
  "34663303461": "Nieves",
};

// ── Canales Woztell → agente ─────────────────────────────────
const CANALES_AGENTES = {
  "69af0932bd6b88aaf5da3887": "Noe",
  "69a6981752ac843492cb9ed5": "Mari",
  "69af0e9ee1c709083b065b8a": "Jose",
  "69bd11ce7614bf4b4d6f2d3c": "Isabel",
  "69c3a0276c369daa9f0bbf81": "Nieves",
  "69fda40ba6876fcf26d5407f": "Soporte",  // Canal oficial 24h (661665929)
};

// ── Horarios de activación del bot por canal ──────────────────
// El bot solo responde automáticamente en las franjas indicadas.
// Sin horario = siempre activo (ej: Noe).
// cruzaMedianoche: true → la franja va de inicio hasta el día siguiente a fin.
const HORARIOS_CANALES = {
  "69a6981752ac843492cb9ed5": [ // Mari: 15:00 → 07:30
    { inicio: 15 * 60, fin: 7 * 60 + 30, cruzaMedianoche: true },
  ],
  "69af0e9ee1c709083b065b8a": [ // Jose: 15:00 → 07:30
    { inicio: 15 * 60, fin: 7 * 60 + 30, cruzaMedianoche: true },
  ],
  "69bd11ce7614bf4b4d6f2d3c": [ // Isabel: 15:00 → 07:30
    { inicio: 15 * 60, fin: 7 * 60 + 30, cruzaMedianoche: true },
  ],
  "69c3a0276c369daa9f0bbf81": [ // Nieves: 14:00-17:00 y 20:00-09:00
    { inicio: 14 * 60, fin: 17 * 60,     cruzaMedianoche: false },
    { inicio: 20 * 60, fin: 9 * 60,      cruzaMedianoche: true  },
  ],
};

/**
 * Devuelve los minutos desde medianoche en la zona horaria de Madrid.
 */
function minutosActualesMadrid() {
  const partes = new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const h = parseInt(partes.find(p => p.type === "hour").value);
  const m = parseInt(partes.find(p => p.type === "minute").value);
  return h * 60 + m;
}

/**
 * Comprueba si el bot debe estar activo ahora para un canal dado.
 * Sin horario configurado → siempre activo.
 */
function dentroDeHorario(channelId) {
  const franjas = HORARIOS_CANALES[channelId];
  if (!franjas) return true; // Sin restricción (Noe)
  const minutos = minutosActualesMadrid();
  return franjas.some(f => {
    if (f.cruzaMedianoche) {
      return minutos >= f.inicio || minutos < f.fin;
    }
    return minutos >= f.inicio && minutos < f.fin;
  });
}

// ============================================================
// NOTIFICACIONES A AGENTES - Configuración
// ============================================================

// Canal de Noe (siempre activo) → desde aquí salen los avisos a Mari y Nieves
const CANAL_NOTIFICACIONES = "69af0932bd6b88aaf5da3887";

// Destinatarios según horario:
//   Mari:    lunes-viernes 07:30–15:00
//   Nieves:  lunes-viernes 17:00–20:00
//   Guardia: resto del tiempo y fines de semana
//
// El memberId es el ID que Woztell asigna al agente en ese canal.
// Se obtiene la primera vez que el agente envíe un mensaje al canal de Noe
// y se guarda como variable de entorno en Railway.
// Cada agente recibe la notificación por su propio canal de Woztell.
// El memberId se obtiene de los logs cuando el agente escribe al bot desde su número.
// Todos los avisos salen desde el canal de Noe (siempre activo).
// El memberId es el del agente cuando escribe desde SU número al canal de Noe.
const NOTIFICACIONES_CONFIG = {
  mari: {
    nombre: "Mari",
    channelId: CANAL_NOTIFICACIONES,         // Canal de Noe
    memberId: "69af09efc4b8eeaf96583f6e",   // ✅ Mari (34674163817) → canal Noe
    telefono: "34674163817",
  },
  nieves: {
    nombre: "Nieves",
    channelId: CANAL_NOTIFICACIONES,         // Canal de Noe
    memberId: "69af09f1eb88709353922dbb",   // ✅ Nieves (34663303461) → canal Noe
    telefono: "34663303461",
  },
  guardia: {
    nombre: "Guardia",
    channelId: CANAL_NOTIFICACIONES,         // Canal de Noe
    memberId: "69af09f1be5f7a26df1c2d32",   // ✅ Guardia (34674891529) → canal Noe
    telefono: "34674891529",
  },
};

// ── Aviso por LLAMADA de voz (ElevenLabs Agents) ─────────────
// Al abrirse un parte, además de la plantilla de WhatsApp se puede avisar
// con una llamada: un agente de voz llama al teléfono de turno y le lee los
// datos del parte. Requiere configurar en Railway:
//   ELEVENLABS_API_KEY   → clave de la cuenta de ElevenLabs
//   ELEVENLABS_AGENT_ID  → id del agente de voz "aviso de partes"
//   ELEVENLABS_PHONE_ID  → id del número de teléfono importado en ElevenLabs
//   ELEVENLABS_PROVIDER  → "twilio" (por defecto) o "sip-trunk"
async function llamarAvisoParte(datos) {
  const { ELEVENLABS_API_KEY, ELEVENLABS_AGENT_ID, ELEVENLABS_PHONE_ID } = process.env;
  if (!ELEVENLABS_API_KEY || !ELEVENLABS_AGENT_ID || !ELEVENLABS_PHONE_ID) {
    console.log("[Aviso-voz] ElevenLabs no configurado — llamada omitida");
    return { ok: false, motivo: "elevenlabs_no_configurado" };
  }
  const dest = determinarDestinatarioNotificacion();
  let nombreDest = dest.nombre;
  let numero     = datos.numeroAviso || dest.telefono;
  // De 15:00 a 17:00 (todos los días, fines de semana incluidos) la llamada
  // de aviso va al fijo de la oficina
  if (!datos.numeroAviso) {
    const min = minutosActualesMadrid();
    if (min >= 15 * 60 && min < 17 * 60) {
      nombreDest = "Oficina";
      numero = "34950088086";
    }
  }
  if (!numero) return { ok: false, motivo: "sin_telefono_de_turno" };
  const proveedor = process.env.ELEVENLABS_PROVIDER === "sip-trunk" ? "sip-trunk" : "twilio";
  try {
    const res = await axios.post(
      `https://api.elevenlabs.io/v1/convai/${proveedor}/outbound-call`,
      {
        agent_id: ELEVENLABS_AGENT_ID,
        agent_phone_number_id: ELEVENLABS_PHONE_ID,
        to_number: "+" + String(numero).replace(/^\+/, ""),
        conversation_initiation_client_data: {
          dynamic_variables: {
            agente:           nombreDest,
            cliente:          datos.nombre      || "no indicado",
            telefono_cliente: datos.telefono    || "no indicado",
            direccion:        datos.direccion   || "no indicada",
            descripcion:      datos.descripcion || "sin descripción",
            ref_parte:        datos.refParte    || "sin referencia",
          },
        },
      },
      { headers: { "xi-api-key": ELEVENLABS_API_KEY }, timeout: 15000 }
    );
    console.log(`[Aviso-voz] ✅ Llamando a ${nombreDest} (${numero}) — parte ${datos.refParte || "—"}`);
    return { ok: true, destinatario: nombreDest, numero };
  } catch (e) {
    console.error("[Aviso-voz] ❌ Falló la llamada:", e.response?.status, JSON.stringify(e.response?.data || e.message).slice(0, 300));
    return { ok: false, motivo: "error_api" };
  }
}

// ── Reseñas de Google: encuesta postventa en el propio chat ──
// Al cerrarse un parte (webhook desde el workflow del CRM), Marta pregunta
// la nota del 0 al 10 en el chat que el cliente ya conoce. 9-10 → enlace
// directo de reseña; 8 o menos → pregunta qué mejorar y avisa al equipo.
const RESENA_URL = "https://g.page/r/CXgW_wAoTj0cEAE/review";
const resenasPedidas = {}; // { telefono: ts de la última petición }

// Localiza la clave del cliente (formato Woztell "34XXXXXXXXX") a partir de
// un teléfono en cualquier formato de Zoho (+34 600..., 600 11 12 22...)
function claveClientePorTelefono(t) {
  const d = String(t || "").replace(/\D/g, "");
  if (d.length < 9) return null;
  const ult9 = d.slice(-9);
  if (conversaciones[`34${ult9}`] || actividad[`34${ult9}`]) return `34${ult9}`;
  for (const k of new Set([...Object.keys(conversaciones), ...Object.keys(actividad)])) {
    if (k.replace(/\D/g, "").endsWith(ult9)) return k;
  }
  return null;
}

// Envía la pregunta de la encuesta como PLANTILLA aprobada (fuera de la
// ventana de 24h el texto libre está prohibido por Meta). El nombre de la
// plantilla se configura en RESENA_TEMPLATE (p. ej. "encuesta_postventa"),
// con una única variable {{1}} = nombre del cliente.
async function enviarPlantillaResena(telefono, nombre) {
  const estado = conversaciones[telefono];
  try {
    const res = await axios.post(
      `https://bot.api.woztell.com/sendResponses?accessToken=${process.env.WOZTELL_TOKEN}`,
      {
        channelId: estado.channelId,
        memberId:  estado.memberId,
        response: [{
          type: "TEMPLATE",
          elementName: process.env.RESENA_TEMPLATE,
          languageCode: "es",
          components: [{ type: "body", parameters: [{ type: "text", text: nombre || "de nuevo" }] }],
        }],
      }
    );
    registrarWamidsEnvio(res.data);
    const ok = res.data?.ok === 1 && res.data?.sendResult?.result?.[0]?.ok !== 0;
    if (!ok) console.error("[Reseñas] ❌ Plantilla rechazada:", JSON.stringify(res.data).slice(0, 300));
    return ok;
  } catch (e) {
    console.error("[Reseñas] ❌ Error enviando plantilla:", e.response?.data || e.message);
    return false;
  }
}

// Deja constancia de la respuesta de la encuesta en el propio parte del CRM
// (Notas del módulo Partes), para no perder la información que daba PERE.
async function crearNotaParte(caseId, contenido) {
  if (!caseId) return;
  try {
    const token = await obtenerTokenZoho();
    await axios.post(
      "https://www.zohoapis.eu/crm/v2/Notes",
      { data: [{ Note_Title: "Encuesta postventa (Marta)", Note_Content: contenido, Parent_Id: caseId, se_module: "Cases" }] },
      { headers: { Authorization: `Zoho-oauthtoken ${token}`, "Content-Type": "application/json" } }
    );
    console.log(`[Reseñas] Respuesta registrada como nota en el parte ${caseId}`);
  } catch (e) {
    console.error("[Reseñas] No se pudo registrar la nota en Zoho:", JSON.stringify(e.response?.data || e.message).slice(0, 200));
  }
}

async function pedirResena({ telefono, nombre, refParte, caseId }) {
  const clave = claveClientePorTelefono(telefono);
  if (!clave) return { ok: false, motivo: "cliente_sin_whatsapp_conocido" };
  const act       = actividad[clave] || {};
  const memberId  = conversaciones[clave]?.memberId  || act.memberId;
  const channelId = conversaciones[clave]?.channelId || act.canalId;
  if (!memberId || !channelId) return { ok: false, motivo: "sin_datos_de_envio" };
  // No interrumpir si una persona de la oficina está atendiendo el chat
  if (botActivo[`${channelId}_${clave}`] === false) {
    return { ok: false, motivo: "conversacion_atendida_por_persona" };
  }
  // No insistir si ya se le pidió hace poco
  if (Date.now() - (resenasPedidas[clave] || 0) < 7 * 24 * 3600 * 1000) {
    return { ok: false, motivo: "ya_pedida_recientemente" };
  }
  // Texto libre solo dentro de la ventana de 24h; fuera, plantilla aprobada
  const fueraDeVentana = !act.ultimaActividad || Date.now() - act.ultimaActividad > 23 * 3600 * 1000;
  if (fueraDeVentana && !process.env.RESENA_TEMPLATE) {
    return { ok: false, motivo: "fuera_de_ventana_24h_y_sin_plantilla_configurada" };
  }

  if (!conversaciones[clave]) resetearConversacion(clave);
  const estado = conversaciones[clave];
  estado.memberId  = memberId;
  estado.channelId = channelId;
  estado.step   = "resena_nps";
  estado.resena = { refParte: refParte || null, caseId: caseId || null, intentos: 0 };

  const nombreCorto = nombre ? String(nombre).trim().split(/\s+/)[0] : null;
  if (fueraDeVentana) {
    const okTpl = await enviarPlantillaResena(clave, nombreCorto);
    if (!okTpl) {
      estado.step = "menu_principal";
      return { ok: false, motivo: "plantilla_fallida" };
    }
  } else {
    const saludo = nombreCorto ? `¡Hola, ${nombreCorto}!` : "¡Hola!";
    await enviarMensaje(
      clave,
      `${saludo} Soy Marta, de Ibérica Seguridad 😊 Me dicen que el trabajo ya está terminado. ¿Qué tal ha quedado todo? Del 0 al 10, ¿qué nota nos pondrías?`
    );
  }
  resenasPedidas[clave] = Date.now();
  redisSet("iberica:resenasPedidas", resenasPedidas);
  console.log(`[Reseñas] Encuesta postventa enviada a ${clave} (parte ${refParte || "—"}, ${fueraDeVentana ? "plantilla" : "chat abierto"})`);
  return { ok: true, telefono: clave, via: fueraDeVentana ? "plantilla" : "chat" };
}

// ── Sondeo de partes cerrados (sin tocar el CRM) ─────────────
// Cada 5 minutos el bot pregunta a Zoho por los últimos partes modificados;
// los que hayan pasado a "Cerrado" en las últimas horas disparan la
// encuesta postventa. Desactivable con RESENAS_AUTO=off en Railway.
const cierresProcesados = {}; // { caseId: ts en que se registró }
let sondeoEnCurso = false;

async function sondearPartesCerrados() {
  if ((process.env.RESENAS_AUTO || "on").toLowerCase() === "off") return { ok: false, motivo: "desactivado_por_RESENAS_AUTO" };
  if (sondeoEnCurso) return { ok: false, motivo: "sondeo_ya_en_curso" };
  sondeoEnCurso = true;
  const resumen = { vistos: 0, cerradosNuevos: 0, encuestas: [], errores: [] };
  try {
    const token = await obtenerTokenZoho();
    const res = await axios.get("https://www.zohoapis.eu/crm/v2/Cases", {
      params: { sort_by: "Modified_Time", sort_order: "desc", per_page: 30 },
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
    });
    const casos = res.data?.data || [];
    resumen.vistos = casos.length;
    const limite = Date.now() - 3 * 3600 * 1000; // solo cierres de las últimas 3h
    // Misma condición que la regla "Encueste pere" del CRM: solo trabajo
    // terminado de verdad (no cierres por anulación u otros subestados).
    const SUBESTADOS_ENCUESTA = ["Acabado", "Solucionado"];
    for (const caso of casos) {
      if (caso.Status !== "Cerrado") continue;
      if (!SUBESTADOS_ENCUESTA.includes(caso.Subestado)) continue;
      if (cierresProcesados[caso.id]) continue;
      cierresProcesados[caso.id] = Date.now();
      const modificado = new Date(caso.Modified_Time || 0).getTime();
      if (!modificado || modificado < limite) continue; // cierre antiguo: registrar sin escribir
      resumen.cerradosNuevos++;
      // Teléfono y nombre del contacto vinculado al parte
      let telefonoCli = null;
      let nombreCli   = caso.Related_To?.name || null;
      try {
        if (caso.Related_To?.id) {
          const c = await axios.get(`https://www.zohoapis.eu/crm/v2/Contacts/${caso.Related_To.id}`, {
            headers: { Authorization: `Zoho-oauthtoken ${token}` },
          });
          const contacto = c.data?.data?.[0] || {};
          telefonoCli = contacto.Mobile || contacto.Phone || null;
          nombreCli   = contacto.First_Name || contacto.Full_Name || nombreCli;
        }
      } catch (e) { resumen.errores.push(`contacto de ${caso.ref_Parte || caso.id}: ${e.message}`); }
      if (!telefonoCli) {
        resumen.encuestas.push({ parte: caso.ref_Parte || caso.id, resultado: "sin_telefono_en_zoho" });
        continue;
      }
      const r = await pedirResena({ telefono: telefonoCli, nombre: nombreCli, refParte: caso.ref_Parte, caseId: caso.id });
      resumen.encuestas.push({ parte: caso.ref_Parte || caso.id, resultado: r.ok ? `enviada_por_${r.via}` : r.motivo });
    }
    // Olvidar registros de más de 30 días y persistir
    const caduca = Date.now() - 30 * 24 * 3600 * 1000;
    for (const [id, ts] of Object.entries(cierresProcesados)) if (ts < caduca) delete cierresProcesados[id];
    redisSet("iberica:cierresProcesados", cierresProcesados);
    if (resumen.cerradosNuevos > 0) console.log("[Reseñas] Sondeo:", JSON.stringify(resumen));
    return { ok: true, ...resumen };
  } catch (e) {
    console.error("[Reseñas] Sondeo falló:", e.response?.status || "", e.message);
    return { ok: false, motivo: `error: ${e.message}` };
  } finally {
    sondeoEnCurso = false;
  }
}

/**
 * Devuelve el destinatario correcto de la notificación según el día y la hora.
 * - Lunes-Viernes 07:30-15:00 → Mari
 * - Lunes-Viernes 17:00-20:00 → Nieves
 * - Resto (noche/madrugada) y fines de semana → Guardia
 */
function determinarDestinatarioNotificacion() {
  const ahora = new Date();
  const diaSemana = new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid",
    weekday: "long",
  }).format(ahora).toLowerCase();

  const esFinDeSemana = ["sábado", "domingo"].includes(diaSemana);
  if (esFinDeSemana) return NOTIFICACIONES_CONFIG.guardia;

  const min = minutosActualesMadrid();
  const MARI_INI   = 7 * 60 + 30;  // 07:30
  const MARI_FIN   = 15 * 60;      // 15:00
  const NIEVES_INI = 17 * 60;      // 17:00
  const NIEVES_FIN = 20 * 60;      // 20:00

  if (min >= MARI_INI   && min < MARI_FIN)   return NOTIFICACIONES_CONFIG.mari;
  if (min >= NIEVES_INI && min < NIEVES_FIN) return NOTIFICACIONES_CONFIG.nieves;
  return NOTIFICACIONES_CONFIG.guardia;
}

/**
 * Envía una notificación de parte a un agente usando la plantilla aprobada
 * "nuevo_parte_urgencia" de WhatsApp. Funciona aunque hayan pasado más de
 * 24h desde el último mensaje del agente (no tiene restricción de sesión).
 *
 * @param {object} destinatario - { nombre, channelId, memberId }
 * @param {object} datos - { nombre, telefono, direccion, descripcion, apertura, refParte, agente }
 */
async function enviarNotificacionAgente(destinatario, datos) {
  if (!destinatario.memberId) {
    console.warn(`[Notificación] ⚠️ Sin memberId para ${destinatario.nombre}`);
    return;
  }
  const body = {
    channelId: destinatario.channelId,
    memberId:  destinatario.memberId,
    response: [{
      type: "TEMPLATE",
      elementName: "nuevo_parte_urgencia",
      languageCode: "es",
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: datos.nombre      },
            { type: "text", text: datos.telefono    },
            { type: "text", text: datos.direccion   },
            { type: "text", text: datos.descripcion },
            { type: "text", text: datos.apertura    },
            { type: "text", text: datos.refParte    },
            { type: "text", text: datos.agente      },
          ],
        },
      ],
    }],
  };
  const enviar = async (payload) => axios.post(
    `https://bot.api.woztell.com/sendResponses?accessToken=${process.env.WOZTELL_TOKEN}`,
    payload
  );

  try {
    const res = await enviar(body);
    registrarWamidsEnvio(res.data);
    const sendResult = res.data?.sendResult?.result?.[0];
    const templateOk = sendResult?.ok !== 0;

    console.log(`[Notificación] Woztell response:`, JSON.stringify(res.data));

    if (res.data?.ok === 1 && templateOk) {
      console.log(`[Notificación] ✅ Plantilla enviada a ${destinatario.nombre}`);
      return;
    }

    // Plantilla no soportada por este endpoint — fallback a texto normal
    console.warn(`[Notificación] ⚠️ Plantilla rechazada (code ${sendResult?.error?.code}), usando texto plano como fallback`);
    const textoFallback =
      `🔔 *Nuevo parte creado*\n` +
      `👤 Cliente: ${datos.nombre}\n` +
      `📞 Teléfono: ${datos.telefono}\n` +
      `📍 Dirección: ${datos.direccion}\n` +
      `📝 Descripción: ${datos.descripcion}\n` +
      `🕐 Apertura: ${datos.apertura}\n` +
      `📋 Ref. Parte: ${datos.refParte}\n` +
      `📲 Canal: ${datos.agente}`;

    const bodyTexto = {
      channelId: destinatario.channelId,
      memberId:  destinatario.memberId,
      response:  [{ type: "TEXT", text: textoFallback }],
    };
    const res2 = await enviar(bodyTexto);
    registrarWamidsEnvio(res2.data);
    if (res2.data?.ok === 1) {
      console.log(`[Notificación] ✅ Texto plano enviado a ${destinatario.nombre}`);
    } else {
      console.error(`[Notificación] ❌ Fallback también falló:`, JSON.stringify(res2.data));
    }
  } catch (err) {
    console.error(`[Notificación] ❌ Error enviando a ${destinatario.nombre}:`, err.response?.data || err.message);
  }
}

// ── Token de Zoho en memoria ────────────────────────────────
let zohoAccessToken = null;
let zohoTokenExpira = 0; // timestamp en ms cuando expira

// ============================================================
// UPSTASH REDIS - Persistencia de estado
// ============================================================

async function redisGet(key) {
  if (!process.env.UPSTASH_REDIS_REST_URL) return null;
  try {
    const res = await axios.post(process.env.UPSTASH_REDIS_REST_URL, ["GET", key], {
      headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` },
    });
    const val = res.data.result;
    return val ? JSON.parse(val) : null;
  } catch (err) {
    console.error(`[Redis] Error GET ${key}:`, err.message);
    return null;
  }
}

async function redisSet(key, value) {
  if (!process.env.UPSTASH_REDIS_REST_URL) return;
  try {
    await axios.post(process.env.UPSTASH_REDIS_REST_URL, ["SET", key, JSON.stringify(value)], {
      headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` },
    });
  } catch (err) {
    console.error(`[Redis] Error SET ${key}:`, err.message);
  }
}

async function cargarEstadoDesdeRedis() {
  const [botActivoGuardado, actividadGuardada, pausasGuardadas, resenasGuardadas, cierresGuardados] = await Promise.all([
    redisGet("iberica:botActivo"),
    redisGet("iberica:actividad"),
    redisGet("iberica:pausaExpira"),
    redisGet("iberica:resenasPedidas"),
    redisGet("iberica:cierresProcesados"),
  ]);
  if (botActivoGuardado) Object.assign(botActivo, botActivoGuardado);
  if (actividadGuardada) Object.assign(actividad, actividadGuardada);
  if (pausasGuardadas) Object.assign(pausaExpira, pausasGuardadas);
  if (resenasGuardadas) Object.assign(resenasPedidas, resenasGuardadas);
  if (cierresGuardados) Object.assign(cierresProcesados, cierresGuardados);
  console.log(`[Redis] Estado cargado — ${Object.keys(actividad).length} contactos, ${Object.keys(botActivo).length} estados de bot`);
}

// ============================================================
// ZOHO CRM - Gestión de tokens
// ============================================================

/**
 * Renueva el access token de Zoho usando el refresh token permanente.
 * El access token dura 1 hora; lo guardamos en memoria.
 */
async function renovarTokenZoho() {
  const refreshToken = process.env.ZOHO_REFRESH_TOKEN;
  console.log("[Zoho] Renovando access token...");
  console.log("[Zoho] REFRESH_TOKEN (primeros 30 chars):", refreshToken?.slice(0, 30));
  console.log("[Zoho] CLIENT_ID:", process.env.ZOHO_CLIENT_ID);

  try {
    const res = await axios.post("https://accounts.zoho.eu/oauth/v2/token", null, {
      params: {
        refresh_token: refreshToken,
        client_id: process.env.ZOHO_CLIENT_ID,
        client_secret: process.env.ZOHO_CLIENT_SECRET,
        redirect_uri: process.env.ZOHO_REDIRECT_URI,
        grant_type: "refresh_token",
      },
    });

    console.log("[Zoho] Respuesta renovación HTTP:", res.status);
    console.log("[Zoho] Respuesta renovación body:", JSON.stringify(res.data));

    if (res.data.error) {
      console.error("[Zoho] Error en respuesta de renovación:", res.data.error);
      throw new Error("Zoho devolvió error: " + res.data.error);
    }

    zohoAccessToken = res.data.access_token;
    zohoTokenExpira = Date.now() + (res.data.expires_in - 60) * 1000;
    console.log("[Zoho] ✅ Access token renovado. Expira en:", res.data.expires_in, "segundos");
    return zohoAccessToken;
  } catch (err) {
    console.error("[Zoho] ❌ Error renovando token — HTTP:", err.response?.status);
    console.error("[Zoho] ❌ Body:", JSON.stringify(err.response?.data));
    console.error("[Zoho] ❌ Message:", err.message);
    throw new Error("No se pudo renovar el token de Zoho");
  }
}

/**
 * Devuelve un access token válido, renovándolo si es necesario.
 */
async function obtenerTokenZoho() {
  if (!zohoAccessToken || Date.now() >= zohoTokenExpira) {
    await renovarTokenZoho();
  }
  return zohoAccessToken;
}

// ============================================================
// ZOHO CRM - Operaciones sobre Cases (Partes)
// ============================================================

/**
 * Busca un contacto en Zoho por teléfono (9 dígitos).
 * Si existe → devuelve su ID. Si no existe → lo crea y devuelve el nuevo ID.
 * @param {object} datos - { nombre, telefono (9 dígitos), direccion }
 * @returns {string} - ID del contacto en Zoho
 */
async function buscarOCrearContactoZoho(datos) {
  const token = await obtenerTokenZoho();
  const tel9 = datos.telefono.slice(-9);

  // 1. Buscar contacto existente por Phone o Mobile
  for (const campo of ["Phone", "Mobile"]) {
    try {
      const res = await axios.get("https://www.zohoapis.eu/crm/v2/Contacts/search", {
        params: { criteria: `(${campo}:equals:${tel9})` },
        headers: { Authorization: `Zoho-oauthtoken ${token}` },
      });
      if (res.data.data?.length > 0) {
        const contacto = res.data.data[0];
        console.log(`[Zoho] Contacto existente encontrado: ${contacto.id} (${contacto.Full_Name})`);
        return contacto.id;
      }
    } catch (e) {
      if (e.response?.status !== 204) throw e;
    }
  }

  // 2. Crear contacto nuevo
  console.log(`[Zoho] Contacto no encontrado — creando nuevo para ${datos.nombre} (${tel9})`);
  const bodyContacto = {
    data: [{
      Last_Name: datos.nombre,
      Phone: tel9,
      Mobile: tel9,
      Mailing_Street: datos.direccion,
    }],
  };

  const res = await axios.post(
    "https://www.zohoapis.eu/crm/v2/Contacts",
    bodyContacto,
    { headers: { Authorization: `Zoho-oauthtoken ${token}`, "Content-Type": "application/json" } }
  );

  const contactoNuevo = res.data.data?.[0];
  if (!contactoNuevo || contactoNuevo.code !== "SUCCESS") {
    console.error("[Zoho] ❌ No se pudo crear el contacto:", JSON.stringify(contactoNuevo));
    throw new Error(`Zoho rechazó el contacto: ${contactoNuevo?.message || "error desconocido"}`);
  }

  const contactoId = contactoNuevo.details?.id;
  console.log(`[Zoho] ✅ Contacto creado: ${contactoId}`);
  return contactoId;
}

/**
 * Crea un parte (Case) en Zoho CRM.
 * @param {object} datos - { nombre, telefono, direccion, descripcion, agente }
 * @returns {{ id: string, refParte: string }}
 */
async function crearParteZoho(datos) {
  const token = await obtenerTokenZoho();

  // 1. Buscar o crear el contacto en Zoho
  const contactoId = await buscarOCrearContactoZoho(datos);

  // 2. Preparar fechas en hora de Madrid
  const ahora = new Date();
  const unHoraDespues = new Date(ahora.getTime() + 60 * 60 * 1000);

  const formatFechaZoho = (date) => {
    const p = new Intl.DateTimeFormat("es-ES", {
      timeZone: "Europe/Madrid",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false,
    }).formatToParts(date);
    const g = (type) => p.find(x => x.type === type).value;
    return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}:${g("second")}`;
  };

  const tel9 = datos.telefono.slice(-9);
  const agente = datos.agente || "Bot";
  const asunto = `Urgencia - ${datos.nombre} - ${ahora.toLocaleDateString("es-ES")}`;
  const descripcionCompleta = `${datos.descripcion}\n\n📲 Canal: ${agente}`;

  const body = {
    data: [{
      Subject:          asunto,
      Description:      descripcionCompleta,
      Phone:            tel9,
      Direccion:        datos.direccion,
      Status:           "Open",
      Priority:         "Urgencia",
      Fecha_Hora_Inicio: formatFechaZoho(ahora),
      Fecha_Hora_Final:  formatFechaZoho(unHoraDespues),
      Related_To:       { id: contactoId },
    }],
  };

  console.log("[Zoho] Creando parte con body:", JSON.stringify(body));

  try {
    const res = await axios.post(
      "https://www.zohoapis.eu/crm/v2/Cases",
      body,
      { headers: { Authorization: `Zoho-oauthtoken ${token}`, "Content-Type": "application/json" } }
    );

    console.log(`[Zoho] HTTP ${res.status} | Response:`, JSON.stringify(res.data));

    const parte = res.data.data?.[0];

    if (!parte || parte.status === "error" || parte.code !== "SUCCESS") {
      console.error(`[Zoho] ❌ Creación rechazada: code=${parte?.code} message=${parte?.message}`);
      console.error(`[Zoho] ❌ Detalles:`, JSON.stringify(parte?.details));
      throw new Error(`Zoho rechazó el parte: ${parte?.message || "error desconocido"} (${parte?.code})`);
    }

    const id = parte?.details?.id || parte?.id;
    console.log(`[Zoho] ✅ Parte creado con ID interno: ${id}`);

    // 3. Obtener la Ref. Parte (campo auto-asignado por Zoho, no viene en la respuesta de creación)
    let refParte = "N/D";
    try {
      const detalle = await axios.get(
        `https://www.zohoapis.eu/crm/v2/Cases/${id}`,
        { headers: { Authorization: `Zoho-oauthtoken ${token}` } }
      );
      refParte = detalle.data.data?.[0]?.ref_Parte || "N/D";
      console.log(`[Zoho] ✅ Ref. Parte: ${refParte}`);
    } catch (e) {
      console.warn("[Zoho] No se pudo obtener ref_Parte tras creación:", e.message);
    }

    return { id, refParte };
  } catch (err) {
    console.error("[Zoho] ❌ HTTP status:", err.response?.status);
    console.error("[Zoho] ❌ Response body:", JSON.stringify(err.response?.data));
    console.error("[Zoho] ❌ Message:", err.message);
    throw new Error("Error al crear el parte en Zoho");
  }
}

/**
 * Consulta el estado de un parte en Zoho CRM por ref_Parte (ej: "2026-9866").
 * @param {string} numeroParte - Referencia del parte
 * @returns {object|null} - Datos del parte o null si no se encuentra
 */
async function consultarParteZoho(numeroParte) {
  const token = await obtenerTokenZoho();

  try {
    const res = await axios.get(
      "https://www.zohoapis.eu/crm/v2/Cases/search",
      {
        params: {
          criteria: `(ref_Parte:equals:${numeroParte})`,
        },
        headers: {
          Authorization: `Zoho-oauthtoken ${token}`,
        },
      }
    );

    const casos = res.data.data;
    if (!casos || casos.length === 0) return null;
    return casos[0];
  } catch (err) {
    if (err.response?.status === 204) return null;
    console.error("[Zoho] Error consultando parte:", err.response?.data || err.message);
    throw new Error("Error al consultar el parte en Zoho");
  }
}

const ESTADOS_CERRADOS = ["Cerrado", "Facturado", "Solucionado", "Acabado", "Resuelto", "Closed"];

/**
 * Busca todos los partes de un cliente buscando primero su Contacto en Zoho
 * (por Phone o Mobile) y luego obteniendo los Cases relacionados.
 * Devuelve los partes ordenados: activos primero, luego por Fecha_Hora_Inicio desc.
 * @param {string} telefono - Número en formato Woztell (ej: "34633765620")
 * @returns {Array}
 */
async function consultarPartesPorContacto(telefono) {
  const token = await obtenerTokenZoho();
  const tel9 = telefono.slice(-9);

  // 1. Buscar contacto por Phone o Mobile
  let contactoId = null;
  for (const campo of ["Phone", "Mobile"]) {
    try {
      const res = await axios.get("https://www.zohoapis.eu/crm/v2/Contacts/search", {
        params: { criteria: `(${campo}:equals:${tel9})` },
        headers: { Authorization: `Zoho-oauthtoken ${token}` },
      });
      if (res.data.data?.length > 0) {
        contactoId = res.data.data[0].id;
        break;
      }
    } catch (e) {
      if (e.response?.status !== 204) throw e;
    }
  }

  if (!contactoId) return [];

  // 2. Obtener partes relacionados con ese contacto
  try {
    const res = await axios.get(
      `https://www.zohoapis.eu/crm/v2/Contacts/${contactoId}/Cases`,
      { headers: { Authorization: `Zoho-oauthtoken ${token}` } }
    );
    const casos = res.data.data || [];

    casos.sort((a, b) => {
      const activo = (s) => !ESTADOS_CERRADOS.includes(s);
      if (activo(a.Status) && !activo(b.Status)) return -1;
      if (!activo(a.Status) && activo(b.Status)) return 1;
      return new Date(b.Fecha_Hora_Inicio || b.Created_Time) - new Date(a.Fecha_Hora_Inicio || a.Created_Time);
    });

    return casos;
  } catch (err) {
    if (err.response?.status === 204) return [];
    console.error("[Zoho] Error obteniendo partes del contacto:", err.response?.data || err.message);
    throw new Error("Error al consultar los partes en Zoho");
  }
}

/**
 * Usa OpenAI para generar una respuesta amigable sobre el estado de un parte,
 * interpretando los campos más relevantes del Case de Zoho.
 * @param {object} caso - Objeto Case devuelto por Zoho CRM
 * @returns {string} - Mensaje natural para enviar al cliente
 */
async function interpretarParteConIA(caso) {
  const formatFecha = (iso) => {
    if (!iso) return "no especificada";
    const d = new Date(iso);
    return d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" }) +
      " a las " + d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  };

  const datosParte = {
    referencia: caso.ref_Parte || "N/D",
    asunto: caso.Subject || "N/D",
    estado: caso.Status || "N/D",
    subestado: caso.Subestado || null,
    prioridad: caso.Priority || "N/D",
    operario: caso.Operario || null,
    fechaInicio: formatFecha(caso.Fecha_Hora_Inicio),
    fechaFinal: formatFecha(caso.Fecha_Hora_Final),
    descripcion: caso.Description || null,
    anotaciones: caso.Anotaciones || null,
    solucion: caso.Solution || null,
    comentariosFinales: caso.Comentarios_Finales || null,
  };

  const prompt = `Eres el asistente de atención al cliente de Ibérica Seguridad.
Un cliente pregunta por el estado de su parte de trabajo.
Con los siguientes datos del parte, genera un mensaje claro, amable y profesional en español (máximo 5 líneas) que le explique:
- En qué punto está su parte
- Cuándo está prevista la intervención (si la hay)
- Quién lo va a atender (si hay operario asignado)
- Cualquier información relevante sobre el avance

REGLAS IMPORTANTES:
- Si el estado es "Material" O el subestado es "Material preparado", interpreta SIEMPRE que el parte está pendiente de conseguir el material necesario. Explica que en cuanto esté disponible se contactará para dar cita. NO menciones fechas de intervención en este caso aunque aparezcan, ya que aún no están confirmadas.
- Omite SIEMPRE cualquier comentario interno inapropiado que aparezca en descripción, anotaciones o cualquier otro campo: insultos, expresiones despectivas hacia el cliente, opiniones sobre la dificultad del trabajo, frases del tipo "que se busque la vida", quejas del operario, o cualquier contenido que no sea adecuado comunicar a un cliente.
- NO incluyas datos técnicos internos ni campos vacíos.
- Si hay solución o comentarios finales relevantes y apropiados, menciónalos.
- Usa formato WhatsApp (negrita con *asteriscos*). No uses emojis en exceso.

Datos del parte:
${JSON.stringify(datosParte, null, 2)}`;

  const respuesta = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 300,
  });

  return respuesta.choices[0].message.content.trim();
}

// ============================================================
// WOZTELL - Envío de mensajes
// ============================================================

/**
 * Envía un mensaje de texto al cliente a través de la API de Woztell.
 * Usa el channelId real del webhook entrante (req.body.channel) en lugar
 * del .env, ya que ambos valores pueden diferir.
 * @param {string} telefono - clave del cliente en conversaciones (req.body.from)
 * @param {string} mensaje  - Texto a enviar
 */
async function enviarMensaje(telefono, mensaje) {
  const estado = conversaciones[telefono];
  const memberId  = estado?.memberId;
  // Usar el channelId que llegó en el webhook; el .env es fallback de emergencia
  const channelId = estado?.channelId || process.env.WOZTELL_CHANNEL_ID;

  if (!memberId) {
    console.error(`[Woztell] Sin memberId para ${telefono}, no se puede enviar.`);
    return;
  }

  registrarEnvioBot(telefono, mensaje);

  const body = {
    channelId,
    memberId,   // string: "69df644a0e70e45b41053725"
    response: [{ type: "TEXT", text: mensaje }],
  };

  console.log(`[Woztell] → ${telefono} | channel: ${channelId} | member: ${memberId}`);
  console.log(`[Woztell] Body:`, JSON.stringify(body));

  try {
    const res = await axios.post(
      `https://bot.api.woztell.com/sendResponses?accessToken=${process.env.WOZTELL_TOKEN}`,
      body
    );
    console.log(`[Woztell] HTTP ${res.status} | Response:`, JSON.stringify(res.data));
    registrarWamidsEnvio(res.data);

    if (res.data?.ok === 1) {
      console.log(`[Woztell] ✅ Mensaje enviado correctamente.`);
    } else {
      console.error(`[Woztell] ❌ ok:0 — ${JSON.stringify(res.data)}`);
    }
  } catch (err) {
    console.error(`[Woztell] ❌ Error HTTP ${err.response?.status}:`, JSON.stringify(err.response?.data) || err.message);
  }
}

// ============================================================
// OPENAI - Rama de Servicios
// ============================================================

// (La antigua integración con la Assistants API se retiró: la rama de
// servicios usa ahora Chat Completions — ver responderServicios más abajo.)

// ============================================================
// MENÚ PRINCIPAL
// ============================================================

const MENU_PRINCIPAL =
  "¡Hola! 👋 Bienvenido a *Ibérica Seguridad*.\n" +
  "Estamos aquí para ayudarte. ¿En qué podemos ayudarte hoy?\n\n" +
  "1️⃣ Urgencia / Avería\n" +
  "2️⃣ Solicitar Presupuesto\n" +
  "3️⃣ Información sobre nuestros servicios\n" +
  "4️⃣ Consultar estado de mi expediente/parte\n" +
  "5️⃣ Hablar con un agente\n\n" +
  "Responde con el número de tu opción.";

/**
 * Comprueba si el mensaje del usuario es un comando de vuelta al menú.
 */
/**
 * Valida que el texto sea un número de teléfono español aceptable.
 * Acepta: 9 dígitos (con o sin espacios/guiones), o con prefijo +34 / 0034.
 * Devuelve el teléfono limpio (solo dígitos, sin prefijo) o null si no es válido.
 */
function validarTelefono(texto) {
  const soloDigitos = texto.replace(/[\s\-().+]/g, "");
  // Quitar prefijo internacional si lo trae
  const numero = soloDigitos.startsWith("0034")
    ? soloDigitos.slice(4)
    : soloDigitos.startsWith("34") && soloDigitos.length === 11
    ? soloDigitos.slice(2)
    : soloDigitos;
  // Teléfono español válido: 9 dígitos empezando por 6, 7, 8 o 9
  return /^[6-9]\d{8}$/.test(numero) ? numero : null;
}

function esComandoMenu(texto) {
  const normalized = texto.toLowerCase().trim();
  return ["menu", "menú", "volver", "inicio", "hola"].includes(normalized);
}

/**
 * Inicializa (o resetea) el estado de conversación de un cliente.
 */
function resetearConversacion(telefono) {
  // Preservar thread_id y memberId entre resets para no perder contexto
  const threadAnterior  = conversaciones[telefono]?.thread_id || null;
  const memberAnterior  = conversaciones[telefono]?.memberId  || null;
  const channelAnterior = conversaciones[telefono]?.channelId || null;
  conversaciones[telefono] = {
    step: null,
    nombre: null,
    telefono: null,
    direccion: null,
    descripcion: null,
    thread_id: threadAnterior,
    memberId:  memberAnterior,
    channelId: channelAnterior,
    partesCandidatos: null,
  };
}

// ============================================================
// IA CONVERSACIONAL — "Marta" (Chat Completions con guardarraíles)
// Modos (variable de entorno IA_MODO):
//   "off"    → menú clásico de siempre, sin IA de comprensión.
//   "sombra" → se comporta como siempre, pero clasifica cada mensaje
//              libre y lo registra en /admin/api/ia-log para revisar.
//   "on"     → conversación natural: la IA entiende el mensaje y lo
//              encarrila por los MISMOS 5 flujos de siempre.
// La IA nunca decide acciones ni inventa datos: solo clasifica (salida
// estructurada estricta) o responde sobre la FICHA DE LA EMPRESA.
// ============================================================

const IA_MODO = (process.env.IA_MODO || "sombra").toLowerCase();
const BOT_NOMBRE = process.env.BOT_NOMBRE || "Marta";

// ── Base de conocimiento cerrada: lo ÚNICO que la IA puede afirmar ──
// ⚠️ REVISAR Y COMPLETAR: horarios, zonas y servicios exactos.
const BASE_CONOCIMIENTO = `
EMPRESA: Ibérica Servi & Security S.L. ("Ibérica Seguridad") — seguridad, cerrajería, automatismos y domótica.
UBICACIÓN: C/ San Leonardo 34, 04004 Almería. Trabajamos en Almería y provincia.
CONTACTO: Teléfono 950 088 086 · Email pedidos@ibericaseguridad.com
HORARIO DE OFICINA: Lunes a viernes, 9:00–19:00.
EXPERIENCIA: Más de 20 años en el sector. Fabricación, instalación y asesoramiento propio, sin depender de terceros.

SERVICIOS:
- Cerrajería urgente 24h: aperturas, cambios de cerradura, reparaciones.
- Instalación y venta de cerraduras de seguridad (marcas: Tesa, Ezcurra, Abus, Dierre).
- Cilindros de seguridad y bombines. Cerrojos y cierres de seguridad.
- Puertas de seguridad, acorazadas y blindadas (instaladores oficiales FICHET y KIUSO) y puertas metálicas.
- Automatismos para puertas, garajes y portones.
- Domótica y control de accesos: apertura desde el móvil, sin cuotas y sin complicaciones.
- Cerrajería para empresas y comunidades.
- Presupuestos a medida y sin compromiso, con visita técnica cuando hace falta.
- Instalación de puertas con retirada de la antigua incluida y 3 años de garantía por escrito.
- Financiación disponible: 12 cuotas sin intereses con Cetelem.
`;

// ── Últimos eventos crudos del webhook (GET /admin/api/eventos) ──
const eventosRecientes = [];

// ── Registro de decisiones (visible en GET /admin/api/ia-log) ──
const iaLog = [];
function registrarDecisionIA(entrada) {
  iaLog.unshift({ ts: new Date().toISOString(), modo: IA_MODO, ...entrada });
  if (iaLog.length > 300) iaLog.pop();
  console.log(`[IA] ${entrada.telefono} | "${(entrada.mensaje || "").slice(0, 60)}" → ${entrada.intencion}`);
}

// ── Toques humanos ──
function esperaHumana() {
  return new Promise((r) => setTimeout(r, 700 + Math.random() * 1100));
}
async function enviarNatural(telefono, mensaje) {
  if (IA_MODO === "on") await esperaHumana();
  await enviarMensaje(telefono, mensaje);
}
// Saludos con variaciones: rotan para no sonar a frase enlatada, y no se
// repite el mismo dos veces seguidas con el mismo cliente.
const SALUDOS_INICIALES = [
  `¡Hola! 👋 Soy ${BOT_NOMBRE}, de Ibérica Seguridad. Estoy aquí para ayudarte 😊 ¿Qué necesitas?`,
  `¡Buenas! 😊 Soy ${BOT_NOMBRE}, de Ibérica Seguridad. Cuéntame, ¿en qué te echo una mano?`,
  `¡Hola, hola! Soy ${BOT_NOMBRE}, del equipo de Ibérica Seguridad 👋 Tú dirás, ¿qué necesitas?`,
  `¡Hola! Soy ${BOT_NOMBRE}, de Ibérica Seguridad 😊 ¿En qué puedo ayudarte hoy?`,
];
const SALUDOS_RESPUESTA = [
  `¡Hola! 😊 Soy ${BOT_NOMBRE}, de Ibérica Seguridad. Cuéntame, ¿qué necesitas?`,
  `¡Buenas! 👋 Aquí ${BOT_NOMBRE}, de Ibérica Seguridad. Tú dirás, ¿en qué te ayudo?`,
  `¡Hola! 😊 Soy ${BOT_NOMBRE}, de Ibérica Seguridad. ¿En qué te echo una mano? ¿Alguna avería, un presupuesto...?`,
  `¡Hola! Soy ${BOT_NOMBRE}, de Ibérica Seguridad 😊 Dime, ¿qué necesitas?`,
];
const ultimoSaludoIdx = {}; // { telefono: índice del último saludo usado }
function elegirSaludo(telefono, lista) {
  let idx = Math.floor(Math.random() * lista.length);
  if (lista.length > 1 && ultimoSaludoIdx[telefono] === idx) idx = (idx + 1) % lista.length;
  ultimoSaludoIdx[telefono] = idx;
  return lista[idx];
}
function saludoNatural(telefono) {
  return elegirSaludo(telefono, SALUDOS_INICIALES);
}
async function saludoInicial(telefono) {
  if (IA_MODO === "on") await enviarNatural(telefono, saludoNatural(telefono));
  else await enviarMensaje(telefono, MENU_PRINCIPAL);
}

// ── Clasificador con salida estructurada ESTRICTA ──
// El modelo solo puede rellenar este esquema; no escribe al cliente.
const ESQUEMA_CLASIFICACION = {
  name: "clasificacion_mensaje",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      intencion: {
        type: "string",
        enum: ["urgencia", "presupuesto", "servicios", "expediente", "agente", "saludo", "es_maquina", "no_claro"],
      },
      datos: {
        type: "object",
        additionalProperties: false,
        properties: {
          nombre:      { type: ["string", "null"] },
          telefono:    { type: ["string", "null"] },
          direccion:   { type: ["string", "null"] },
          descripcion: { type: ["string", "null"] },
        },
        required: ["nombre", "telefono", "direccion", "descripcion"],
      },
    },
    required: ["intencion", "datos"],
  },
};

async function clasificarConIA(estado, mensaje) {
  const historial = (estado.historialIA || []).slice(-6);
  try {
    const res = await Promise.race([
      openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0,
        max_tokens: 250,
        messages: [
          {
            role: "system",
            content:
`Clasificas mensajes de clientes de Ibérica Seguridad (empresa de cerrajería y puertas de seguridad en Almería). Devuelve SOLO el JSON del esquema. Significado de cada intención:
- urgencia: avería, cerradura rota o bloqueada, no puede entrar o cerrar su casa, robo, puerta forzada.
- presupuesto: quiere precio o presupuesto de un trabajo, puerta, cerradura u otro producto.
- servicios: pide información general (qué hacéis, horario, zona, garantías, financiación...).
- expediente: pregunta cómo va su parte, reparación, expediente o aviso ya abierto.
- agente: pide expresamente hablar con una persona o que le llamen.
- saludo: solo saluda, se despide o da las gracias, sin petición concreta.
- es_maquina: pregunta si está hablando con un robot, una IA o una persona.
- no_claro: nada de lo anterior encaja con claridad.
En "datos" extrae SOLO lo que el cliente haya dicho literalmente (nombre, teléfono, dirección, descripción del problema); usa null para lo que no haya dicho. No inventes nada.`,
          },
          ...historial,
          { role: "user", content: mensaje },
        ],
        response_format: { type: "json_schema", json_schema: ESQUEMA_CLASIFICACION },
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 9000)),
    ]);
    return JSON.parse(res.choices[0].message.content);
  } catch (err) {
    console.error("[IA] Clasificador falló:", err.message);
    return null;
  }
}

// ── Respuestas de la rama "servicios" con conocimiento cerrado ──
// (sustituye a la antigua Assistants API, en vías de retirada por OpenAI)
async function responderServicios(estado, mensaje, contextoFlujo) {
  estado.historialIA = estado.historialIA || [];
  estado.historialIA.push({ role: "user", content: mensaje });
  estado.historialIA = estado.historialIA.slice(-12);

  const mensajesExtra = contextoFlujo ? [{ role: "system", content: contextoFlujo }] : [];
  const res = await openai.chat.completions.create({
    model: "gpt-4o",
    temperature: 0.4,
    max_tokens: 320,
    messages: [
      {
        role: "system",
        content:
`Eres ${BOT_NOMBRE}, asistente (mujer) del equipo de Ibérica Seguridad (Ibérica Servi & Security S.L., Almería). Atiendes por WhatsApp. Representas a una empresa que no solo soluciona problemas: acompaña. Tu propósito es dar tranquilidad, rapidez y trato cercano.

PERSONALIDAD Y TONO:
- Cercano, cálido y humano: hablas como una persona real, no como un robot.
- Claro y directo: sin tecnicismos innecesarios, sin rodeos, sin letra pequeña.
- Resolutivo y honesto: orientado a soluciones; recomiendas lo que el cliente necesita de verdad, nunca vendes por vender.
- Empático: detrás de cada mensaje hay una preocupación real; trátala como tal.
- Adapta tu registro al del cliente y responde SIEMPRE en el idioma en que te escriba (por defecto, español de España).

FORMATO WHATSAPP:
- Mensajes CORTOS y directos (máximo 3-4 líneas), con saltos de línea para leer bien en móvil.
- NUNCA uses markdown: nada de asteriscos, almohadillas ni listas largas.
- Emojis con moderación y solo cuando aporten calidez (✅ 🔐 👋).

REGLAS INQUEBRANTABLES:
1. Solo puedes afirmar lo que aparece en la FICHA DE LA EMPRESA. Si preguntan algo que no está, dilo con naturalidad ("eso te lo confirma un compañero") y ofrece el teléfono 950 088 086 o pasar con el equipo.
2. PROHIBIDO dar precios, tarifas o cifras en euros: los presupuestos son siempre a medida. Ofrece preparar un presupuesto sin compromiso.
3. PROHIBIDO prometer plazos o fechas que no puedas confirmar.
4. Si preguntan si eres una persona o un robot: di con simpatía que eres la asistente virtual de Ibérica Seguridad, que puedes gestionarlo todo igualmente, y ofrece pasar con una persona si lo prefiere.
5. No inventes NADA. Ante la duda, deriva a un compañero.
6. No hables de otras empresas o competidores, ni de temas ajenos a los servicios de Ibérica Seguridad: reconduce con amabilidad.

FICHA DE LA EMPRESA:
${BASE_CONOCIMIENTO}`,
      },
      ...estado.historialIA,
      ...mensajesExtra,
    ],
  });

  let texto = res.choices[0].message.content.trim();
  // Sin markdown en WhatsApp: fuera asteriscos y almohadillas
  texto = texto.replace(/\*\*/g, "").replace(/\*/g, "").replace(/^#+\s*/gm, "");
  // Guardarraíl extra en código: jamás deben salir cifras en euros
  if (/\d\s*€|\d\s*euros?/i.test(texto)) {
    texto = "Los precios dependen mucho de cada caso, así que no te quiero dar una cifra a ciegas 😊 Si quieres, te preparamos un *presupuesto sin compromiso*: cuéntame qué necesitas y lo ponemos en marcha.";
  }
  estado.historialIA.push({ role: "assistant", content: texto });
  return texto;
}

// ── Encaminar la intención detectada por los flujos de SIEMPRE ──
const PREGUNTA_CAMPO = {
  nombre:      "¿Me dices tu nombre completo, por favor?",
  telefono:    "¿En qué teléfono podemos localizarte?",
  direccion:   "¿En qué dirección está la avería?",
  descripcion: "Cuéntame brevemente qué ha pasado:",
  confirmar:   "¿Es todo correcto? Responde sí o no 😊",
};

// ¿El mensaje parece una pregunta o un desvío, en vez de la respuesta al
// dato pedido? En campos "laxos" (descripción) solo saltan las palabras
// clave, porque una descripción puede llevar interrogantes legítimos.
function pareceDesvio(msg, laxo) {
  const m = msg.toLowerCase();
  const clave = /\b(cu[aá]nto|precio|precios|costar|cuesta|vale|tarifa|robot|m[aá]quina|maquina|humano|persona de verdad|eres real)\b/.test(m);
  if (laxo) return clave;
  return clave || m.includes("?") || m.includes("¿");
}

// Atiende el desvío sin perder el hilo: responde la duda (sin precios ni
// plazos) y retoma la pregunta pendiente. Devuelve true si lo gestionó.
async function desvioAtendido(telefono, estado, msg, campo) {
  if (IA_MODO !== "on") return false;
  const laxo = campo === "descripcion";
  const m = msg.toLowerCase();
  // Cancelación explícita a mitad de flujo
  if (/\b(cancela(r|lo)?|olv[ií]dalo|d[eé]jalo|ya no hace falta|nada ya)\b/.test(m)) {
    resetearConversacion(telefono);
    conversaciones[telefono].step = "menu_principal";
    await enviarNatural(telefono, "Sin problema, lo dejamos aquí 😊 Si necesitas cualquier otra cosa, dime.");
    return true;
  }
  if (!pareceDesvio(msg, laxo)) {
    estado.desviosSeguidos = 0; // respuesta de verdad: se reinicia la cuenta
    return false;
  }
  estado.desviosSeguidos = (estado.desviosSeguidos || 0) + 1;
  const pregunta = PREGUNTA_CAMPO[campo] || "el dato que te había pedido";
  try {
    const contexto =
      `IMPORTANTE: el cliente está en mitad de un registro y la pregunta pendiente es: "${pregunta}". Responde su duda en 1-3 líneas y retoma la pregunta pendiente al final. Además:\n` +
      `- NO repitas frases ni cierres que ya hayas usado en esta conversación: varía la redacción, que suene a persona (mira tus mensajes anteriores).\n` +
      `- PROHIBIDO dar precios o plazos. Si pregunta por el precio, sin cifras: depende de cada caso y el técnico se lo confirma antes de hacer nada, sin compromiso.\n` +
      `- Si ofrece mandar fotos: acéptalas con agrado ("mándala y se la paso al técnico para valorarlo mejor"), aclarando que la cifra se la confirmará el técnico.\n` +
      (estado.desviosSeguidos >= 2
        ? `- El cliente ya ha insistido ${estado.desviosSeguidos} veces: reconócelo con empatía (entiende que quiera saber el precio) y ofrécele pasar con un compañero del equipo si lo prefiere.\n`
        : "");
    const respuesta = await responderServicios(estado, msg, contexto);
    await enviarNatural(telefono, respuesta);
  } catch (e) {
    console.error("[IA] Desvío sin respuesta:", e.message);
    await enviarNatural(telefono, `Buena pregunta 😊 Eso te lo confirma el técnico según el caso, antes de hacer nada y sin compromiso. Seguimos: ${pregunta}`);
  }
  return true; // el dato sigue pendiente; no se guarda la pregunta como respuesta
}

function aplicarDatosExtraidos(estado, datos) {
  if (!datos) return;
  if (datos.nombre && !estado.nombre) estado.nombre = datos.nombre;
  if (datos.telefono && !estado.telefono) {
    const t = validarTelefono(datos.telefono);
    if (t) estado.telefono = t;
  }
  if (datos.direccion && !estado.direccion) estado.direccion = datos.direccion;
  if (datos.descripcion && !estado.descripcion) estado.descripcion = datos.descripcion;
}

async function encaminarIntencion(telefono, estado, msg, c) {
  if (["urgencia", "presupuesto"].includes(c.intencion)) aplicarDatosExtraidos(estado, c.datos);
  const nombrePila = estado.nombre ? `, ${String(estado.nombre).trim().split(/\s+/)[0]}` : "";
  switch (c.intencion) {
    case "urgencia": {
      const faltan = ["nombre", "telefono", "direccion", "descripcion"].filter((f) => !estado[f]);
      if (faltan.length === 0) {
        // Todo extraído del mensaje → confirmación determinista antes de crear nada
        estado.step = "urg_confirmar";
        await enviarNatural(
          telefono,
          `Entendido${nombrePila}, lo registro como *urgencia* ahora mismo. Confírmame los datos:\n\n` +
          `👤 ${estado.nombre}\n📞 ${estado.telefono}\n📍 ${estado.direccion}\n📝 ${estado.descripcion}\n\n` +
          `¿Es todo correcto? (*sí* / *no*)`
        );
      } else {
        estado.step = "urg_" + faltan[0];
        await enviarNatural(
          telefono,
          `Vaya, lamento el problema 😕 Vamos a registrarlo para que un técnico te atienda cuanto antes. ${PREGUNTA_CAMPO[faltan[0]]}`
        );
      }
      return true;
    }
    case "presupuesto": {
      if (estado.nombre && estado.descripcion) {
        await finalizarPresupuesto(telefono, estado);
      } else if (!estado.nombre) {
        estado.step = "pres_nombre";
        await enviarNatural(telefono, `¡Claro que sí! Te preparamos un presupuesto sin compromiso 😊 ${PREGUNTA_CAMPO.nombre}`);
      } else {
        estado.step = "pres_descripcion";
        await enviarNatural(telefono, `Perfecto${nombrePila}. Cuéntame qué necesitas presupuestar:`);
      }
      return true;
    }
    case "servicios": {
      estado.step = "servicios";
      try {
        await enviarNatural(telefono, await responderServicios(estado, msg));
      } catch (err) {
        console.error("[IA] responderServicios falló:", err.message);
        await enviarNatural(telefono, "Ahora mismo no puedo consultar esa información 😔 Escribe *menú* para volver al inicio o llámanos al 950 088 086.");
      }
      return true;
    }
    case "expediente":
      await consultarExpediente(telefono, estado);
      return true;
    case "agente":
      await derivarAAgente(telefono, estado);
      return true;
    case "es_maquina":
      await enviarNatural(
        telefono,
        `Soy ${BOT_NOMBRE}, la asistente virtual de Ibérica Seguridad 😊 Te puedo gestionar urgencias, presupuestos y consultas igual que un compañero de oficina. Y si prefieres hablar con una persona, dímelo y te paso con el equipo.`
      );
      return true;
    case "saludo":
      await enviarNatural(telefono, elegirSaludo(telefono, SALUDOS_RESPUESTA));
      return true;
    default:
      return false;
  }
}

async function finalizarPresupuesto(telefono, estado) {
  estado.step = "pres_ok";
  await enviarMensaje(
    telefono,
    `✅ Hemos recibido tu solicitud de presupuesto.\n\n` +
      `📝 *Descripción:* ${estado.descripcion}\n\n` +
      `Nuestro equipo comercial revisará tu solicitud y se pondrá en contacto contigo a la mayor brevedad. ¡Gracias por confiar en Ibérica Seguridad!`
  );
  resetearConversacion(telefono);
  await enviarMensaje(telefono, "¿Puedo ayudarte en algo más? Escribe *menú* para volver al inicio.");
}

// Deriva la conversación a una persona: avisa al agente de turno y pausa
// el bot para que no pise la conversación (se reactiva solo pasadas unas
// horas, o desde el panel de administración).
async function derivarAAgente(telefono, estado) {
  await enviarNatural(
    telefono,
    "Por supuesto, te paso con un compañero del equipo 😊 Atenderá esta misma conversación en cuanto se libere. ¡Gracias por tu paciencia!"
  );
  try {
    const destinatario = determinarDestinatarioNotificacion();
    const ahoraStr = new Date().toLocaleString("es-ES", { timeZone: "Europe/Madrid", hour12: false });
    await enviarNotificacionAgente(destinatario, {
      nombre:      estado.nombre || `Cliente ${telefono.slice(-9)}`,
      telefono:    telefono.slice(-9),
      direccion:   "—",
      descripcion: "El cliente pide hablar con una persona (conversación del bot).",
      apertura:    ahoraStr,
      refParte:    "—",
      agente:      CANALES_AGENTES[estado.channelId] || "Bot",
    });
  } catch (e) {
    console.error("[Agente] No se pudo notificar al equipo:", e.message);
  }
  if (estado.channelId) {
    pausarBot(`${estado.channelId}_${telefono}`, PAUSA_AGENTE_H, "el cliente pidió hablar con una persona");
  }
  resetearConversacion(telefono);
}

async function crearUrgencia(telefono, estado) {
  await enviarMensaje(telefono, "⏳ Estamos registrando tu urgencia, un momento...");

  try {
    const agente = CANALES_AGENTES[estado.channelId] || "Bot";
    const { id, refParte } = await crearParteZoho({
      nombre:      estado.nombre,
      telefono:    estado.telefono,
      direccion:   estado.direccion,
      descripcion: estado.descripcion,
      agente,
    });

    // Mensaje de confirmación al cliente
    await enviarMensaje(
      telefono,
      `✅ Tu parte de urgencia ha sido registrado correctamente.\n\n` +
      `📋 *Ref. Parte:* ${refParte}\n` +
      `👤 Nombre: ${estado.nombre}\n` +
      `📞 Teléfono: ${estado.telefono}\n` +
      `📍 Dirección: ${estado.direccion}\n\n` +
      `Un técnico se pondrá en contacto contigo lo antes posible. Guarda la referencia del parte para futuras consultas.`
    );

    // Notificación al agente de turno (plantilla aprobada por Meta)
    const destinatario = determinarDestinatarioNotificacion();
    const ahoraStr = new Date().toLocaleString("es-ES", { timeZone: "Europe/Madrid", hour12: false });
    await enviarNotificacionAgente(destinatario, {
      nombre:      estado.nombre,
      telefono:    estado.telefono,
      direccion:   estado.direccion,
      descripcion: estado.descripcion,
      apertura:    ahoraStr,
      refParte:    refParte,
      agente:      agente,
    });

    // Y aviso por llamada de voz al turno que toque (si ElevenLabs está
    // configurado; llamarAvisoParte nunca lanza excepción)
    llamarAvisoParte({
      refParte,
      nombre:      estado.nombre,
      telefono:    estado.telefono,
      direccion:   estado.direccion,
      descripcion: estado.descripcion,
    });

  } catch (err) {
    console.error("[Bot] Error en creación de parte:", err.message);
    await enviarMensaje(
      telefono,
      "Lo sentimos, hubo un problema al registrar tu parte. Por favor, llámanos directamente para atenderte."
    );
  }

  resetearConversacion(telefono);
  await enviarMensaje(telefono, "¿Puedo ayudarte en algo más? Escribe *menú* para volver al inicio.");
}

async function consultarExpediente(telefono, estado) {
      await enviarMensaje(telefono, "🔍 Consultando tus partes...");
      try {
        const partes = await consultarPartesPorContacto(telefono);
        if (partes.length === 0) {
          await enviarMensaje(
            telefono,
            "No hemos encontrado ningún parte asociado a tu número de teléfono.\n\nSi crees que es un error, contacta con nosotros directamente."
          );
          await enviarMensaje(telefono, "¿Puedo ayudarte en algo más? Escribe *menú* para volver al inicio.");
        } else {
          const principal = partes[0];
          estado.partesCandidatos = partes;
          estado.step = "estado_confirmar";
          const activo = !ESTADOS_CERRADOS.includes(principal.Status);
          await enviarMensaje(
            telefono,
            `Hemos encontrado tu parte más reciente${activo ? " en curso" : ""}:\n\n` +
            `📋 *${principal.ref_Parte}* — ${principal.Subject}\n` +
            `🔄 Estado: *${principal.Status}*\n\n` +
            `¿Quieres consultar el estado de este parte? Responde *sí* o *no*.`
          );
        }
      } catch (err) {
        console.error("[Bot] Error consultando partes por teléfono:", err.message);
        await enviarMensaje(telefono, "Ha ocurrido un error al consultar el parte. Por favor, inténtalo más tarde.");
        await enviarMensaje(telefono, "¿Puedo ayudarte en algo más? Escribe *menú* para volver al inicio.");
      }
}

// ============================================================
// PROCESADOR DE MENSAJES - Lógica principal del bot
// ============================================================

/**
 * Procesa el mensaje recibido y gestiona el flujo de la conversación.
 * @param {string} telefono - número del cliente (req.body.from), clave en conversaciones[]
 * @param {string} texto    - Texto del mensaje recibido
 */
async function procesarMensaje(telefono, texto) {
  const msg = texto.trim();
  const msgLower = msg.toLowerCase();

  // Obtener o inicializar estado del cliente
  if (!conversaciones[telefono]) {
    resetearConversacion(telefono);
  }
  const estado = conversaciones[telefono];

  console.log(`[Bot] ${telefono} | step: ${estado.step} | msg: "${msg}"`);

  // ── Comando de vuelta al menú desde cualquier punto ──────
  // "menú"/"volver"/"inicio" muestran SIEMPRE el menú clásico (vía de
  // escape). Con la IA activa, "hola" recibe un saludo natural.
  const esMenuExplicito = ["menu", "menú", "volver", "inicio"].includes(msgLower);
  if (esMenuExplicito || estado.step === null || (IA_MODO !== "on" && esComandoMenu(msgLower))) {
    resetearConversacion(telefono);
    conversaciones[telefono].step = "menu_principal";
    if (IA_MODO === "on" && !esMenuExplicito) {
      await enviarNatural(telefono, saludoNatural(telefono));
    } else {
      await enviarMensaje(telefono, MENU_PRINCIPAL);
    }
    return;
  }

  // ── Encuesta postventa y reseñas de Google ──────────────
  if (estado.step === "resena_nps") {
    const m = msg.match(/\b(10|[0-9])\b/);
    const n = m ? parseInt(m[1]) : null;
    const low = normalizaTxt(msg);
    const positivo = /(genial|perfecto|muy bien|fenomenal|estupendo|excelente|encantad|de lujo|maravilla|todo bien|muy content)/.test(low);
    const negativo = /(mal|fatal|regular|desastre|queja|no .{0,20}(bien|content)|pesimo)/.test(low);
    if ((n !== null && n >= 9) || (n === null && positivo && !negativo)) {
      estado.step = "menu_principal";
      await enviarMensaje(
        telefono,
        "¡Qué alegría leer eso! 🙏 ¿Nos dejarías esa valoración en una reseña de Google? Es solo un minuto y a nosotros nos ayuda muchísimo 👉 " +
        RESENA_URL + "\n\n¡Mil gracias de parte de todo el equipo!"
      );
      crearNotaParte(estado.resena?.caseId, `Nota del cliente: ${n !== null ? n + "/10" : `positiva ("${msg.slice(0, 80)}")`}. Se le envió el enlace de reseña de Google.`);
      return;
    }
    if (n !== null || negativo) {
      estado.step = "resena_feedback";
      estado.resena = estado.resena || {};
      estado.resena.nota = n !== null ? `${n}/10` : `negativa ("${msg.slice(0, 80)}")`;
      await enviarMensaje(telefono, "Muchas gracias por la sinceridad 🙏 ¿Qué podríamos haber hecho mejor? Se lo paso tal cual al equipo.");
      return;
    }
    if ((estado.resena?.intentos || 0) >= 1) {
      estado.step = "menu_principal";
      await enviarMensaje(telefono, "¡Gracias por tu tiempo! 😊 Si necesitas cualquier cosa, aquí estamos.");
      return;
    }
    estado.resena = estado.resena || {};
    estado.resena.intentos = 1;
    await enviarMensaje(telefono, "¿Me lo dices con una nota del 0 al 10? 🙂");
    return;
  }
  if (estado.step === "resena_feedback") {
    estado.step = "menu_principal";
    await enviarMensaje(telefono, "Gracias de verdad — ahora mismo se lo traslado al equipo. 🙏");
    crearNotaParte(estado.resena?.caseId, `Nota del cliente: ${estado.resena?.nota || "baja"}. Qué podríamos mejorar: "${msg.slice(0, 300)}"`);
    try {
      const destinatario = determinarDestinatarioNotificacion();
      const ahoraStr = new Date().toLocaleString("es-ES", { timeZone: "Europe/Madrid", hour12: false });
      await enviarNotificacionAgente(destinatario, {
        nombre:      estado.nombre || `Cliente ${telefono.slice(-9)}`,
        telefono:    telefono.slice(-9),
        direccion:   "—",
        descripcion: `Valoración postventa BAJA (parte ${estado.resena?.refParte || "—"}): "${msg.slice(0, 150)}"`,
        apertura:    ahoraStr,
        refParte:    estado.resena?.refParte || "—",
        agente:      "Postventa",
      });
    } catch (e) { console.error("[Reseñas] No se pudo avisar al equipo:", e.message); }
    return;
  }

  // ── Selección del menú principal ────────────────────────
  if (estado.step === "menu_principal") {
    if (["1", "urgencia", "averia", "avería", "emergencia"].includes(msgLower)) {
      estado.step = "urg_nombre";
      await enviarMensaje(telefono, "¿Cuál es tu nombre completo?");
      return;
    }
    if (["2", "presupuesto", "precio"].includes(msgLower)) {
      estado.step = "pres_nombre";
      await enviarMensaje(telefono, "¿Cuál es tu nombre completo?");
      return;
    }
    if (["3", "servicios", "información", "informacion"].includes(msgLower)) {
      estado.step = "servicios";
      await enviarMensaje(
        telefono,
        IA_MODO === "on"
          ? `¡Claro! 😊 Pregúntame lo que quieras sobre nuestros servicios, garantías u horarios.`
          : "Estoy aquí para informarte sobre nuestros servicios. ¿Qué quieres saber? (Escribe *menú* cuando quieras volver al inicio)"
      );
      return;
    }
    if (["4", "estado", "expediente", "parte"].includes(msgLower)) {
      await consultarExpediente(telefono, estado);
      return;
    }
    if (["5", "agente", "persona", "humano"].includes(msgLower)) {
      await derivarAAgente(telefono, estado);
      return;
    }
    // ── Texto libre ──
    if (IA_MODO === "on") {
      const c = await clasificarConIA(estado, msg);
      registrarDecisionIA({ telefono, mensaje: msg, intencion: c ? c.intencion : "error", datos: c ? c.datos : null });
      if (c && (await encaminarIntencion(telefono, estado, msg, c))) {
        estado.avisadoOpcionInvalida = false;
        return;
      }
      // no_claro (o fallo del clasificador): pedir aclaración; a la segunda, menú clásico
      if (estado.avisadoOpcionInvalida) {
        estado.avisadoOpcionInvalida = false;
        await enviarMensaje(telefono, MENU_PRINCIPAL);
        return;
      }
      estado.avisadoOpcionInvalida = true;
      await enviarNatural(
        telefono,
        "Perdona, no te he entendido bien 😅\nPuedo ayudarte con una urgencia o avería, un presupuesto, información de nuestros servicios o el estado de tu parte. ¿Qué necesitas?"
      );
      return;
    }
    if (IA_MODO === "sombra") {
      // Modo sombra: clasifica y registra en segundo plano, sin cambiar nada
      clasificarConIA(estado, msg)
        .then((c) => registrarDecisionIA({ telefono, mensaje: msg, intencion: c ? c.intencion : "error", datos: c ? c.datos : null }))
        .catch(() => {});
    }
    // Opción no reconocida — avisar solo la primera vez, luego ignorar
    if (estado.avisadoOpcionInvalida) {
      return; // Ya se avisó antes, ignorar silenciosamente
    }
    estado.avisadoOpcionInvalida = true;
    await enviarMensaje(telefono, "No he entendido tu opción. Por favor, responde con un número del 1 al 5.");
    return;
  }

  // ── Confirmación de urgencia con datos extraídos por la IA ──
  if (estado.step === "urg_confirmar") {
    if (!["si", "sí", "s", "vale", "ok", "correcto", "no", "n"].includes(msgLower) &&
        (await desvioAtendido(telefono, estado, msg, "confirmar"))) return;
    if (["si", "sí", "s", "vale", "ok", "correcto"].includes(msgLower)) {
      await crearUrgencia(telefono, estado);
      return;
    }
    if (["no", "n"].includes(msgLower)) {
      resetearConversacion(telefono);
      conversaciones[telefono].step = "menu_principal";
      await enviarNatural(telefono, "Sin problema, empezamos de nuevo 😊 Escríbeme otra vez qué necesitas (o escribe *menú* para ver las opciones).");
      return;
    }
    await enviarMensaje(telefono, "Por favor responde *sí* o *no*.");
    return;
  }

  // ── RAMA 1: URGENCIA / AVERÍA ────────────────────────────
  if (estado.step === "urg_nombre") {
    if (await desvioAtendido(telefono, estado, msg, "nombre")) return;
    estado.nombre = msg;
    estado.step = "urg_telefono";
    await enviarMensaje(telefono, `Gracias, ${estado.nombre}. ¿Cuál es tu número de teléfono de contacto?`);
    return;
  }

  if (estado.step === "urg_telefono") {
    if (await desvioAtendido(telefono, estado, msg, "telefono")) return;
    const telLimpio = validarTelefono(msg);
    if (!telLimpio) {
      await enviarMensaje(
        telefono,
        "⚠️ El número de teléfono no parece correcto.\n\nPor favor, indícame un teléfono español válido de 9 dígitos (ej: *612 345 678*)."
      );
      return;
    }
    estado.telefono = telLimpio;
    estado.step = "urg_direccion";
    await enviarMensaje(telefono, "¿Cuál es la dirección exacta donde se ha producido la avería?");
    return;
  }

  if (estado.step === "urg_direccion") {
    if (await desvioAtendido(telefono, estado, msg, "direccion")) return;
    estado.direccion = msg;
    estado.step = "urg_descripcion";
    await enviarMensaje(telefono, "Describe brevemente el problema o la avería:");
    return;
  }

  if (estado.step === "urg_descripcion") {
    if (await desvioAtendido(telefono, estado, msg, "descripcion")) return;
    estado.descripcion = msg;
    estado.step = "urg_crear";
    await crearUrgencia(telefono, estado);
    return;
  }

  // ── RAMA 2: PRESUPUESTO ──────────────────────────────────
  if (estado.step === "pres_nombre") {
    if (await desvioAtendido(telefono, estado, msg, "nombre")) return;
    estado.nombre = msg;
    estado.step = "pres_descripcion";
    await enviarMensaje(
      telefono,
      `Encantados, ${estado.nombre}. Describe el trabajo o servicio para el que necesitas presupuesto:`
    );
    return;
  }

  if (estado.step === "pres_descripcion") {
    if (await desvioAtendido(telefono, estado, msg, "descripcion")) return;
    estado.descripcion = msg;
    await finalizarPresupuesto(telefono, estado);
    return;
  }

  // ── RAMA 3: SERVICIOS (OpenAI) ───────────────────────────
  if (estado.step === "servicios") {
    // El cliente puede escribir "menú" para volver
    if (msgLower === "menú" || msgLower === "menu") {
      resetearConversacion(telefono);
      await enviarMensaje(telefono, MENU_PRINCIPAL);
      return;
    }

    // Con la IA activa, el cliente puede cambiar de tema sin volver al menú
    if (IA_MODO === "on") {
      const c = await clasificarConIA(estado, msg);
      if (c && ["urgencia", "presupuesto", "expediente", "agente", "es_maquina"].includes(c.intencion)) {
        registrarDecisionIA({ telefono, mensaje: msg, intencion: c.intencion, datos: c.datos });
        if (await encaminarIntencion(telefono, estado, msg, c)) return;
      }
    }

    try {
      const respuestaIA = await responderServicios(estado, msg);
      await enviarNatural(telefono, respuestaIA);
    } catch (err) {
      console.error("[Bot] Error en rama servicios:", err.message);
      await enviarMensaje(
        telefono,
        "Lo siento, en este momento no puedo responder. Escribe *menú* para volver al inicio o contacta con nosotros directamente."
      );
    }
    return;
  }


  // ── RAMA 4: CONFIRMAR PARTE SUGERIDO ────────────────────
  if (estado.step === "estado_confirmar") {
    if (["si", "sí", "s", "yes"].includes(msgLower)) {
      const parte = estado.partesCandidatos[0];
      await enviarMensaje(telefono, "⏳ Analizando tu parte...");
      try {
        const respuestaIA = await interpretarParteConIA(parte);
        await enviarMensaje(telefono, respuestaIA);
      } catch (err) {
        await enviarMensaje(telefono, "Ha ocurrido un error al analizar el parte. Inténtalo más tarde.");
      }
      resetearConversacion(telefono);
      await enviarMensaje(telefono, "¿Puedo ayudarte en algo más? Escribe *menú* para volver al inicio.");
    } else if (["no", "n"].includes(msgLower)) {
      const otros = estado.partesCandidatos.slice(1);
      if (otros.length === 0) {
        await enviarMensaje(telefono, "No hay más partes registrados con tu número de teléfono.");
        resetearConversacion(telefono);
        await enviarMensaje(telefono, "¿Puedo ayudarte en algo más? Escribe *menú* para volver al inicio.");
      } else {
        const lista = otros.map((p, i) =>
          `${i + 1}. *${p.ref_Parte}* — ${p.Subject} (${p.Status})`
        ).join("\n");
        estado.step = "estado_elegir";
        await enviarMensaje(telefono, `Aquí tienes el resto de tus partes:\n\n${lista}\n\nResponde con el número del que quieres consultar.`);
      }
    } else {
      await enviarMensaje(telefono, "Por favor responde *sí* o *no*.");
    }
    return;
  }

  // ── RAMA 4: ELEGIR PARTE DE LA LISTA ────────────────────
  if (estado.step === "estado_elegir") {
    const otros = estado.partesCandidatos.slice(1);
    const idx = parseInt(msg) - 1;
    if (isNaN(idx) || idx < 0 || idx >= otros.length) {
      await enviarMensaje(telefono, `Por favor responde con un número del 1 al ${otros.length}.`);
      return;
    }
    const parte = otros[idx];
    await enviarMensaje(telefono, "⏳ Analizando tu parte...");
    try {
      const respuestaIA = await interpretarParteConIA(parte);
      await enviarMensaje(telefono, respuestaIA);
    } catch (err) {
      await enviarMensaje(telefono, "Ha ocurrido un error al analizar el parte. Inténtalo más tarde.");
    }
    resetearConversacion(telefono);
    await enviarMensaje(telefono, "¿Puedo ayudarte en algo más? Escribe *menú* para volver al inicio.");
    return;
  }

  // ── Fallback: mensaje no reconocido ─────────────────────
  console.warn(`[Bot] Step desconocido o mensaje no manejado. step: ${estado.step}`);
  await enviarMensaje(
    telefono,
    "No he entendido tu mensaje. Escribe *menú* para volver al inicio."
  );
}

// ============================================================
// CAPTACIÓN — Campaña de puertas (módulo aislado)
// Cualifica leads de anuncios (localidad, necesidad, fotos, plazo) y los
// traspasa a una persona. No comparte estado con el flujo de partes/menú.
// ============================================================

// Estado de leads de captación en memoria: { [telefono]: {...} }
const captacionLeads = {};

// La captación SOLO se activa en el canal del número de la campaña (el de los
// anuncios). En cualquier otro número/canal del bot NUNCA se dispara.
// Si no está configurado, la captación queda DESACTIVADA (a prueba de fallos).
const CAMPANA_CHANNEL_ID = process.env.CAMPANA_CHANNEL_ID || null;

// Frase distintiva del mensaje precargado del anuncio/landing (normalizada).
// Un cliente de urgencias NUNCA la escribe → así separamos leads de clientes.
const FRASE_CAMPANA = "campana de puertas";

function normalizaTxt(t) {
  return (t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}
function esInicioCampana(texto) {
  return normalizaTxt(texto).includes(FRASE_CAMPANA);
}
// ── Señales de que un contacto viene del anuncio de puertas de Meta ──
// Referral que WhatsApp adjunta al primer mensaje de un anuncio click-to-WhatsApp
function tieneReferralAnuncio(body) {
  const ref = body?.data?.referral || body?.referral || {};
  return !!(ref.ctwa_clid || ref.source_id || ref.source_type || ref.headline || ref.source_url);
}
function mencionaAnuncio(texto) {
  const n = normalizaTxt(texto);
  return /(vi (tu|el|vuestro|su) anuncio|del anuncio|por el anuncio|en instagram|en facebook|me interesa la puerta)/.test(n);
}
function esTemaPuertas(texto) {
  const n = normalizaTxt(texto);
  return /(puerta (blindada|acorazada|de entrada|de seguridad|nueva)|(cambiar|renovar|poner|sustituir|presupuesto de) (la |mi |una )?puerta|blindar la puerta|acorazad)/.test(n);
}
// ¿Es su primer mensaje de la historia? (actividad persiste en Redis)
function esContactoNuevo(telefono) {
  return (actividad[telefono]?.mensajesTotal || 0) <= 1;
}
// ¿El contacto está dentro del flujo de captación? (con caducidad de 24 h)
function captacionActiva(telefono) {
  const lead = captacionLeads[telefono];
  if (!lead) return false;
  if (Date.now() - (lead.updatedAt || 0) > 24 * 60 * 60 * 1000) {
    delete captacionLeads[telefono];
    return false;
  }
  return true;
}

// Guion de cualificación de leads del anuncio de puertas — versión con guía.
// Primero VALOR (la guía gratis), la guía trabaja, y cuando el lead responde
// se le invita a la foto para la valoración del técnico. Tono útil y
// tranquilizador: nada de humor, nunca insinuar que una puerta se abre
// fácil, nunca precios cerrados (líneas rojas de marca).
const GUIA_URL = "https://iberica22.github.io/Iberica-BOT/guia-cambiar-puerta.pdf";
const CAP = {
  bienvenida:
    "¡Hola! 👋 Soy Marta, de Ibérica Seguridad 🙂\n" +
    "Te dejo una guía rápida y gratis para saber si de verdad te toca cambiar tu puerta — sin compromiso 👉 " + GUIA_URL,
  foto:
    "Si quieres algo a tu medida, mándame una foto de tu puerta y de la cerradura y te la valora un técnico gratis y sin compromiso 📸",
  zona: "¿En qué zona o localidad estás?",
  cierre:
    "Con esto ya lo veo claro. Te paso con un compañero del equipo para concretar y darte una valoración. En breve te escribe. 🔐",
  precio:
    "Te entiendo, pero darte una cifra al aire sería engañarte: depende de las medidas y del modelo.\n" +
    "Si quieres algo a tu medida, mándame una foto de tu puerta y de la cerradura y te la valora un técnico gratis y sin compromiso 📸",
  duda: "Eso te lo concreta el técnico al valorar tu puerta, gratis y sin compromiso 🙂",
  sin_foto: "Sin problema, me la mandas cuando puedas 🙂",
  gracias_foto: "¡Recibida, gracias! 📸",
  pregunta(step) {
    return {
      cap_guia: this.foto,
      cap_foto: this.foto,
      cap_zona: this.zona,
    }[step] || null;
  },
};

// Envía un texto al lead usando su canal/miembro de Woztell (aislado de enviarMensaje)
async function enviarCap(lead, mensaje) {
  try {
    const res = await axios.post(
      `https://bot.api.woztell.com/sendResponses?accessToken=${process.env.WOZTELL_TOKEN}`,
      { channelId: lead.channelId, memberId: lead.memberId, response: [{ type: "TEXT", text: mensaje }] }
    );
    registrarWamidsEnvio(res.data);
    console.log(`[Captación] ✅ → ${lead.telefono}: "${mensaje.slice(0, 50)}..."`);
  } catch (e) {
    console.error(`[Captación] ❌ Envío falló:`, e.response?.data || e.message);
  }
}

// Aviso best-effort al agente de turno de que ha entrado un lead cualificado
async function notificarLeadPuertas(datos) {
  try {
    const dest = determinarDestinatarioNotificacion();
    const texto =
      `🚪 *Nuevo LEAD de puertas (anuncio)*\n` +
      `📞 Teléfono: ${datos.telefono}\n` +
      `📍 Zona: ${datos.zona || "—"}\n` +
      `🎯 Quiere mejorar: ${datos.mejora || "—"}\n` +
      `⏱️ Plazo: ${datos.plazo || "—"}\n` +
      `📷 Fotos: ${datos.fotos ? "sí" : "no"}\n` +
      `📢 Origen: ${datos.origen || "—"}\n\n` +
      `Atiéndelo desde el inbox de Woztell.`;
    const res = await axios.post(
      `https://bot.api.woztell.com/sendResponses?accessToken=${process.env.WOZTELL_TOKEN}`,
      { channelId: dest.channelId, memberId: dest.memberId, response: [{ type: "TEXT", text: texto }] }
    );
    registrarWamidsEnvio(res.data);
    console.log(`[Captación] ✅ Aviso de lead enviado a ${dest.nombre}`);
  } catch (e) {
    console.error(`[Captación] ❌ Aviso de lead falló:`, e.response?.data || e.message);
  }
}

// Cierra el lead: pausa el bot para ese contacto (lo atiende una persona),
// avisa al equipo y limpia el estado de captación.
async function handoffCaptacion(telefono, channelId) {
  const lead = captacionLeads[telefono] || {};
  const datos = {
    telefono,
    zona: lead.zona, mejora: lead.mejora,
    plazo: lead.plazo, fotos: !!lead.fotos, origen: lead.origen,
  };
  console.log(`[Captación] ✅ Lead cualificado:`, JSON.stringify(datos));

  // Pausar el bot para este contacto (mismo mecanismo que el canal Soporte)
  const clave = `${channelId}_${telefono}`;
  botActivo[clave] = false;
  redisSet("iberica:botActivo", botActivo);

  await notificarLeadPuertas(datos);
  delete captacionLeads[telefono];
}

// Máquina de estados de la cualificación (versión con guía):
//   saludo+guía → (el lead responde) → invitación a la foto → foto → zona →
//   cierre derivando al equipo. Respuestas en texto libre, sin menús.
async function manejarCaptacion({ telefono, memberId, channelId, texto, esImagen, req }) {
  let lead = captacionLeads[telefono];

  // Primer contacto (viene del anuncio) → saludo + guía y captura de origen
  if (!lead) {
    console.log(`[Captación] PRIMER CONTACTO — payload:`, JSON.stringify(req.body).slice(0, 600));
    const ref = req.body?.data?.referral || req.body?.referral || {};
    const origen = ref.headline || ref.source_id || ref.ctwa_clid || ref.body || null;
    lead = captacionLeads[telefono] = {
      telefono, step: "cap_guia",
      zona: null, mejora: null, plazo: null, fotos: !!esImagen,
      origen, memberId, channelId, updatedAt: Date.now(),
    };
    await enviarCap(lead, CAP.bienvenida);
    return;
  }

  lead.memberId = memberId;
  lead.channelId = channelId;
  lead.updatedAt = Date.now();

  const msg = (texto || "").trim();
  const low = normalizaTxt(msg);

  // Foto en cualquier momento: agradecer y pasar a la zona
  if (esImagen) {
    lead.fotos = true;
    await enviarCap(lead, CAP.gracias_foto);
    if (lead.step === "cap_guia" || lead.step === "cap_foto") {
      lead.step = "cap_zona";
      await enviarCap(lead, CAP.zona);
    }
    return;
  }
  if (!msg) return;

  // Pide una persona → derivar ya
  if (/(agente|persona|humano|hablar con alguien|que me llam)/.test(low)) {
    await enviarCap(lead, "Claro, te paso con un compañero del equipo que te atiende enseguida 🙂");
    return handoffCaptacion(telefono, channelId);
  }
  // Pregunta por precio → nunca cifras: depende de medidas y modelo, y la
  // respuesta ya invita a la foto (paso exacto de la guía)
  if (/(precio|cuant.* (cuesta|vale|es|sale)|coste|cuesta|presupuesto|euros)/.test(low)) {
    await enviarCap(lead, CAP.precio);
    if (lead.step === "cap_guia") lead.step = "cap_foto";
    else if (lead.step === "cap_zona") await enviarCap(lead, CAP.zona);
    return;
  }
  // Pregunta suelta que no es la respuesta → contestar breve y seguir
  const esPregunta = /\?/.test(msg) || /^¿/.test(msg) || /^(que|cual|como|donde|por que)\s/.test(low);

  switch (lead.step) {
    case "cap_guia": // respondió algo tras recibir la guía → invitar a la foto
      if (esPregunta) await enviarCap(lead, CAP.duda);
      lead.step = "cap_foto";
      await enviarCap(lead, CAP.foto);
      return;

    case "cap_foto": // le hemos pedido la foto y responde con texto
      if (esPregunta) { await enviarCap(lead, CAP.duda); await enviarCap(lead, CAP.foto); return; }
      if (/(no puedo|no tengo|luego|mas tarde|despues|ahora no)/.test(low)) {
        await enviarCap(lead, CAP.sin_foto);
      }
      lead.step = "cap_zona";
      await enviarCap(lead, CAP.zona);
      return;

    case "cap_zona":
      if (esPregunta) { await enviarCap(lead, CAP.duda); await enviarCap(lead, CAP.zona); return; }
      lead.zona = msg;
      await enviarCap(lead, CAP.cierre);
      return handoffCaptacion(telefono, channelId);

    default:
      lead.step = "cap_foto";
      await enviarCap(lead, CAP.foto);
      return;
  }
}

// ============================================================
// ENDPOINTS EXPRESS
// ============================================================

// ── Middleware: Basic Auth para rutas /admin ──────────────────
function authAdmin(req, res, next) {
  const header = req.headers["authorization"] || "";
  const b64 = header.replace("Basic ", "");
  const [user, pass] = Buffer.from(b64, "base64").toString().split(":");
  if (user === "admin" && pass === process.env.ADMIN_PASSWORD) return next();
  res.set("WWW-Authenticate", 'Basic realm="Ibérica Seguridad Admin"');
  res.status(401).send("Acceso restringido");
}

// ── Panel de administración ───────────────────────────────────
app.get("/admin", authAdmin, (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ibérica Seguridad — Panel Bot</title>
  <style>
    :root {
      --navy: #1A5C2B;
      --navy2: #26843D;
      --gold: #747576;
      --gold-bg: rgba(116,117,118,0.10);
      --bg: #F5F7F5;
      --white: #FFFFFF;
      --text: #2A2A2A;
      --muted: #747576;
      --border: #E0E8E2;
      --green: #26843D;
      --shadow: 0 2px 10px rgba(26,92,43,0.09);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; }

    /* ── Header ── */
    header {
      background: var(--navy);
      padding: 0 32px;
      height: 62px;
      display: flex;
      align-items: center;
      gap: 14px;
      position: sticky;
      top: 0;
      z-index: 100;
      box-shadow: 0 2px 16px rgba(0,0,0,0.28);
    }
    .logo-icon { color: var(--gold); flex-shrink: 0; }
    .header-title { color: #fff; font-size: 1rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
    .header-sub { color: rgba(255,255,255,0.35); font-size: 0.75rem; margin-left: 4px; font-weight: 400; text-transform: none; letter-spacing: 0; }
    .header-clock { margin-left: auto; color: rgba(255,255,255,0.45); font-size: 0.82rem; font-variant-numeric: tabular-nums; }

    /* ── Stats bar ── */
    .stats-bar {
      background: var(--navy);
      padding: 16px 32px;
      display: flex;
      gap: 12px;
      border-bottom: 2px solid rgba(0,0,0,0.15);
    }
    .stat {
      background: #fff;
      border-radius: 10px;
      padding: 12px 24px;
      min-width: 130px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.10);
    }
    .stat .num { font-size: 1.8rem; font-weight: 800; color: var(--navy); line-height: 1; }
    .stat .num.green { color: var(--green); }
    .stat .num.gray  { color: var(--muted); }
    .stat .lbl { font-size: 0.66rem; color: var(--muted); margin-top: 4px; text-transform: uppercase; letter-spacing: 0.07em; }

    /* ── Tabs ── */
    .tabs-bar {
      background: var(--navy);
      padding: 0 32px;
      display: flex;
      gap: 2px;
      overflow-x: auto;
      border-bottom: 1px solid rgba(255,255,255,0.06);
    }
    .tabs-bar::-webkit-scrollbar { display: none; }
    .tab-btn {
      padding: 12px 18px;
      font-size: 0.82rem;
      font-weight: 600;
      color: rgba(255,255,255,0.4);
      background: none;
      border: none;
      border-bottom: 3px solid transparent;
      cursor: pointer;
      transition: all 0.2s;
      white-space: nowrap;
      letter-spacing: 0.02em;
    }
    .tab-btn:hover { color: rgba(255,255,255,0.75); }
    .tab-btn.active { color: var(--gold); border-bottom-color: var(--gold); }
    .tab-count {
      display: inline-block;
      font-size: 0.62rem;
      padding: 1px 6px;
      border-radius: 20px;
      margin-left: 5px;
      background: rgba(255,255,255,0.08);
      color: rgba(255,255,255,0.4);
      font-weight: 700;
    }
    .tab-btn.active .tab-count { background: var(--gold-bg); color: var(--gold); }

    /* ── Content ── */
    .content { max-width: 880px; margin: 28px auto; padding: 0 24px; }
    .refresh-bar { text-align: right; margin-bottom: 14px; font-size: 0.73rem; color: var(--muted); }
    .refresh-bar b { color: var(--text); }
    .section-label { font-size: 0.68rem; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 10px; }

    /* ── Cards ── */
    .card {
      background: var(--white);
      border-radius: 12px;
      padding: 15px 18px;
      margin-bottom: 9px;
      box-shadow: var(--shadow);
      display: flex;
      align-items: center;
      gap: 14px;
      border-left: 3px solid transparent;
      transition: box-shadow 0.18s, border-color 0.18s;
    }
    .card:hover { box-shadow: 0 6px 20px rgba(27,29,53,0.13); }
    .card.bot-on  { border-left-color: var(--green); }
    .card.bot-off { border-left-color: var(--gold); }

    .avatar {
      width: 42px; height: 42px;
      border-radius: 50%;
      background: var(--navy);
      color: #fff;
      display: flex; align-items: center; justify-content: center;
      font-weight: 800; font-size: 1rem;
      flex-shrink: 0;
      letter-spacing: -0.5px;
    }
    .card.bot-off .avatar { background: var(--gold); }

    .info { flex: 1; min-width: 0; }
    .info-top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .info-name { font-weight: 700; font-size: 0.92rem; }
    .info-tel { font-size: 0.75rem; color: var(--muted); }
    .status-pill {
      font-size: 0.66rem; font-weight: 700;
      padding: 2px 8px; border-radius: 20px;
    }
    .status-pill.on  { background: #D6EFE0; color: #1A5C2B; }
    .status-pill.off { background: #EBEBEB; color: #747576; }
    .info-msg { font-size: 0.8rem; color: #666; margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 420px; }
    .info-meta { font-size: 0.7rem; color: #bbb; margin-top: 3px; }

    /* ── Toggle ── */
    .toggle { position: relative; width: 48px; height: 26px; flex-shrink: 0; }
    .toggle input { opacity: 0; width: 0; height: 0; }
    .slider { position: absolute; inset: 0; background: #D5D8E0; border-radius: 26px; cursor: pointer; transition: 0.28s; }
    .slider:before { content: ""; position: absolute; width: 18px; height: 18px; left: 4px; bottom: 4px; background: white; border-radius: 50%; transition: 0.28s; box-shadow: 0 1px 4px rgba(0,0,0,0.18); }
    input:checked + .slider { background: var(--green); }
    input:checked + .slider:before { transform: translateX(22px); }

    /* ── Empty ── */
    .empty { text-align: center; padding: 60px 20px; color: var(--muted); font-size: 0.88rem; }
    .empty svg { opacity: 0.18; margin-bottom: 14px; display: block; margin-left: auto; margin-right: auto; }
  </style>
</head>
<body>

<header>
  <img src="/static/logo.jpg" alt="Ibérica Seguridad" style="height:44px;width:44px;object-fit:cover;border-radius:50%;border:2px solid rgba(255,255,255,0.25);flex-shrink:0;">
  <div>
    <span class="header-title">Ibérica Seguridad</span>
    <span class="header-sub">Panel Bot WhatsApp</span>
  </div>
  <div class="header-clock" id="reloj"></div>
</header>

<div class="stats-bar">
  <div class="stat"><div class="num" id="sTotal">—</div><div class="lbl">Contactos</div></div>
  <div class="stat"><div class="num green" id="sActivos">—</div><div class="lbl">Bot activo</div></div>
  <div class="stat"><div class="num gray" id="sPausados">—</div><div class="lbl">Con agente</div></div>
</div>

<div class="tabs-bar" id="tabsBar"></div>

<div class="content">
  <div class="refresh-bar">Actualización en <b><span id="cuenta">30</span>s</b></div>
  <div class="section-label" id="secLabel">Conversaciones</div>
  <div id="lista"><div class="empty">Cargando...</div></div>
</div>

<script>
  const CANALES = {
    "69af0932bd6b88aaf5da3887": { nombre: "Noe",      tel: null },
    "69a6981752ac843492cb9ed5": { nombre: "Mari",     tel: "34674163817" },
    "69af0e9ee1c709083b065b8a": { nombre: "Jose",     tel: "34674163818" },
    "69bd11ce7614bf4b4d6f2d3c": { nombre: "Isabel",   tel: "34664658254" },
    "69c3a0276c369daa9f0bbf81": { nombre: "Nieves",   tel: "34663303461" },
    "69fda40ba6876fcf26d5407f": { nombre: "Soporte",  tel: "34661665929" }
  };
  function nombreCanal(id) { return CANALES[id]?.nombre || id; }

  let tabActivo = "todos";
  let todosContactos = [];

  function hora(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    const esHoy = d.toDateString() === new Date().toDateString();
    return esHoy
      ? d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  }

  function renderTabs(data) {
    const bar = document.getElementById('tabsBar');
    const conteo = {};
    data.forEach(c => { const id = c.canalId || 'sin-canal'; conteo[id] = (conteo[id] || 0) + 1; });

    const tabs = [{ id: 'todos', nombre: 'Todos', count: data.length }];
    Object.entries(CANALES).forEach(([id, info]) => tabs.push({ id, nombre: info.nombre, count: conteo[id] || 0 }));

    bar.innerHTML = tabs.map(t => \`
      <button class="tab-btn \${tabActivo === t.id ? 'active' : ''}" onclick="cambiarTab('\${t.id}')">
        \${t.nombre}<span class="tab-count">\${t.count}</span>
      </button>\`).join('');
  }

  function renderLista(data) {
    const filtrado = tabActivo === 'todos' ? data : data.filter(c => (c.canalId || 'sin-canal') === tabActivo);
    const lista = document.getElementById('lista');
    document.getElementById('secLabel').textContent =
      tabActivo === 'todos' ? 'Todas las conversaciones' : 'Conversaciones — ' + nombreCanal(tabActivo);

    if (filtrado.length === 0) {
      lista.innerHTML = '<div class="empty"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><p>Sin conversaciones en este canal</p></div>';
      return;
    }

    lista.innerHTML = filtrado.map(c => {
      const nombre = c.nombre || c.telefono;
      const inicial = (c.nombre || c.telefono.slice(-2)).charAt(0).toUpperCase();
      const on = c.botActivo;
      return \`
        <div class="card \${on ? 'bot-on' : 'bot-off'}">
          <div class="avatar">\${inicial}</div>
          <div class="info">
            <div class="info-top">
              <span class="info-name">\${nombre}</span>
              \${c.nombre ? \`<span class="info-tel">+\${c.telefono}</span>\` : ''}
              <span class="status-pill \${on ? 'on' : 'off'}">\${on ? 'Bot activo' : 'Agente'}</span>
            </div>
            <div class="info-msg">\${c.ultimoMensaje || 'Sin mensajes aún'}</div>
            <div class="info-meta">Último: \${hora(c.ultimaActividad)} &middot; \${c.mensajesTotal} mensaje\${c.mensajesTotal !== 1 ? 's' : ''} &middot; \${c.canalNombre}</div>
          </div>
          <label class="toggle">
            <input type="checkbox" \${on ? 'checked' : ''} onchange="toggleBot('\${c.telefono}', this.checked, '\${c.canalId}')">
            <span class="slider"></span>
          </label>
        </div>\`;
    }).join('');
  }

  async function cargar() {
    const res = await fetch('/admin/api/contactos');
    todosContactos = await res.json();
    const activos = todosContactos.filter(c => c.botActivo).length;
    document.getElementById('sTotal').textContent = todosContactos.length;
    document.getElementById('sActivos').textContent = activos;
    document.getElementById('sPausados').textContent = todosContactos.length - activos;
    renderTabs(todosContactos);
    renderLista(todosContactos);
  }

  function cambiarTab(id) {
    tabActivo = id;
    renderTabs(todosContactos);
    renderLista(todosContactos);
  }

  async function toggleBot(telefono, activo, canalId) {
    await fetch('/admin/api/toggle/' + encodeURIComponent(telefono), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activo, canalId })
    });
    cargar();
  }

  setInterval(() => {
    document.getElementById('reloj').textContent = new Date().toLocaleTimeString('es-ES');
  }, 1000);

  let seg = 30;
  setInterval(() => {
    seg--;
    document.getElementById('cuenta').textContent = seg;
    if (seg <= 0) { seg = 30; cargar(); }
  }, 1000);

  cargar();
</script>
</body>
</html>`);
});

// ── API: lista de contactos para el panel ─────────────────────
app.get("/admin/api/contactos", authAdmin, (req, res) => {
  const lista = Object.keys(actividad).map((telefono) => {
    const canalId = actividad[telefono]?.canalId || null;
    const clave = canalId ? `${canalId}_${telefono}` : telefono;
    return {
      telefono,
      nombre: NOMBRES_AGENTES[telefono] || null,
      canalId,
      canalNombre: CANALES_AGENTES[canalId] || "Desconocido",
      botActivo: botActivo[clave] !== false,
      ultimoMensaje: actividad[telefono]?.ultimoMensaje || null,
      ultimaActividad: actividad[telefono]?.ultimaActividad || null,
      mensajesTotal: actividad[telefono]?.mensajesTotal || 0,
    };
  });
  lista.sort((a, b) => (b.ultimaActividad || 0) - (a.ultimaActividad || 0));
  res.json(lista);
});

// ── API: activar/pausar bot para un cliente ───────────────────
app.post("/admin/api/toggle/:telefono", authAdmin, async (req, res) => {
  const telefono = decodeURIComponent(req.params.telefono);
  const activo   = req.body?.activo;
  const canalId  = req.body?.canalId || null;
  const clave    = canalId ? `${canalId}_${telefono}` : telefono;

  const estabaActivo = botActivo[clave] !== false;
  botActivo[clave] = activo;
  delete pausaExpira[clave]; // el control manual manda: pausa/activación indefinida
  redisSet("iberica:botActivo", botActivo);
  redisSet("iberica:pausaExpira", pausaExpira);
  console.log(`[Admin] Bot ${activo ? "activado" : "pausado"} para ${telefono} (canal: ${canalId})`);

  // Si se acaba de pausar, avisar al cliente
  if (estabaActivo && !activo && conversaciones[telefono]?.memberId) {
    await enviarMensaje(
      telefono,
      "Un agente de Ibérica Seguridad se pondrá en contacto contigo en breve. ¡Gracias por tu paciencia! 🙏"
    );
  }

  // Si se reactiva el bot, reiniciar la conversación con el menú
  if (!estabaActivo && activo && conversaciones[telefono]?.memberId) {
    resetearConversacion(telefono);
    conversaciones[telefono].step = "menu_principal";
    await saludoInicial(telefono);
  }

  res.json({ ok: true, telefono, canalId, botActivo: activo });
});

// ── Registro de decisiones de la IA (revisión en modo sombra) ─
app.get("/admin/api/ia-log", authAdmin, (req, res) => {
  res.json({ modo: IA_MODO, nombre: BOT_NOMBRE, decisiones: iaLog });
});

// ── Últimos eventos crudos del webhook (diagnóstico) ─────────
app.get("/admin/api/eventos", authAdmin, (req, res) => {
  res.json({ total: eventosRecientes.length, eventos: eventosRecientes });
});

// ── Prueba de la llamada de aviso desde el navegador ─────────
// GET /admin/api/test-llamada           → llama al teléfono de turno
// GET /admin/api/test-llamada?tel=34... → llama a ese número
app.get("/admin/api/test-llamada", authAdmin, async (req, res) => {
  const resultado = await llamarAvisoParte({
    refParte:    "PRUEBA-001",
    nombre:      "Cliente de Prueba",
    telefono:    "600123456",
    direccion:   "Calle San Leonardo 34, Almería",
    descripcion: "Esto es una prueba del aviso por voz. Si la oyes entera, funciona.",
    numeroAviso: req.query.tel || null,
  });
  res.json(resultado);
});

// ── Sondeo manual de cierres desde el panel (diagnóstico) ────
app.get("/admin/api/test-cierres", authAdmin, async (req, res) => {
  res.json(await sondearPartesCerrados());
});

// ── Webhook del CRM: parte CERRADO → encuesta postventa/reseña ──
// El workflow de Zoho CRM (estado → Cerrado) llama aquí y Marta pregunta la
// nota en el chat del cliente. Seguridad: ?k=<AVISO_LLAMADA_KEY>.
app.post("/zoho/parte-cerrado", async (req, res) => {
  const clave = process.env.AVISO_LLAMADA_KEY;
  if (!clave || req.query.k !== clave) return res.status(401).json({ error: "no autorizado" });
  const d = req.body || {};
  console.log("[Reseñas] Parte cerrado en Zoho:", JSON.stringify(d).slice(0, 400));
  const resultado = await pedirResena({
    telefono: d.telefono || d.movil || d.phone || null,
    nombre:   d.nombre || d.cliente || null,
    refParte: d.refParte || d.ref || d.numero || null,
  });
  console.log("[Reseñas] Resultado:", JSON.stringify(resultado));
  res.json(resultado);
});

// ── Webhook de Zoho Flow: parte creado → llamada de aviso ────
// Zoho Flow llama aquí cuando se crea un parte en el CRM y el bot lanza la
// llamada de voz al teléfono de turno. Seguridad: ?k=<AVISO_LLAMADA_KEY>.
app.post("/zoho/parte-creado", async (req, res) => {
  const clave = process.env.AVISO_LLAMADA_KEY;
  if (!clave || req.query.k !== clave) return res.status(401).json({ error: "no autorizado" });
  const d = req.body || {};
  console.log("[Aviso-voz] Parte creado en Zoho:", JSON.stringify(d).slice(0, 400));
  const resultado = await llamarAvisoParte({
    refParte:    d.refParte || d.ref || d.numero || null,
    nombre:      d.nombre || d.cliente || null,
    telefono:    d.telefono || null,
    direccion:   d.direccion || null,
    descripcion: d.descripcion || d.asunto || null,
    numeroAviso: d.numeroAviso || null,  // opcional: forzar a quién se llama
  });
  res.json(resultado);
});

// ── Health check ─────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    iaModo: IA_MODO,
    asistente: BOT_NOMBRE,
    version: (process.env.RAILWAY_GIT_COMMIT_SHA || "").slice(0, 7) || "dev",
  });
});

// ── Webhook de Woztell ───────────────────────────────────────
app.post("/webhook", async (req, res) => {
  try {
    // Guardar el evento crudo para diagnóstico (GET /admin/api/eventos)
    eventosRecientes.unshift({ ts: new Date().toISOString(), body: req.body });
    if (eventosRecientes.length > 80) eventosRecientes.pop();

    const tipo       = (req.body?.type || "").toUpperCase();
    const eventType  = (req.body?.eventType || "").toUpperCase();

    // Solo procesamos mensajes ENTRANTES del cliente.
    // - eventType !== "INBOUND": mensajes OUTBOUND (los que el propio bot envía)
    //   Woztell los refleja de vuelta al webhook y causarían un bucle infinito.
    if (eventType !== "INBOUND") {
      // Mensaje saliente/eco: si no lo envió el bot, es una persona de la
      // oficina escribiendo al cliente → pausa automática (auto-takeover).
      try {
        const t = extraerTextoEvento(req.body);
        console.log(
          `[Takeover?] evento=${eventType || "?"} tipo=${tipo || "?"} from=${req.body?.from || "-"} to=${req.body?.to || "-"} canal=${req.body?.channel || "-"} texto="${(t || "").slice(0, 60)}"`
        );
        if (t) detectarIntervencionHumana(req.body);
        else console.log("[Takeover-diag] body:", JSON.stringify(req.body).slice(0, 700));
      } catch (e) { console.error("[Takeover] Error:", e.message); }
      return res.sendStatus(200);
    }

    // Extraer datos del body según la estructura real de Woztell
    const telefono  = req.body?.from;      // número del cliente (clave de estado)
    const memberId  = req.body?.member;    // ID interno Woztell para enviar mensajes
    const channelId = req.body?.channel;   // canal real — puede diferir del .env
    const texto     = req.body?.data?.text || "";
    // Imagen/documento — solo lo usa el flujo de captación (fotos de la puerta)
    const esImagen  = tipo === "IMAGE" || tipo === "MEDIA" || tipo === "DOCUMENT" || !!req.body?.data?.url;

    // Ignorar el resto de eventos (READ, DELIVERED, SENT, etc.)
    if (tipo !== "TEXT" && !esImagen) {
      if (["SENT", "DELIVERED", "READ"].includes(tipo)) {
        // Acuses de envío: detectar respuestas manuales de la oficina
        try { manejarAcuseEnvio(req.body, tipo); } catch (e) { console.error("[Takeover] Error acuse:", e.message); }
      } else if (tipo === "FAILED") {
        // Un envío (plantilla de encuesta/reseña, notificación...) NO llegó al
        // cliente. Registrar el motivo que devuelve WhatsApp para diagnóstico.
        console.error("[Fallo envío] body:", JSON.stringify(req.body).slice(0, 900));
      } else {
        console.log(`[Webhook] Evento ignorado (type: ${tipo}, eventType: ${eventType})`);
        // Los tipos que no conocemos pueden ser el eco de una respuesta manual
        // de la oficina (modo coexistencia con la app de WhatsApp Business).
        // Registrar su contenido y pasarlos por la detección de intervención
        // humana, que solo pausa si hay texto ajeno en un chat conocido.
        if (!["READ", "DELIVERED"].includes(tipo)) {
          console.log("[Diag evento] body:", JSON.stringify(req.body).slice(0, 900));
          try { detectarIntervencionHumana(req.body); } catch (e) { console.error("[Takeover] Error:", e.message); }
        }
      }
      return res.sendStatus(200);
    }

    if (!telefono || !memberId || !channelId) {
      console.warn("[Webhook] Payload incompleto:", JSON.stringify(req.body));
      return res.status(400).json({ error: "Payload incompleto" });
    }

    console.log(`[Webhook] De: ${telefono} | member: ${memberId} | channel: ${channelId} | msg: "${texto}"`);

    // Registrar actividad del cliente (para el panel admin)
    if (!actividad[telefono]) actividad[telefono] = { mensajesTotal: 0 };
    actividad[telefono].ultimoMensaje  = texto;
    actividad[telefono].ultimaActividad = Date.now();
    actividad[telefono].mensajesTotal++;
    actividad[telefono].canalId  = channelId;
    actividad[telefono].memberId = memberId;  // para poder escribirle (reseñas) tras un reinicio
    redisSet("iberica:actividad", actividad);

    // ── Ignorar mensajes de agentes internos (no son clientes) ──────────
    if (NOMBRES_AGENTES[telefono]) {
      console.log(`[Webhook] Mensaje de agente interno ${NOMBRES_AGENTES[telefono]} (${telefono}) — ignorado`);
      return res.sendStatus(200);
    }

    // ══════════════════════════════════════════════════════════════════
    // CAPTACIÓN — Leads del anuncio de puertas (regla especial, con
    // prioridad sobre el saludo genérico)
    // En el canal de la campaña, TODO contacto nuevo viene del anuncio →
    // se asume puertas directamente (aunque solo diga "hola").
    // ══════════════════════════════════════════════════════════════════
    if (CAMPANA_CHANNEL_ID && channelId === CAMPANA_CHANNEL_ID &&
        (esInicioCampana(texto) || captacionActiva(telefono) || esContactoNuevo(telefono) ||
         tieneReferralAnuncio(req.body) || mencionaAnuncio(texto) || esTemaPuertas(texto))) {
      await manejarCaptacion({ telefono, memberId, channelId, texto, esImagen, req });
      return res.sendStatus(200);
    }

    // A partir de aquí, el flujo normal solo continúa con mensajes de TEXTO.
    if (tipo !== "TEXT") {
      // Un lead en cualificación puede mandar su foto por un canal normal
      if (esImagen && captacionActiva(telefono) && botActivo[`${channelId}_${telefono}`] !== false) {
        await manejarCaptacion({ telefono, memberId, channelId, texto: "", esImagen, req });
        return res.sendStatus(200);
      }
      // Foto/documento fuera de la campaña: con la IA activa, agradecerla en
      // vez de ignorarla en silencio (la oficina la ve en la bandeja).
      if (
        esImagen && IA_MODO === "on" &&
        conversaciones[telefono]?.memberId &&
        botActivo[`${channelId}_${telefono}`] !== false
      ) {
        await enviarNatural(telefono, "¡Gracias por la foto! 📸 Se la paso al equipo para que lo valore mejor. Seguimos por aquí 😊");
      }
      return res.sendStatus(200);
    }

    // Una respuesta a la encuesta postventa se procesa siempre, aunque el
    // canal esté en pausa o fuera de horario (es un intercambio puntual).
    const enFlujoResena = (conversaciones[telefono]?.step || "").startsWith("resena_");

    // ── Comprobar si el bot está pausado para este cliente en este canal ──
    const claveBot = `${channelId}_${telefono}`;
    if (botActivo[claveBot] === false && !enFlujoResena) {
      if (pausaExpira[claveBot] && Date.now() > pausaExpira[claveBot]) {
        botActivo[claveBot] = true;
        delete pausaExpira[claveBot];
        redisSet("iberica:botActivo", botActivo);
        redisSet("iberica:pausaExpira", pausaExpira);
        console.log(`[Pausa] Caducada para ${claveBot} — bot reactivado`);
      } else {
        console.log(`[Webhook] Bot pausado para ${telefono} en canal ${channelId} — mensaje ignorado`);
        return res.sendStatus(200);
      }
    }

    // ── Canal Soporte (encuestas/reseñas) — derivar siempre a agente humano ──
    // Este canal se usa para envíos automáticos. Si un cliente responde,
    // pausamos el bot, avisamos al agente de turno y le decimos que le llamamos.
    const CANAL_SOPORTE = "69fda40ba6876fcf26d5407f";
    if (channelId === CANAL_SOPORTE) {
      console.log(`[Webhook] Mensaje en canal Soporte de ${telefono} — derivando a agente`);

      // Inicializar conversación si no existe (para poder enviar mensajes)
      if (!conversaciones[telefono]) resetearConversacion(telefono);
      conversaciones[telefono].memberId  = memberId;
      conversaciones[telefono].channelId = channelId;

      // Pausar el bot para este cliente
      const claveBot = `${channelId}_${telefono}`;
      botActivo[claveBot] = false;
      redisSet("iberica:botActivo", botActivo);

      // Notificar al agente de turno
      const destinatario = determinarDestinatarioNotificacion();
      const ahoraStr = new Date().toLocaleString("es-ES", { timeZone: "Europe/Madrid", hour12: false });
      await enviarNotificacionAgente(destinatario, {
        nombre:      telefono,
        telefono:    telefono.slice(-9),
        direccion:   "—",
        descripcion: `Respuesta en canal Soporte: "${texto}"`,
        apertura:    ahoraStr,
        refParte:    "—",
        agente:      "Soporte (encuestas)",
      });

      // Mensaje al cliente
      await enviarMensaje(
        telefono,
        "Gracias por contactar con *Ibérica Seguridad* 🔐\n\nHemos recibido tu mensaje y un agente se pondrá en contacto contigo en breve.\n\nSi necesitas ayuda urgente, llámanos al *661 665 929*."
      );

      return res.sendStatus(200);
    }

    // ── Comprobar horario de activación del canal ─────────────
    // En horario comercial el bot está apagado (los agentes atienden en persona)
    // Fuera de horario comercial el bot responde con normalidad
    const minutosMadrid = minutosActualesMadrid();
    const activo = dentroDeHorario(channelId);
    console.log(`[Horario] Canal: ${channelId} | Minutos Madrid: ${minutosMadrid} | Bot activo: ${activo}`);
    if (!activo && !enFlujoResena) {
      console.log(`[Webhook] Horario comercial — bot inactivo para canal ${channelId}, mensaje ignorado`);
      return res.sendStatus(200);
    }

    // ── Leads del anuncio de puertas en los canales normales ──────────
    // Un contacto NUEVO que llega con el referral del anuncio, lo menciona
    // o pregunta directamente por puertas → cualificación de lead. Un "hola"
    // suelto aquí sigue el flujo normal (solo en el canal de campaña se
    // asume puertas); urgencias, domótica, etc. no cambian.
    if (captacionActiva(telefono) ||
        (!conversaciones[telefono] && esContactoNuevo(telefono) &&
         (tieneReferralAnuncio(req.body) || mencionaAnuncio(texto) || esTemaPuertas(texto)))) {
      await manejarCaptacion({ telefono, memberId, channelId, texto, esImagen, req });
      return res.sendStatus(200);
    }

    // Inicializar conversación si no existe. Con la IA activa, el primer
    // mensaje se procesa directamente (así "se me ha roto la cerradura"
    // no se pierde detrás de un menú).
    if (!conversaciones[telefono]) {
      resetearConversacion(telefono);
      conversaciones[telefono].memberId  = memberId;
      conversaciones[telefono].channelId = channelId;
      conversaciones[telefono].step = "menu_principal";
      if (IA_MODO === "on") {
        await procesarMensaje(telefono, texto);
      } else {
        await enviarMensaje(telefono, MENU_PRINCIPAL);
      }
      return res.sendStatus(200);
    }

    // Actualizar memberId y channelId en cada mensaje (pueden variar entre sesiones)
    conversaciones[telefono].memberId  = memberId;
    conversaciones[telefono].channelId = channelId;

    // Si el step es null (recién reseteado pero ya tenía estado), forzar menú
    if (conversaciones[telefono].step === null) {
      conversaciones[telefono].step = "menu_principal";
      if (IA_MODO === "on") {
        await procesarMensaje(telefono, texto);
      } else {
        await enviarMensaje(telefono, MENU_PRINCIPAL);
      }
      return res.sendStatus(200);
    }

    // Procesar el mensaje entrante
    await procesarMensaje(telefono, texto);

    // Asegurarse de que tras el procesamiento el step quede en menu_principal si se reseteó
    if (conversaciones[telefono] && conversaciones[telefono].step === null) {
      conversaciones[telefono].step = "menu_principal";
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("[Webhook] Error inesperado:", err.message);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// ── Callback OAuth de Zoho (recibe el código de autorización) ─
app.get("/zoho/callback", async (req, res) => {
  const codigo = req.query.code;

  if (!codigo) {
    return res.status(400).send("No se recibió código de autorización.");
  }

  console.log("[Zoho] Código de autorización recibido:", codigo);

  try {
    const response = await axios.post("https://accounts.zoho.eu/oauth/v2/token", null, {
      params: {
        code: codigo,
        client_id: process.env.ZOHO_CLIENT_ID,
        client_secret: process.env.ZOHO_CLIENT_SECRET,
        redirect_uri: process.env.ZOHO_REDIRECT_URI,
        grant_type: "authorization_code",
      },
    });

    console.log("[Zoho] Tokens obtenidos:", response.data);
    res.json({
      mensaje: "Autorización completada. Guarda el refresh_token en tu .env",
      tokens: response.data,
    });
  } catch (err) {
    console.error("[Zoho] Error en callback:", err.response?.data || err.message);
    res.status(500).send("Error al obtener los tokens de Zoho.");
  }
});

// ── Test de conexión Zoho CRM ─────────────────────────────────
// Visita /zoho/test en el navegador para verificar si el token funciona
app.get("/zoho/test", async (req, res) => {
  try {
    const token = await obtenerTokenZoho();
    const resultados = {};

    // Test 1: información de la organización (más básico)
    try {
      const org = await axios.get("https://www.zohoapis.eu/crm/v2/org", {
        headers: { Authorization: `Zoho-oauthtoken ${token}` },
      });
      resultados.org = { ok: true, nombre: org.data.org?.[0]?.company_name };
    } catch (e) {
      resultados.org = { ok: false, status: e.response?.status, error: e.response?.data };
    }

    // Test 2: listar módulos disponibles
    try {
      const modulos = await axios.get("https://www.zohoapis.eu/crm/v2/settings/modules", {
        headers: { Authorization: `Zoho-oauthtoken ${token}` },
      });
      resultados.modulos = modulos.data.modules?.map(m => m.api_name) || [];
    } catch (e) {
      resultados.modulos = { ok: false, status: e.response?.status, error: e.response?.data };
    }

    // Test 3: acceso directo al módulo Cases
    try {
      const cases = await axios.get("https://www.zohoapis.eu/crm/v2/Cases?per_page=1", {
        headers: { Authorization: `Zoho-oauthtoken ${token}` },
      });
      resultados.cases = { ok: true, total: cases.data.info?.count };
    } catch (e) {
      resultados.cases = { ok: false, status: e.response?.status, error: e.response?.data };
    }

    res.json({ token_primeros_20: token?.slice(0, 20), resultados });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Test: ver todos los campos de un Case real ───────────────
// ── Test: buscar parte por teléfono ──────────────────────────
// ── Test: buscar partes via Contacto ─────────────────────────
app.get("/zoho/test-contacto/:tel", async (req, res) => {
  try {
    const token = await obtenerTokenZoho();
    const tel9 = req.params.tel.slice(-9);
    const resultado = { tel9, contacto: null, partes: [] };

    // Buscar contacto por Phone o Mobile
    for (const campo of ["Phone", "Mobile"]) {
      try {
        const res = await axios.get("https://www.zohoapis.eu/crm/v2/Contacts/search", {
          params: { criteria: `(${campo}:equals:${tel9})` },
          headers: { Authorization: `Zoho-oauthtoken ${token}` },
        });
        if (res.data.data?.length > 0) {
          const c = res.data.data[0];
          resultado.contacto = { id: c.id, nombre: c.Full_Name, campo };
          break;
        }
      } catch (e) {
        if (e.response?.status !== 204) resultado[`error_${campo}`] = e.response?.data;
      }
    }

    if (!resultado.contacto) {
      return res.json({ ...resultado, mensaje: "No se encontró contacto con ese teléfono" });
    }

    // Obtener partes del contacto
    try {
      const casesRes = await axios.get(
        `https://www.zohoapis.eu/crm/v2/Contacts/${resultado.contacto.id}/Cases`,
        { headers: { Authorization: `Zoho-oauthtoken ${token}` } }
      );
      resultado.partes = casesRes.data.data?.map(c => ({
        ref: c.ref_Parte, subject: c.Subject, status: c.Status, fecha: c.Fecha_Hora_Inicio
      })) || [];
    } catch (e) {
      resultado.error_cases = { status: e.response?.status, detail: e.response?.data };
    }

    res.json(resultado);
  } catch (err) {
    res.status(500).json({ error: err.message, detail: err.response?.data });
  }
});

app.get("/zoho/test-phone/:tel", async (req, res) => {
  try {
    const token = await obtenerTokenZoho();
    const tel9 = req.params.tel.slice(-9);
    const result = await axios.get("https://www.zohoapis.eu/crm/v2/Cases/search", {
      params: { criteria: `(Phone:equals:${tel9})` },
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
    });
    res.json({ tel9, total: result.data.data?.length, casos: result.data.data?.map(c => ({ ref: c.ref_Parte, subject: c.Subject, phone: c.Phone, status: c.Status })) });
  } catch (err) {
    res.status(500).json({ error: err.message, status: err.response?.status, detail: err.response?.data });
  }
});

// ── Diagnóstico de horarios ────────────────────────────────
app.get("/horario", (req, res) => {
  const ahora = new Date();
  const minutos = minutosActualesMadrid();
  const horasMadrid = new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    weekday: "long", hour12: false,
  }).format(ahora);

  const estado = {};
  for (const [canalId, nombre] of Object.entries(CANALES_AGENTES)) {
    estado[nombre] = {
      canalId,
      botActivo: dentroDeHorario(canalId),
      horario: HORARIOS_CANALES[canalId] || "siempre activo",
    };
  }

  res.json({
    ahoraUTC: ahora.toISOString(),
    ahoraMadrid: horasMadrid,
    minutosMadrid: minutos,
    canales: estado,
  });
});

app.get("/zoho/campos-case", async (req, res) => {
  try {
    const token = await obtenerTokenZoho();
    const result = await axios.get("https://www.zohoapis.eu/crm/v2/Cases?per_page=1", {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
    });
    const caso = result.data.data?.[0];
    if (!caso) return res.json({ mensaje: "No hay Cases en Zoho" });
    res.json({ campos: Object.keys(caso), valores: caso });
  } catch (err) {
    res.status(500).json({ error: err.message, detail: err.response?.data });
  }
});

// ============================================================
// ARRANQUE DEL SERVIDOR
// ============================================================
app.listen(PORT, async () => {
  console.log(`\n🚀 Ibérica Seguridad Bot arrancado en puerto ${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/health`);
  console.log(`   Webhook:      http://localhost:${PORT}/webhook`);

  // Cargar estado persistido desde Redis
  try {
    await cargarEstadoDesdeRedis();
    console.log("✅ Estado cargado desde Redis correctamente.");
  } catch (err) {
    console.warn("⚠️  No se pudo cargar el estado desde Redis:", err.message);
  }

  // Sondeo de partes cerrados → encuesta postventa/reseñas (cada 5 min)
  setTimeout(sondearPartesCerrados, 90 * 1000);
  setInterval(sondearPartesCerrados, 5 * 60 * 1000);

  // Pre-cargar el token de Zoho al arrancar para detectar errores de configuración
  try {
    await obtenerTokenZoho();
    console.log("✅ Token de Zoho obtenido correctamente al arrancar.");
  } catch (err) {
    console.warn("⚠️  No se pudo obtener el token de Zoho al arrancar:", err.message);
    console.warn("   Comprueba ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET y ZOHO_REFRESH_TOKEN en .env");
  }
});
