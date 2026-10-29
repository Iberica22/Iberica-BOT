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
app.use(express.json({ type: "*/*", limit: "2mb" }));
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
  // Si el contacto estaba en plena captación (guion de puertas), el lead pasa
  // a la persona que ha intervenido: se cierra para que Marta no retome el
  // guion cuando caduque la pausa.
  const tel = clave.slice(clave.indexOf("_") + 1);
  if (captacionLeads[tel]) {
    delete captacionLeads[tel];
    guardarCaptacionLeads();
    console.log(`[Captación] Lead ${tel} cerrado — lo atiende una persona`);
  }
  // Y si tenía un seguimiento de presupuesto en marcha, Marta deja de
  // escribirle para no pisar la conversación (María sigue con su agenda).
  for (const seg of Object.values(seguimientosPresu)) {
    if (seg.clave === tel && ["pendiente", "toque1", "toque2", "toque3", "en_curso"].includes(seg.estado)) {
      seg.estado = "atendido_persona";
      guardarSeguimientosPresu();
      registrarResultadoPresu(seg.ref, "marta_para_lo_atiende_una_persona");
      console.log(`[Presupuestos] Marta deja de escribir en ${seg.ref} — lo atiende una persona`);
    }
  }
}

// ¿Está el bot pausado para esta clave canal_teléfono? Reactiva si la pausa
// temporal ya caducó. TODAS las rutas que envían mensajes automáticos
// (flujo normal, captación, fotos) deben pasar por aquí: una intervención
// humana tiene que silenciar a Marta en todas partes.
function botPausado(clave) {
  if (botActivo[clave] !== false) return false;
  if (pausaExpira[clave] && Date.now() > pausaExpira[clave]) {
    botActivo[clave] = true;
    delete pausaExpira[clave];
    redisSet("iberica:botActivo", botActivo);
    redisSet("iberica:pausaExpira", pausaExpira);
    console.log(`[Pausa] Caducada para ${clave} — bot reactivado`);
    return false;
  }
  return true;
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
// El registro se guarda en Redis: tras un redeploy el bot sigue sabiendo
// qué mensajes envió él, y entonces cualquier acuse con un wamid que no
// conoce es de un mensaje escrito por una persona (WhatsApp Web, app,
// inbox de Woztell). Sin esta memoria, esos acuses había que ignorarlos.
let wamidsCargados = false;          // registro recuperado de Redis al arrancar
const arranqueTs = Date.now();       // envíos de la instancia anterior aún en vuelo
let guardadoWamidsPendiente = null;
function guardarWamidsBot() {
  if (guardadoWamidsPendiente) return;
  guardadoWamidsPendiente = setTimeout(() => {
    guardadoWamidsPendiente = null;
    const limite = Date.now() - 3 * 24 * 3600 * 1000;
    const vivos = [...wamidsBot].filter(([, ts]) => ts >= limite).slice(-3000);
    redisSet("iberica:wamidsBot", Object.fromEntries(vivos));
  }, 2000);
}
function registrarWamidsEnvio(resData) {
  try {
    for (const r of resData?.sendResult?.result || []) {
      const ids = [
        r?.messageEvent?.messageId,
        ...(r?.result?.messages || []).map((m) => m?.id),
      ].filter(Boolean);
      for (const id of ids) wamidsBot.set(id, Date.now());
    }
    if (wamidsBot.size > 3000) {
      const limite = Date.now() - 3 * 24 * 3600 * 1000;
      for (const [id, ts] of wamidsBot) if (ts < limite) wamidsBot.delete(id);
    }
    guardarWamidsBot();
  } catch (_) { /* nunca romper un envío por el registro */ }
}

// Últimos acuses con wamid ajeno y qué se hizo con ellos (diagnóstico del
// auto-takeover, persistente): /admin/api/takeover-diag
let acusesAjenos = [];
function registrarAcuseAjeno(entrada) {
  acusesAjenos.unshift({ ts: new Date().toISOString(), ...entrada });
  if (acusesAjenos.length > 40) acusesAjenos.pop();
  redisSet("iberica:acusesAjenos", acusesAjenos);
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
    // Eventos MANUAL/API_OUTBOUND (p. ej. envíos manuales en Instagram)
    body?.messageEvent?.data?.text ||
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
    body?.messageEvent?.to,          // eventos MANUAL/API_OUTBOUND (Instagram)
    body?.member,
  ]
    .filter(Boolean)
    .map((t) => String(t));
  // Un cliente "conocido" puede estar en conversación (memoria volátil), en
  // captación o solo en actividad (persistente en Redis): la intervención
  // debe detectarse y pausar en los tres casos, también tras un redeploy.
  const clavesConv = [...new Set([
    ...Object.keys(conversaciones),
    ...Object.keys(captacionLeads),
    ...Object.keys(actividad),
  ])];
  let telefono = candidatos.find((t) => conversaciones[t] || captacionLeads[t] || actividad[t]);
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
  if (wamid) marcarAcuseCampana(wamid, tipo);
  if (!wamid || !telefono || !canal) return;
  if (wamidsBot.has(wamid)) return;        // acuse de un envío del propio bot
  if (NOMBRES_AGENTES[telefono]) return;   // notificación interna a un agente

  const conocido = () => conversaciones[telefono] || actividad[telefono];
  let pista = "";
  try { pista = Buffer.from(String(wamid).replace(/^wamid\./, ""), "base64").toString("latin1").replace(/[^\x20-\x7e]/g, "·").slice(0, 32); } catch (_) {}

  // Mensaje escrito desde la app del móvil → intervención humana segura.
  // Ojo: usar `actividad` (persistente en Redis) y no solo `conversaciones`
  // (memoria volátil): tras un redeploy las conversaciones se vacían y las
  // respuestas manuales deben seguir pausando/renovando la pausa igualmente.
  if (esWamidDeApp(wamid)) {
    if (!conocido()) return; // número desconocido
    registrarAcuseAjeno({ tipo, telefono, pista, accion: "pausa (app)" });
    pausarPorIntervencion(canal, telefono, "respuesta manual desde la app de WhatsApp");
    return;
  }

  // Wamid desconocido con aspecto de envío API: un mensaje escrito desde
  // WhatsApp Web o el inbox de Woztell. SENT y DELIVERED se usan como señal
  // (con 4 s de margen por si el acuse llega antes que la respuesta HTTP del
  // envío del bot). DELIVERED solo cuando el registro de wamids del bot es
  // fiable: recuperado de Redis y pasados 2 min del arranque (mensajes de la
  // instancia anterior aún en vuelo). READ nunca: puede llegar días después
  // de un mensaje del bot anterior a que existiera el registro persistente.
  const registroFiable = wamidsCargados && Date.now() - arranqueTs > 2 * 60 * 1000;
  if (tipo === "READ" || (tipo === "DELIVERED" && !registroFiable)) {
    if (conocido()) registrarAcuseAjeno({ tipo, telefono, pista, accion: "ignorado" + (tipo === "READ" ? "" : " (registro aún no fiable)") });
    return;
  }
  setTimeout(() => {
    if (wamidsBot.has(wamid)) return;
    if (!conocido()) return;
    registrarAcuseAjeno({ tipo, telefono, pista, accion: "pausa" });
    pausarPorIntervencion(canal, telefono, `respuesta manual de oficina (acuse ${tipo} ajeno)`);
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
  "6a804571292b8b00616d71f9": "Instagram", // DMs de @ibericaseguridad (24/7, sin horario)
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

// ── Aviso por LLAMADA de voz ─────────────────────────────────
// Al abrirse un parte, además de la plantilla de WhatsApp se avisa con una
// llamada al teléfono de turno. Dos vías, en orden de preferencia:
//   1) Twilio directo (barato, sin cuotas): lee el parte con la voz
//      integrada. Requiere TWILIO_SID, TWILIO_TOKEN y TWILIO_FROM (un
//      número propio de Twilio o un caller ID verificado, p. ej.
//      +34950088086).
//   2) ElevenLabs Agents (voz conversacional): requiere ELEVENLABS_API_KEY,
//      ELEVENLABS_AGENT_ID y ELEVENLABS_PHONE_ID (+ ELEVENLABS_PROVIDER
//      "twilio" o "sip-trunk").
function xmlEscape(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
async function llamarAvisoTwilio(numero, nombreDest, datos) {
  const { TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM } = process.env;
  const telDeletreado = String(datos.telefono || "").replace(/\D/g, "").split("").join(" ") || "no indicado";
  const cuerpo =
    `Cliente: ${datos.nombre || "no indicado"}. ` +
    `Teléfono: ${telDeletreado}. ` +
    `Dirección: ${datos.direccion || "no indicada"}. ` +
    `Motivo: ${datos.descripcion || "sin descripción"}. ` +
    `Referencia: ${datos.refParte || "sin referencia"}.`;
  const say = (t) => `<Say language="es-ES" voice="Polly.Lucia">${xmlEscape(t)}</Say>`;
  const twiml =
    `<Response><Pause length="1"/>` +
    say(`Hola ${nombreDest}. Soy Marta, de Ibérica Seguridad. Ha entrado un parte nuevo. ${cuerpo}`) +
    `<Pause length="1"/>` +
    say(`Repito. ${cuerpo}`) +
    say(`Tienes todos los datos también en el WhatsApp. Hasta ahora.`) +
    `</Response>`;
  const params = new URLSearchParams({
    To:   "+" + String(numero).replace(/^\+/, ""),
    From: TWILIO_FROM,
    Twiml: twiml,
  });
  await axios.post(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Calls.json`,
    params.toString(),
    {
      auth: { username: TWILIO_SID, password: TWILIO_TOKEN },
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 15000,
    }
  );
}

async function llamarAvisoParte(datos) {
  const twilioListo = !!(process.env.TWILIO_SID && process.env.TWILIO_TOKEN && process.env.TWILIO_FROM);
  const { ELEVENLABS_API_KEY, ELEVENLABS_AGENT_ID, ELEVENLABS_PHONE_ID } = process.env;
  const elevenListo = !!(ELEVENLABS_API_KEY && ELEVENLABS_AGENT_ID && ELEVENLABS_PHONE_ID);
  if (!twilioListo && !elevenListo) {
    console.log("[Aviso-voz] Ni Twilio ni ElevenLabs configurados — llamada omitida");
    return { ok: false, motivo: "sin_proveedor_de_voz_configurado" };
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

  // Vía preferente: Twilio directo (voz integrada, sin cuotas)
  if (twilioListo) {
    try {
      await llamarAvisoTwilio(numero, nombreDest, datos);
      console.log(`[Aviso-voz] ✅ Llamando (Twilio) a ${nombreDest} (${numero}) — parte ${datos.refParte || "—"}`);
      return { ok: true, via: "twilio", destinatario: nombreDest, numero };
    } catch (e) {
      console.error("[Aviso-voz] ❌ Twilio falló:", e.response?.status, JSON.stringify(e.response?.data || e.message).slice(0, 300));
      if (!elevenListo) return { ok: false, motivo: "error_twilio" };
      // si ElevenLabs está configurado, probamos con él como respaldo
    }
  }

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
    console.log(`[Aviso-voz] ✅ Llamando (ElevenLabs) a ${nombreDest} (${numero}) — parte ${datos.refParte || "—"}`);
    return { ok: true, via: "elevenlabs", destinatario: nombreDest, numero };
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

// ¿El receptor de la encuesta dice que no nos conoce / no contrató nada?
// Pasa con partes de seguro: el contacto de Zoho es el titular de la
// póliza y el trabajo se hizo al inquilino o a un familiar.
function noIdentificaServicio(low) {
  return /(no (hemos|he) contratado|no (nos|me) (habeis|hab[eé]is|han) hecho (nada|ningun)|no (os|los|les|te) conozco|se (esta[n]? )?equivocan|(numero|n[uú]mero) equivocado|no s[eé] (quien|qui[eé]n) (sois|eres|son)|no me suena|yo no (he )?(llamado|pedido|solicitado))/.test(low);
}

// Encuestas con respuesta pendiente: { telefono: { refParte, caseId, ts } }.
// Persistido en Redis: la respuesta del cliente puede llegar horas después
// y un redeploy borra `conversaciones` — con esto el paso resena_nps se
// reconstruye y la nota no se pierde (clave en el canal BOT, donde todo lo
// demás se deriva a un agente humano).
const resenasEnCurso = {};
function cerrarResenaEnCurso(telefono) {
  if (resenasEnCurso[telefono]) {
    delete resenasEnCurso[telefono];
    redisSet("iberica:resenasEnCurso", resenasEnCurso);
  }
}

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
  const r = await enviarPlantillaConRespaldo(telefono, process.env.RESENA_TEMPLATE, [nombre || "de nuevo"], "es", nombre);
  if (!r.ok) console.error("[Reseñas] ❌ Plantilla rechazada:", String(r.detalle).slice(0, 300));
  return r;
}


// ── Envío "en frío": clientes que nunca han escrito al WhatsApp ──────
// Woztell solo envía a members existentes. Para encuestar TODOS los partes
// terminados (avisos de compañía incluidos, que casi nunca escriben), se
// busca el member por teléfono en la Open API GraphQL y, si no existe, se
// crea — y después se le manda la plantilla aprobada como a cualquiera.
// Token: WOZTELL_API_TOKEN (con permisos de Open API / member:create);
// si no está definido se intenta con WOZTELL_TOKEN.
const WOZTELL_OPEN_API = "https://open.api.woztell.com/v3/";
async function graphqlWoztell(query, variables) {
  const token = process.env.WOZTELL_API_TOKEN || process.env.WOZTELL_TOKEN;
  const res = await axios.post(WOZTELL_OPEN_API, { query, variables }, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    timeout: 15000,
  });
  if (res.data?.errors?.length) {
    throw new Error(res.data.errors.map((e) => e?.message || "?").join("; ").slice(0, 300));
  }
  return res.data?.data;
}

// CreateMemberInput exige también "platform" (String!). En vez de adivinar
// el literal, se lee el platform de cualquier member existente del canal
// (una vez, cacheado); si el canal no tuviera members, "whatsapp-cloud".
const plataformaCanal = {};
async function obtenerPlataformaCanal(channelId) {
  if (plataformaCanal[channelId]) return plataformaCanal[channelId];
  try {
    const d = await graphqlWoztell(
      `query plataforma($channelId: String) {
         apiViewer { members(first: 1, channelId: $channelId) { edges { node { platform } } } }
       }`,
      { channelId }
    );
    const p = d?.apiViewer?.members?.edges?.[0]?.node?.platform;
    if (p) { plataformaCanal[channelId] = p; return p; }
  } catch (e) { console.error("[Reseñas] No se pudo leer el platform del canal:", e.message); }
  return process.env.WOZTELL_PLATFORM || "whatsapp-cloud";
}

// createMember está limitado a 5 llamadas/min por Woztell: no crear más de
// 4 contactos por minuto; el resto queda reintentable para el siguiente sondeo.
let creacionesMiembro = [];
async function buscarOCrearMiembroWoztell(channelId, telefono, nombre) {
  const q = await graphqlWoztell(
    `query getMemberId($channelId: ID, $externalId: ID) {
       apiViewer { member(channelId: $channelId, externalId: $externalId) { _id } }
     }`,
    { channelId, externalId: telefono }
  );
  const existente = q?.apiViewer?.member?._id;
  if (existente) return { memberId: existente, creado: false };

  creacionesMiembro = creacionesMiembro.filter((ts) => Date.now() - ts < 60 * 1000);
  if (creacionesMiembro.length >= 4) throw new Error("limite_de_creacion_por_minuto");
  creacionesMiembro.push(Date.now());

  // OJO: CreateMemberInput llama al canal "channel" (no "channelId") —
  // el 10/09 se enviaba channelId y la API rechazaba todas las creaciones.
  const input = { channel: channelId, externalId: telefono, platform: await obtenerPlataformaCanal(channelId) };
  if (nombre) input.firstName = String(nombre).trim().split(/\s+/)[0];
  const m = await graphqlWoztell(
    `mutation createMember($input: CreateMemberInput!) {
       createMember(input: $input) { member { _id } }
     }`,
    { input }
  );
  const nuevo = m?.createMember?.member?._id;
  if (!nuevo) throw new Error("createMember_sin_member_en_respuesta");
  return { memberId: nuevo, creado: true };
}

// Las plantillas de Meta pertenecen a la cuenta de UN número: las de Marta
// existen en la del número del BOT (WOZTELL_CHANNEL_ID). Si el cliente ya
// tiene chat con otro número de la empresa y desde ahí Meta responde que la
// plantilla no existe (error 132001), se reenvía desde el número del BOT.
// Las respuestas del cliente por ese número las recoge Marta igualmente.
async function enviarPlantillaConRespaldo(clave, elementName, parametros, idioma, nombre) {
  if (esBaja(clave)) {
    console.log(`[Bajas] ${elementName} NO enviada a ${clave}: pidió la baja`);
    return { ok: false, motivo: "baja", detalle: "cliente_dado_de_baja" };
  }
  const estado = conversaciones[clave];
  let r = await enviarPlantillaWoztell(clave, elementName, parametros, idioma);
  const canalBot = process.env.WOZTELL_CHANNEL_ID;
  if (!r.ok && /\b132001\b/.test(String(r.detalle || "")) && canalBot && estado.channelId !== canalBot) {
    const canalOriginal = estado.channelId, memberOriginal = estado.memberId;
    try {
      const m = await buscarOCrearMiembroWoztell(canalBot, clave, nombre);
      estado.channelId = canalBot;
      estado.memberId  = m.memberId;
      r = await enviarPlantillaWoztell(clave, elementName, parametros, idioma);
      if (r.ok) {
        console.log(`[Plantilla] ${elementName} no existe en el canal ${canalOriginal}: enviada a ${clave} desde el número del BOT`);
        r.desdeCanalBot = true;
      } else {
        estado.channelId = canalOriginal;
        estado.memberId  = memberOriginal;
      }
    } catch (e) {
      estado.channelId = canalOriginal;
      estado.memberId  = memberOriginal;
      console.error(`[Plantilla] Respaldo por el número del BOT falló para ${clave}:`, e.message);
    }
  }
  return r;
}

// ¿Teléfono al que tiene sentido escribir? Descarta los de relleno de Zoho
// (000000000, 111111111...) y los españoles que no empiezan por 6, 7, 8 o 9.
function telefonoValido(clave) {
  const d = String(clave || "").replace(/\D/g, "");
  if (d.startsWith("34") && d.length === 11) {
    const nacional = d.slice(2);
    return /^[6789]\d{8}$/.test(nacional) && !/^(\d)\1+$/.test(nacional);
  }
  return d.length >= 10 && !/^(\d)\1+$/.test(d);
}

// ══════════════════════════════════════════════════════════════════
// BAJAS — clientes que no quieren más mensajes nuestros
// Quien escribe "BAJA" (o lo pide con otras palabras) no vuelve a recibir
// NINGÚN mensaje iniciado por nosotros: seguimientos de presupuesto,
// encuestas ni campañas. Si él nos escribe, se le atiende con normalidad.
// Es para siempre; solo se quita desde el panel (/admin/api/bajas).
// ══════════════════════════════════════════════════════════════════
const bajas = {}; // { "611222333": { ts, motivo, texto } } — clave: últimos 9 dígitos
const claveBaja = (t) => String(t || "").replace(/\D/g, "").slice(-9);
function esBaja(telefono) { const k = claveBaja(telefono); return k.length === 9 && !!bajas[k]; }
function guardarBajas() { redisSet("iberica:bajas", bajas); }

// ¿Pide la baja? Devuelve el motivo o null.
// · "baja": lo pide expresamente (vale en cualquier conversación)
// · "enfado" / "fallecimiento": solo si contesta a un mensaje que le
//   mandamos nosotros (en una conversación normal, "tengo la denuncia del
//   robo" o "mi padre falleció y cambio la cerradura" son peticiones de
//   servicio, no bajas). Ante la duda, baja.
function detectarBaja(texto, respondeAMensajeNuestro) {
  const t = normalizaTxt(texto).replace(/[¡!¿?.,;:"'()*_~]/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (/^(baja|de baja|stop|unsubscribe|darme de baja|dame de baja|dadme de baja)( por favor| porfa| gracias)?$/.test(t)) return "baja";
  if (/\b(dar(me|nos)? de baja|da(me|nos) de baja|dad(me|nos) de baja|quiero (la |darme de )?baja|me doy de baja)\b/.test(t)) return "baja";
  if (/\bno (me |nos )?(escribas|escribais|escriban|escriba|mandes|mandeis|manden|mande|envies|envieis|envien|envie|(volvais|vuelvas|vuelvan|vuelva) a (escribir|mandar|enviar)(me|nos)?)( (mas|nada|ningun|mensajes|whatsapps?|publicidad)|$)/.test(t)) return "baja";
  if (/\bno quiero (recibir )?(mas |ningun |ningunos )?(mensajes|whatsapps|publicidad|promociones)/.test(t)) return "baja";
  if (/\b(dejad|deja|dejen|deje) de (escribir|mandar|enviar)/.test(t)) return "baja";
  if (/\b(quita|quitad|quiten|quite|borra|borrad|borren|elimina|eliminad)(me|nos)? de (la|vuestra|vuestras|su|sus|esta) (lista|base|listas)/.test(t)) return "baja";
  if (/\b(borr|elimin|suprim)\w* (mis|todos mis|los) datos|derecho de (supresion|olvido)|\brgpd\b|proteccion de datos/.test(t)) return "borrado_datos";
  if (/^(quitadme|quitame|borradme|borrame)$/.test(t)) return "baja";
  if (!respondeAMensajeNuestro) return null;
  if (/\b(falleci|ha muerto|murio|en paz descanse|q e p d|qepd|ya no vive|no esta con nosotros)/.test(t)) return "fallecimiento";
  if (/\b(denunci|spam|acoso|acosando|pesad[oa]s|cansin[oa]s|que asco|no me molest|dejadme en paz|dejame en paz|como habeis conseguido mi numero|quien os ha dado mi numero)/.test(t)) return "enfado";
  return null;
}

async function registrarBaja(telefono, motivo, texto, { origen = "whatsapp" } = {}) {
  const k = claveBaja(telefono);
  if (k.length !== 9) return false;
  const nueva = !bajas[k];
  bajas[k] = { ts: Date.now(), motivo, origen, texto: String(texto || "").slice(0, 200) };
  guardarBajas();
  if (consentimientos[k]?.respuesta === "si") {
    consentimientos[k] = { ...consentimientos[k], respuesta: "revocado", revocadoTs: Date.now() };
    guardarConsentimientos();
  }
  // Cancelar sus seguimientos de presupuesto vivos
  const casos = [];
  for (const seg of Object.values(seguimientosPresu)) {
    if (claveBaja(seg.clave || seg.telefono) !== k) continue;
    if (seg.caseId) casos.push(seg.caseId);
    if (!["cancelado", "cerrado_r6", "baja"].includes(seg.estado)) {
      seg.estado = "baja";
      registrarResultadoPresu(seg.ref, `baja_cliente (${motivo})`);
    }
  }
  guardarSeguimientosPresu();
  // Encuesta pendiente: no se le vuelve a preguntar
  for (const c of Object.keys(resenasEnCurso)) if (claveBaja(c) === k) delete resenasEnCurso[c];
  redisSet("iberica:resenasEnCurso", resenasEnCurso);
  for (const caseId of new Set(casos)) {
    crearNotaParte(caseId, `Seguimiento presupuesto (Marta): el cliente pide la BAJA (${motivo}). No se le vuelve a escribir. Respuesta: "${String(texto || "").slice(0, 200)}". Poner [NOCOM] en FactuSOL.`);
  }
  // Campañas: se cierra su conversación y se marca en Zoho (WhatsApp Opt Out)
  if (campanas.conversaciones[k]) { campanas.conversaciones[k].cerrada = Date.now(); guardarCampanas(); }
  if (nueva) marcarOptOutZoho(k).then((r) => { if (bajas[k]) { bajas[k].zohoOptOut = r; guardarBajas(); } });
  if (nueva) {
    console.log(`[Bajas] ${k} dado de baja (${motivo}, ${origen})`);
    const ahoraStr = new Date().toLocaleString("es-ES", { timeZone: "Europe/Madrid", hour12: false });
    await enviarNotificacionAgente(destinatarioPresupuestos(), {
      nombre: conversaciones[telefono]?.nombre || k,
      telefono: k,
      direccion: "—",
      descripcion: motivo === "borrado_datos"
        ? `🔒 PROTECCIÓN DE DATOS: pide BORRAR sus datos (plazo legal: 1 mes). Avisar a quien lleve la protección de datos. Ya está de baja. Mensaje: "${String(texto || "").slice(0, 100)}"`
        : `🚫 BAJA de mensajes (${motivo}): "${String(texto || "").slice(0, 120)}". No escribirle más y poner [NOCOM] en FactuSOL.`,
      apertura: ahoraStr,
      refParte: "—",
      agente: "Marta · Bajas",
    }).catch((e) => console.error("[Bajas] Aviso:", e.message));
  }
  return nueva;
}

// ══════════════════════════════════════════════════════════════════
// CONSENTIMIENTO para mensajes comerciales por WhatsApp
// Se pide en la encuesta postventa, tras una buena nota. Se guarda la
// fecha, la pregunta exacta y lo que contestó: es la prueba ante
// protección de datos. La BAJA manda siempre sobre el consentimiento.
// ══════════════════════════════════════════════════════════════════
const CONSENT_ESPERA_MS = parseInt(process.env.CONSENT_ESPERA_MS || "4000", 10);
const consentimientos = {}; // { "611222333": { ts, respuesta: "si"|"no", texto, pregunta, origen, refParte } }
function guardarConsentimientos() { redisSet("iberica:consentimientos", consentimientos); }
function tieneConsentimiento(telefono) {
  const k = claveBaja(telefono);
  return consentimientos[k]?.respuesta === "si" && !esBaja(k);
}
const PREGUNTA_CONSENTIMIENTO = "Una última cosa: ¿te parece bien que te escribamos por aquí de vez en cuando, como mucho 4 veces al año, con revisiones y avisos de temporada? Responde SÍ o NO. Puedes darte de baja cuando quieras escribiendo BAJA.";

// SÍ / NO claros; cualquier otra cosa no cuenta como respuesta
function respuestaConsentimiento(texto) {
  const t = normalizaTxt(texto).replace(/[¡!¿?.,;:"'()*_~]/g, " ").replace(/\s+/g, " ").trim();
  if (/^(si|sii+|si si|vale|ok|okey|claro|por supuesto|de acuerdo|perfecto|adelante|sin problema|bueno|venga|👍|👌)( (claro|vale|gracias|perfecto|sin problema|por supuesto|me parece bien|porfa|por favor))*( 👍| 🙂| 😊)?$/.test(t) ||
      /^(si|vale|ok|claro)\b.{0,40}\b(me parece bien|podeis|escribid|sin problema)/.test(t)) return "si";
  if (/^(no|nop|no gracias|no no|mejor no|prefiero que no|no hace falta|no me interesa|para nada)( gracias| por ahora| de momento)?( 🙏| 🙂)?$/.test(t)) return "no";
  return null;
}

function registrarConsentimiento(telefono, respuesta, texto, { origen = "encuesta", refParte = null } = {}) {
  const k = claveBaja(telefono);
  if (k.length !== 9) return;
  consentimientos[k] = { ts: Date.now(), respuesta, texto: String(texto || "").slice(0, 200), pregunta: PREGUNTA_CONSENTIMIENTO, origen, refParte };
  guardarConsentimientos();
  console.log(`[Consentimiento] ${k}: ${respuesta} (${origen})`);
}

const RESPUESTA_BAJA = {
  baja: "Hecho 🙏 No te volveremos a escribir con seguimientos ni avisos. Si algún día nos necesitas, escríbenos por aquí y te atendemos encantados.",
  enfado: "Perdona las molestias. Te hemos dado de baja y no volverás a recibir mensajes nuestros.",
  fallecimiento: "Lo sentimos mucho, y perdona la molestia. No volveremos a escribir a este número.",
  borrado_datos: "Entendido. Te damos de baja ahora mismo y pasamos tu petición de borrado de datos a la persona responsable, que te contestará en el plazo legal (un mes como máximo).",
};

// Envío genérico de una plantilla aprobada de Meta al chat de un cliente
// (requiere conversaciones[telefono] con memberId/channelId ya puestos).
// Si Meta rechaza una plantilla (borrada, editada, en revisión...), avisa
// al equipo en el momento: una vez por plantilla cada 24 h. Antes, una
// plantilla rota pasaba días sin que nadie se enterara.
const alertasPlantilla = {}; // { nombre: ts del último aviso }
async function alertarPlantillaRota(nombre, detalle) {
  // Solo errores de la PLANTILLA (códigos 132xxx de Meta: no existe, pausada,
  // desactivada, parámetros...). Un fallo de un cliente concreto (número sin
  // WhatsApp, etc.) no es una plantilla rota.
  if (!/\b132\d{3}\b/.test(String(detalle || ""))) return;
  if (Date.now() - (alertasPlantilla[nombre] || 0) < 24 * 3600 * 1000) return;
  alertasPlantilla[nombre] = Date.now();
  console.error(`[Plantilla] 🚨 ${nombre} rota — aviso al equipo`);
  try {
    const dest = String(nombre).startsWith("seguimiento_presupuesto") ? destinatarioPresupuestos() : determinarDestinatarioNotificacion();
    const ahoraStr = new Date().toLocaleString("es-ES", { timeZone: "Europe/Madrid", hour12: false });
    await enviarNotificacionAgente(dest, {
      nombre: "AVISO DEL BOT",
      telefono: "—",
      direccion: "—",
      descripcion: `La plantilla de WhatsApp "${nombre}" ha dejado de funcionar y Marta no puede enviar esos mensajes. Revisarla en WhatsApp Manager. Error: ${String(detalle || "").slice(0, 120)}`,
      apertura: ahoraStr, refParte: "—", agente: "Bot (plantillas)",
    });
  } catch (e) { console.error("[Plantilla] No se pudo avisar de la plantilla rota:", e.message); }
}
async function enviarPlantillaWoztell(telefono, elementName, parametros, idioma = "es") {
  const estado = conversaciones[telefono];
  try {
    const res = await axios.post(
      `https://bot.api.woztell.com/sendResponses?accessToken=${process.env.WOZTELL_TOKEN}`,
      {
        channelId: estado.channelId,
        memberId:  estado.memberId,
        response: [{
          type: "TEMPLATE",
          elementName,
          languageCode: idioma,
          components: [{ type: "body", parameters: (parametros || []).map((t) => ({ type: "text", text: String(t) })) }],
        }],
      }
    );
    registrarWamidsEnvio(res.data);
    const ok = res.data?.ok === 1 && res.data?.sendResult?.result?.[0]?.ok !== 0;
    if (!ok) console.error(`[Plantilla] ❌ ${elementName} rechazada:`, JSON.stringify(res.data).slice(0, 300));
    const wamid = res.data?.sendResult?.result?.[0]?.messageEvent?.messageId || res.data?.sendResult?.result?.[0]?.result?.messages?.[0]?.id || null;
    return { ok, wamid, detalle: ok ? null : JSON.stringify(res.data?.sendResult?.result?.[0] || res.data).slice(0, 300) };
  } catch (e) {
    console.error(`[Plantilla] ❌ Error enviando ${elementName}:`, e.response?.data || e.message);
    return { ok: false, detalle: JSON.stringify(e.response?.data || e.message).slice(0, 300) };
  }
}

// Deja constancia de la respuesta de la encuesta en el propio parte del CRM
// (Notas del módulo Partes), para no perder la información que daba PERE.
// El título de la nota sale del tema: seguimiento de presupuesto o encuesta
function tituloNota(contenido) {
  return /^Seguimiento presupuesto/.test(String(contenido)) ? "Seguimiento presupuesto (Marta)" : "Encuesta postventa (Marta)";
}

async function crearNotaParte(caseId, contenido) {
  if (!caseId) return;
  try {
    const token = await obtenerTokenZoho();
    await axios.post(
      "https://www.zohoapis.eu/crm/v2/Notes",
      { data: [{ Note_Title: tituloNota(contenido), Note_Content: contenido, Parent_Id: caseId, se_module: "Cases" }] },
      { headers: { Authorization: `Zoho-oauthtoken ${token}`, "Content-Type": "application/json" } }
    );
    console.log(`[Reseñas] Respuesta registrada como nota en el parte ${caseId}`);
  } catch (e) {
    console.error("[Reseñas] No se pudo registrar la nota en Zoho:", JSON.stringify(e.response?.data || e.message).slice(0, 200));
  }
}

async function pedirResena({ telefono, nombre, refParte, caseId }) {
  let clave = claveClientePorTelefono(telefono);
  const act     = clave ? (actividad[clave] || {}) : {};
  let memberId  = clave ? (conversaciones[clave]?.memberId  || act.memberId) : null;
  let channelId = clave ? (conversaciones[clave]?.channelId || act.canalId)  : null;
  let enFrio    = false;

  // Cliente que nunca ha escrito: clave normalizada a partir del teléfono
  // de Zoho (9 dígitos = número español sin prefijo)
  if (!clave) {
    const d = String(telefono || "").replace(/\D/g, "");
    if (d.length < 9) return { ok: false, motivo: "telefono_invalido_en_zoho" };
    clave = d.length === 9 ? `34${d}` : d;
  }
  if (!telefonoValido(clave)) return { ok: false, motivo: "telefono_invalido_en_zoho" };
  if (esBaja(clave)) return { ok: false, motivo: "cliente_dado_de_baja" };
  // No interrumpir si una persona de la oficina está atendiendo el chat AHORA.
  // Ojo: con el auto-takeover casi todos los clientes activos acaban con una
  // pausa de 6h (la oficina remata el trabajo por WhatsApp justo antes de
  // cerrar el parte). Esa pausa NO debe tragarse la encuesta: si la última
  // intervención humana ya está "fría" (>2h), se envía igualmente — el flujo
  // de reseña funciona aunque el chat siga en pausa. Solo bloquean la pausa
  // manual indefinida (panel/handoff) y una intervención reciente, y esas se
  // reintentan en los siguientes sondeos (reintentable).
  const claveBot = `${channelId}_${clave}`;
  if (botActivo[claveBot] === false) {
    const expira = pausaExpira[claveBot];
    const intervinoHace = expira ? Date.now() - (expira - PAUSA_TAKEOVER_H * 3600 * 1000) : 0;
    if (!expira || intervinoHace < 2 * 3600 * 1000) {
      return { ok: false, motivo: "conversacion_atendida_por_persona", reintentable: true };
    }
  }
  // No insistir si ya se le pidió hace poco
  if (Date.now() - (resenasPedidas[clave] || 0) < 7 * 24 * 3600 * 1000) {
    return { ok: false, motivo: "ya_pedida_recientemente" };
  }

  // Sin chat conocido → envío en frío: buscar/crear el member en el canal
  // principal y mandar la plantilla. TODOS los partes terminados llevan
  // encuesta, también los de clientes que nunca han escrito al WhatsApp.
  if (!memberId || !channelId) {
    if (!process.env.RESENA_TEMPLATE) return { ok: false, motivo: "sin_whatsapp_y_sin_plantilla_configurada" };
    const canalPrincipal = process.env.WOZTELL_CHANNEL_ID;
    if (!canalPrincipal) return { ok: false, motivo: "WOZTELL_CHANNEL_ID_no_configurado" };
    try {
      const r = await buscarOCrearMiembroWoztell(canalPrincipal, clave, nombre);
      memberId  = r.memberId;
      channelId = canalPrincipal;
      enFrio    = true;
      console.log(`[Reseñas] Member ${r.creado ? "CREADO" : "encontrado"} en Woztell para ${clave} (envío en frío, parte ${refParte || "—"})`);
    } catch (e) {
      return { ok: false, motivo: "no_se_pudo_crear_contacto", detalle: String(e.message).slice(0, 300), reintentable: true };
    }
  }

  // Texto libre solo dentro de la ventana de 24h; fuera, plantilla aprobada
  const fueraDeVentana = enFrio || !act.ultimaActividad || Date.now() - act.ultimaActividad > 23 * 3600 * 1000;
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
    const tpl = await enviarPlantillaResena(clave, nombreCorto);
    if (!tpl.ok) {
      estado.step = "menu_principal";
      alertarPlantillaRota(process.env.RESENA_TEMPLATE, tpl.detalle);
      return { ok: false, motivo: "plantilla_fallida", detalle: tpl.detalle, reintentable: true };
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
  resenasEnCurso[clave] = { refParte: refParte || null, caseId: caseId || null, ts: Date.now() };
  redisSet("iberica:resenasEnCurso", resenasEnCurso);
  const via = enFrio ? "plantilla_en_frio" : (fueraDeVentana ? "plantilla" : "chat");
  console.log(`[Reseñas] Encuesta postventa enviada a ${clave} (parte ${refParte || "—"}, ${via})`);
  return { ok: true, telefono: clave, via };
}

// ¿El parte viene de una compañía de seguros? El nombre técnico del campo
// varía según cómo se creara en Zoho ("Compañía de seguros" → p. ej.
// "Compa_a_de_seguros"), así que se busca por aproximación cualquier campo
// cuyo nombre hable de compañía de seguros/aseguradora y tenga valor.
function parteDeAseguradora(caso) {
  const vacios = new Set(["", "no", "ninguna", "ninguno", "false", "-", "—", "n/a", "null"]);
  return Object.entries(caso || {}).some(([campo, valor]) => {
    const n = campo.toLowerCase();
    const esCampoSeguro = (n.includes("compa") && n.includes("segur")) || n.includes("asegurador");
    if (!esCampoSeguro || valor == null) return false;
    const texto = typeof valor === "object" ? (valor.name || valor.id || "sí") : String(valor);
    return !vacios.has(texto.trim().toLowerCase());
  });
}

// ── Sondeo de partes cerrados (sin tocar el CRM) ─────────────
// Cada 5 minutos el bot pregunta a Zoho por los últimos partes modificados;
// los que hayan pasado a "Cerrado" en las últimas horas disparan la
// encuesta postventa. Desactivable con RESENAS_AUTO=off en Railway.
const cierresProcesados = {}; // { caseId: ts en que se registró }
let sondeoEnCurso = false;

// Historial persistente de intentos de encuesta (diagnóstico): qué pasó con
// cada parte cerrado — enviada, sin teléfono, chat atendido por persona...
// Visible en /admin/api/resenas-stats. Sin esto, los motivos de descarte
// solo vivían en el log del momento y no había forma de auditarlos.
let resenasHistorial = []; // [{ ts, parte, resultado }]
function registrarResultadoResena(parte, resultado) {
  // Un reintento con el mismo desenlace actualiza la entrada existente (con
  // contador) en vez de duplicarla: si dos partes se reintentan alternados
  // cada 5 min, el historial no debe inundarse.
  const idx = resenasHistorial.findIndex((h) => h.parte === parte && h.resultado === resultado);
  if (idx !== -1) {
    const entrada = resenasHistorial.splice(idx, 1)[0];
    entrada.ts = new Date().toISOString();
    entrada.veces = (entrada.veces || 1) + 1;
    resenasHistorial.unshift(entrada);
  } else {
    resenasHistorial.unshift({ ts: new Date().toISOString(), parte, resultado });
    if (resenasHistorial.length > 100) resenasHistorial.pop();
  }
  redisSet("iberica:resenasHistorial", resenasHistorial);
}

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
    // Radiografía de lo que ve el sondeo (para diagnóstico en /admin/api/test-cierres):
    // estados y subestados reales de los últimos partes modificados.
    resumen.muestra = casos.map((c) => ({
      ref: c.ref_Parte || c.id,
      estado: c.Status || null,
      subestado: c.Subestado || null,
      modificado: c.Modified_Time || null,
      aseguradora: parteDeAseguradora(c) || undefined,
      yaProcesado: !!cierresProcesados[c.id] || undefined,
    }));
    const limite = Date.now() - 3 * 3600 * 1000; // solo cierres de las últimas 3h
    // Misma condición que la regla "Encueste pere" del CRM: solo trabajo
    // terminado de verdad. OJO: en Zoho el subestado es UN valor literal
    // "Acabado / Solucionado" — se comprueba por contenido para cubrir esa
    // forma y cualquier variante (Acabado, Solucionado, con/sin espacios).
    for (const caso of casos) {
      if (caso.Status !== "Cerrado") continue;
      const sub = normalizaTxt(caso.Subestado || "");
      if (!sub.includes("acabado") && !sub.includes("solucionado")) continue;
      if (cierresProcesados[caso.id]) continue;
      cierresProcesados[caso.id] = Date.now();
      const modificado = new Date(caso.Modified_Time || 0).getTime();
      if (!modificado || modificado < limite) continue; // cierre antiguo: registrar sin escribir
      // Partes de compañías de seguros: encuestables por defecto (son la
      // mayoría del volumen y su NPS histórico es excelente). Si algún día
      // se quiere excluirlos, basta con RESENAS_EXCLUIR_ASEGURADORAS=on en
      // Railway — sin tocar código.
      if ((process.env.RESENAS_EXCLUIR_ASEGURADORAS || "off").toLowerCase() === "on" && parteDeAseguradora(caso)) {
        console.log(`[Reseñas] Parte ${caso.ref_Parte || caso.id} omitido: viene de compañía de seguros`);
        resumen.encuestas.push({ parte: caso.ref_Parte || caso.id, resultado: "omitido_aseguradora" });
        registrarResultadoResena(caso.ref_Parte || caso.id, "omitido_aseguradora");
        continue;
      }
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
        registrarResultadoResena(caso.ref_Parte || caso.id, "sin_telefono_en_zoho");
        continue;
      }
      const r = await pedirResena({ telefono: telefonoCli, nombre: nombreCli, refParte: caso.ref_Parte, caseId: caso.id });
      const resultado = r.ok ? `enviada_por_${r.via}` : (r.detalle ? `${r.motivo}: ${r.detalle}` : r.motivo);
      resumen.encuestas.push({ parte: caso.ref_Parte || caso.id, resultado });
      registrarResultadoResena(caso.ref_Parte || caso.id, resultado);
      // Descartes temporales (p. ej. la oficina acaba de escribir en el chat):
      // desmarcar el cierre para que el siguiente sondeo lo reintente mientras
      // siga dentro de la ventana de 3h.
      if (!r.ok && r.reintentable) delete cierresProcesados[caso.id];
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

// ============================================================
// SEGUIMIENTO DE PRESUPUESTOS (Marta comercial)
// ============================================================
// Trazabilidad en Zoho: Estado "Presupuesto" + Subestado "enviado" (se
// comparan por contenido normalizado, como en reseñas: los literales
// reales del CRM pueden variar). Protocolo comercial 3-8-11 con máximo
// dos toques, siempre por plantilla aprobada y en horario comercial:
//   día 3  → toque 1 ("¿pudiste verlo? ¿dudas?")
//   día 8  → toque 2 (recordatorio suave con salida fácil)
//   día 11 → sin respuesta: aviso al equipo para llamada comercial y fin
// Cualquier respuesta del cliente detiene la cadencia: Marta la clasifica
// (acepta / precio / se lo piensa / rechaza / duda), contesta según el
// manual de objeciones (sin presionar, líneas rojas de marca), lo anota
// en el parte y avisa al equipo cuando toca. Si una persona de la
// oficina interviene en el chat, el seguimiento se cancela.
// Interruptor: PRESU_AUTO=on + plantillas PRESU_TEMPLATE / PRESU_TEMPLATE2.

const seguimientosPresu = {}; // { caseId: { ref, clave, nombre, tipo, importe, enviadoTs, enviados, ultimoMensajeTs, estado, avisos, ... } }
function guardarSeguimientosPresu() { redisSet("iberica:seguimientosPresu", seguimientosPresu); }

let presuHistorial = []; // [{ ts, ref, resultado, veces? }] — diagnóstico persistente
function registrarResultadoPresu(ref, resultado) {
  const idx = presuHistorial.findIndex((h) => h.ref === ref && h.resultado === resultado);
  if (idx !== -1) {
    const e = presuHistorial.splice(idx, 1)[0];
    e.ts = new Date().toISOString();
    e.veces = (e.veces || 1) + 1;
    presuHistorial.unshift(e);
  } else {
    presuHistorial.unshift({ ts: new Date().toISOString(), ref, resultado });
    if (presuHistorial.length > 100) presuHistorial.pop();
  }
  redisSet("iberica:presuHistorial", presuHistorial);
}

// ── Protocolo de seguimiento de presupuestos (versión del 15/10/2026) ──
// "Marta escribe, María llama y la oficina cierra en Zoho y FactuSOL."
// Calendario por tipo de cliente, en días desde que el presupuesto pasa a
// Presupuesto / Enviado. `marta` = días en que Marta escribe por WhatsApp
// (a partir de las 9:30, L-V). Lo demás lo hace María (llamadas, emails a
// tramitadores, cierre con R6) y Marta se lo recuerda en una agenda diaria
// a las 10:00.
const diasDe = (txt, porDefecto) => String(txt || porDefecto).split(",").map((x) => parseInt(x)).filter((x) => x >= 0);
const PLANES_PRESU = {
  particular: { marta: diasDe(process.env.PRESU_PLAN_PARTICULAR, "2,5,10"), emails: [], llamada7: true, cierre: 45 },
  empresa:    { marta: diasDe(process.env.PRESU_PLAN_EMPRESA, "2,7,14,21"), emails: [], llamada7: true, cierre: 45 },
  comunidad:  { marta: diasDe(process.env.PRESU_PLAN_COMUNIDAD, "3,10,30,45,60"), emails: [], llamada7: false, cierre: 90 },
  // Compañías: sin Marta. Email de María al TRAMITADOR, nunca al asegurado.
  compania:   { marta: [], emails: [3, 10, 20], llamada7: false, cierre: 45 },
};
const PRESU_IMPORTE_LLAMADA = parseFloat(process.env.PRESU_IMPORTE_LLAMADA || "500"); // > 500 € → María llama también el día 7
const PRESU_DIAS_LLAMADA_FIN = 2; // María llama 2 días después del último mensaje de Marta
// Días de retraso máximo de un mensaje que no se ha podido enviar (chat en
// pausa, plantilla rechazada…) antes de pasárselo a una persona.
const PRESU_DIAS_RETRASO_MAX = parseInt(process.env.PRESU_DIAS_RETRASO_MAX || "3");
const presuActivo = () => (process.env.PRESU_AUTO || "off").toLowerCase() === "on";

// Estados de un seguimiento que siguen vivos (la agenda los revisa):
//   en_curso         → Marta escribe según el calendario
//   fin_marta        → Marta mandó todos sus mensajes sin respuesta
//   respondido       → el cliente contestó; María sigue
//   volver_a_llamar  → "me lo pienso" con fecha: María llama ese día
//   atendido_persona → alguien de la oficina escribió en el chat
//   no_enviable      → un mensaje de Marta no pudo salir en 3 días
//   compania         → presupuesto de compañía: sin Marta
// Finales: cancelado (cambió de estado en Zoho, o sin teléfono válido) y
// cerrado_r6 (la agenda pidió cerrarlo con R6 al llegar al día 45 o 90).
const PRESU_ESTADOS_VIVOS = ["en_curso", "fin_marta", "respondido", "volver_a_llamar", "atendido_persona", "no_enviable", "compania"];

function esCasoPresupuestoEnviado(caso) {
  return normalizaTxt(caso?.Status || "").includes("presupuesto") &&
         normalizaTxt(caso?.Subestado || "").includes("enviado");
}

// Tipo de cliente del presupuesto, por el campo "Origen del Parte" de Zoho:
//   Compañía de Seguros → compania · Administrador de Fincas → comunidad
//   Teléfono, Tienda, Recomendación de terceros → particular (siempre)
// PRESU_CAMPO_TIPO fuerza otro campo. Si el origen está vacío (-None-), se
// deduce: compañía (mismo criterio que reseñas), comunidad o empresa por el
// nombre, y particular en el resto. Comprobable en /admin/api/presupuestos-tipos.
function campoOrigenParte(caso) {
  const campo = process.env.PRESU_CAMPO_TIPO || Object.keys(caso || {}).find((k) => /origen/i.test(k));
  const v = campo ? caso[campo] : null;
  return v ? normalizaTxt(typeof v === "object" ? (v.name || "") : String(v)) : "";
}

function tipoClientePresu(caso, contacto = {}) {
  const v = campoOrigenParte(caso);
  if (v && v !== "-none-") {
    if (v.includes("compa") || v.includes("segur")) return "compania";
    if (v.includes("administrador") || v.includes("finca") || v.includes("comunidad")) return "comunidad";
    if (v.includes("empresa")) return "empresa";
    if (/telefono|tienda|recomendacion|particular/.test(v)) return "particular";
  }
  if (parteDeAseguradora(caso)) return "compania";
  const nombres = normalizaTxt([caso?.Related_To?.name, caso?.Account_Name?.name, contacto.Account_Name?.name, contacto.Full_Name]
    .filter(Boolean).join(" | "));
  if (/(comunidad|\bcdad\b|\bc\.\s?p\.|\bccpp\b|propietarios|administracion de fincas|administrador)/.test(nombres)) return "comunidad";
  if (/(\bs\.?\s?l\.?u?\b|\bs\.\s?a\.?\b|\bsociedad\b|\binvestments?\b|real estate|\bgrupo\b|\bhotel\b)/.test(nombres)) return "empresa";
  return "particular";
}

// Importe del presupuesto. El campo "Importe" del parte NO sirve (ahí va lo
// facturado para el informe diario), así que se lee, por este orden:
//   1. PRESU_CAMPO_IMPORTE, si algún día hay un campo propio
//   2. la nota más reciente de la oficina con el importe ("Presupuesto: 850 €")
//   3. la descripción del parte, solo si pone "presupuesto/importe/total: X"
// En una nota manda la cantidad que va tras "presupuesto", "importe" o
// "total"; si no hay, la mayor cantidad en euros.
function leerCantidad(v) {
  const t = String(v).replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  const n = parseFloat(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function cantidadEnTexto(texto, soloConClave = false) {
  const txt = String(texto || "");
  const num = String.raw`(\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?`;
  const conClave = [...txt.matchAll(new RegExp(String.raw`(?:presupuesto|importe|total)[^\d\n]{0,20}?` + num, "gi"))]
    .map((m) => leerCantidad(m[0].replace(/^\D+/, ""))).filter(Boolean);
  if (conClave.length) return conClave.at(-1);
  if (soloConClave) return null;
  const euros = [...txt.matchAll(new RegExp(num + String.raw`\s?(?:€|eur(?:os)?\b)`, "gi"))].map((m) => leerCantidad(m[0])).filter(Boolean);
  return euros.length ? Math.max(...euros) : null;
}

function importePresu(caso, notas = []) {
  const campo = process.env.PRESU_CAMPO_IMPORTE;
  if (campo && caso?.[campo] != null) { const n = leerCantidad(caso[campo]); if (n) return n; }
  const deOficina = (notas || [])
    .filter((n) => !/\(Marta\)/.test(n.Note_Title || "") && !/^(Seguimiento presupuesto|Encuesta postventa)/.test(n.Note_Content || ""))
    .sort((x, y) => String(y.Created_Time || "").localeCompare(String(x.Created_Time || "")));
  for (const n of deOficina) {
    const texto = `${n.Note_Title || ""} ${n.Note_Content || ""}`;
    if (!/presupuesto|importe|total|€|eur/i.test(texto)) continue;
    const c = cantidadEnTexto(texto);
    if (c) return c;
  }
  // En la descripción suele haber otros precios: solo con "presupuesto/importe/total"
  return cantidadEnTexto(caso?.Description, true);
}

async function notasDelParte(caseId, token) {
  if (!caseId) return [];
  try {
    const r = await axios.get(`https://www.zohoapis.eu/crm/v2/Cases/${caseId}/Notes`, { headers: { Authorization: `Zoho-oauthtoken ${token}` } });
    return r.data?.data || [];
  } catch (e) {
    if (e.response?.status !== 204) console.error("[Presupuestos] Notas del parte:", e.message);
    return [];
  }
}

// Si el importe no estaba al registrar el seguimiento (la oficina pone la
// nota después), se vuelve a mirar antes de decidir la llamada del día 7.
async function refrescarImportePresu(seg) {
  try {
    const token = await obtenerTokenZoho();
    const r = await axios.get(`https://www.zohoapis.eu/crm/v2/Cases/${seg.caseId}`, { headers: { Authorization: `Zoho-oauthtoken ${token}` } });
    const caso = r.data?.data?.[0];
    if (!caso) return;
    const importe = importePresu(caso, await notasDelParte(seg.caseId, token));
    if (importe) { seg.importe = importe; guardarSeguimientosPresu(); }
  } catch (e) { console.error("[Presupuestos] Refrescar importe:", e.message); }
}

// Seguimientos creados con el protocolo anterior (toques 1-2-3) → modelo
// actual. Los que ya iban por la mitad no reciben más mensajes atrasados:
// si su siguiente mensaje ya pasó, terminan en fin_marta (llamada de María).
function normalizarSegPresu(seg) {
  if (seg.version === 2) return seg;
  seg.version = 2;
  seg.tipo = seg.tipo || "particular";
  seg.avisos = seg.avisos || {};
  const previos = { toque1: 1, toque2: 2, toque3: 3 };
  if (previos[seg.estado]) {
    seg.enviados = previos[seg.estado];
    seg.ultimoMensajeTs = seg.toque3Ts || seg.toque2Ts || seg.toque1Ts;
    seg.estado = "en_curso";
    seg.migrado = true;
  } else if (seg.estado === "pendiente") {
    seg.estado = "en_curso";
  } else if (seg.estado === "aplazado") {
    seg.estado = "volver_a_llamar";
    seg.volverLlamarTs = seg.recontactoTs;
  } else if (seg.estado === "cerrado_sin_respuesta") {
    seg.estado = "fin_marta";
    seg.avisos.llamada_fin = true; // ya se avisó con el protocolo anterior
  }
  seg.enviados = seg.enviados || (seg.toque1Ts ? 1 : 0);
  return seg;
}

// Marta escribe L-V de 9:30 a 19:00 (hora de Madrid)
// Laborable en Almería: ni fin de semana ni festivo
function esLaborable(fecha) {
  const dia = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Madrid", weekday: "short" }).format(fecha);
  return dia !== "Sat" && dia !== "Sun" && !FESTIVOS_ALMERIA[diaMadrid(fecha)];
}

// Si la fecha cae en fin de semana o festivo, la pasa al siguiente laborable
function laborableDesde(fecha) {
  let f = new Date(fecha.getTime());
  for (let i = 0; i < 10 && !esLaborable(f); i++) f = new Date(f.getTime() + 24 * 3600 * 1000);
  return f;
}

function dentroVentanaComercial() {
  const ahora = new Date();
  if (!esLaborable(ahora)) return false;
  const m = minutosActualesMadrid();
  return m >= 9 * 60 + 30 && m <= 19 * 60;
}

// Sondeo: detectar partes recién pasados a Presupuesto/enviado y registrar
// el seguimiento. También cierra los que cambiaron de estado en el CRM.
//
// "A PARTIR DE HOY": en su primera ejecución el circuito graba su fecha de
// arranque (Redis) y solo sigue presupuestos modificados DESPUÉS de ese
// momento. El histórico anterior no se toca — nada de escribir de golpe a
// clientes con presupuestos del mes pasado.
let presuArranque = null;
let sondeoPresuEnCurso = false;
async function sondearPresupuestosEnviados() {
  if (!presuActivo()) return { ok: false, motivo: "desactivado_por_PRESU_AUTO" };
  if (sondeoPresuEnCurso) return { ok: false, motivo: "sondeo_ya_en_curso" };
  sondeoPresuEnCurso = true;
  const resumen = { vistos: 0, nuevos: 0, cancelados: 0, muestra: [] };
  try {
    if (!presuArranque) {
      presuArranque = await redisGet("iberica:presuArranque");
      if (!presuArranque) {
        presuArranque = Date.now();
        redisSet("iberica:presuArranque", presuArranque);
        console.log("[Presupuestos] Arranque del circuito registrado — solo se siguen presupuestos desde ahora");
      }
    }
    const token = await obtenerTokenZoho();
    const res = await axios.get("https://www.zohoapis.eu/crm/v2/Cases", {
      params: { sort_by: "Modified_Time", sort_order: "desc", per_page: 30 },
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
    });
    const casos = res.data?.data || [];
    resumen.vistos = casos.length;
    resumen.muestra = casos.slice(0, 10).map((c) => ({
      ref: c.ref_Parte || c.id, estado: c.Status || null, subestado: c.Subestado || null,
    }));
    for (const caso of casos) {
      const seg = seguimientosPresu[caso.id];
      if (seg) normalizarSegPresu(seg);
      if (!esCasoPresupuestoEnviado(caso)) {
        // Si estaba en seguimiento y el CRM ya cambió de estado (aceptado,
        // rechazado, cerrado...), se cierra en silencio y se guarda a qué pasó.
        if (seg && PRESU_ESTADOS_VIVOS.includes(seg.estado)) {
          seg.estado = "cancelado";
          seg.estadoFinalCrm = `${caso.Status || "?"} / ${caso.Subestado || "—"}`;
          resumen.cancelados++;
          registrarResultadoPresu(seg.ref, `cancelado_cambio_de_estado_en_crm: ${seg.estadoFinalCrm}`);
          guardarSeguimientosPresu();
        }
        continue;
      }
      if (seg) continue; // ya registrado
      const enviadoTs = new Date(caso.Modified_Time || 0).getTime() || Date.now();
      if (enviadoTs < presuArranque) continue;                      // anterior al arranque: no se toca
      if (Date.now() - enviadoTs > 14 * 24 * 3600 * 1000) continue; // demasiado antiguo
      // Contacto vinculado: teléfono, nombre y empresa
      let telefonoCli = null;
      let nombreCli   = caso.Related_To?.name || null;
      let contacto    = {};
      try {
        if (caso.Related_To?.id) {
          const c = await axios.get(`https://www.zohoapis.eu/crm/v2/Contacts/${caso.Related_To.id}`, {
            headers: { Authorization: `Zoho-oauthtoken ${token}` },
          });
          contacto    = c.data?.data?.[0] || {};
          telefonoCli = contacto.Mobile || contacto.Phone || null;
          nombreCli   = contacto.First_Name || contacto.Full_Name || nombreCli;
        }
      } catch (e) { console.error("[Presupuestos] Contacto:", e.message); }
      const ref = caso.ref_Parte || caso.id;
      const base = {
        version: 2, caseId: caso.id, ref, nombre: nombreCli, enviadoTs,
        tipo: tipoClientePresu(caso, contacto), importe: importePresu(caso, await notasDelParte(caso.id, token)),
        enviados: 0, avisos: {},
      };
      // Compañía: sin Marta (no se escribe nunca al asegurado). Solo agenda
      // de María: emails al tramitador y cierre con R6.
      if (base.tipo === "compania") {
        seguimientosPresu[caso.id] = { ...base, estado: "compania" };
        resumen.nuevos++;
        registrarResultadoPresu(ref, "seguimiento_programado_compania_sin_marta");
        guardarSeguimientosPresu();
        continue;
      }
      if (!telefonoCli) {
        seguimientosPresu[caso.id] = { ...base, estado: "cancelado" };
        registrarResultadoPresu(ref, "sin_telefono_en_zoho");
        guardarSeguimientosPresu();
        continue;
      }
      const d = String(telefonoCli).replace(/\D/g, "");
      const clave = claveClientePorTelefono(telefonoCli) || (d.length === 9 ? `34${d}` : d);
      if (!telefonoValido(clave)) {
        seguimientosPresu[caso.id] = { ...base, estado: "cancelado" };
        registrarResultadoPresu(ref, `telefono_invalido_en_zoho: ${telefonoCli}`);
        guardarSeguimientosPresu();
        continue;
      }
      if (esBaja(clave)) {
        seguimientosPresu[caso.id] = { ...base, telefono: telefonoCli, clave, estado: "baja" };
        registrarResultadoPresu(ref, "cliente_dado_de_baja_sin_marta");
        guardarSeguimientosPresu();
        continue;
      }
      seguimientosPresu[caso.id] = { ...base, telefono: telefonoCli, clave, estado: "en_curso" };
      resumen.nuevos++;
      registrarResultadoPresu(ref, `seguimiento_programado_${base.tipo}`);
      guardarSeguimientosPresu();
      console.log(`[Presupuestos] Seguimiento programado: ${ref} (${clave}, ${base.tipo}${base.importe ? `, ${base.importe} €` : ""})`);
    }
    return { ok: true, ...resumen };
  } catch (e) {
    console.error("[Presupuestos] Sondeo falló:", e.message);
    return { ok: false, motivo: `error: ${e.message}` };
  } finally {
    sondeoPresuEnCurso = false;
  }
}

// Plantilla de cada mensaje de Marta según su posición en el calendario:
// el primero, PRESU_TEMPLATE; el último (si hay 3 o más), la de "¿has
// aparcado el presupuesto?" (PRESU_TEMPLATE3) si está activada; los de en
// medio, PRESU_TEMPLATE2 (en comunidades, PRESU_TEMPLATE_COMUNIDAD si existe).
// Plantilla «¿has aparcado el presupuesto?», aprobada en Meta. Por defecto,
// activada; PRESU_TEMPLATE3=off la desactiva (el último mensaje usa la 2).
const PRESU_PLANTILLA_APARCADO = (process.env.PRESU_TEMPLATE3 || "seguimiento_presupuesto_aparcado").trim() === "off"
  ? null : (process.env.PRESU_TEMPLATE3 || "seguimiento_presupuesto_aparcado").trim();

function plantillaPresu(tipo, indice, total) {
  const t1 = process.env.PRESU_TEMPLATE;
  const t2 = process.env.PRESU_TEMPLATE2 || t1;
  if (indice === 0) return t1;
  if (indice === total - 1 && total >= 3 && PRESU_PLANTILLA_APARCADO) return PRESU_PLANTILLA_APARCADO;
  if (tipo === "comunidad" && process.env.PRESU_TEMPLATE_COMUNIDAD) return process.env.PRESU_TEMPLATE_COMUNIDAD;
  return t2;
}

// Envía un mensaje de Marta por plantilla aprobada. Si el cliente no tiene
// chat conocido, se crea su contacto en Woztell en el canal principal.
async function enviarToquePresu(seg, plantilla, numToque) {
  if (!plantilla) return { ok: false, motivo: "sin_plantilla_configurada" };
  const clave = seg.clave;
  if (!telefonoValido(clave)) return { ok: false, motivo: "telefono_invalido_en_zoho" };
  let memberId  = conversaciones[clave]?.memberId  || actividad[clave]?.memberId;
  let channelId = conversaciones[clave]?.channelId || actividad[clave]?.canalId;
  // Si una persona está atendiendo el chat, no molestar: se reintenta luego
  if (channelId && botPausado(`${channelId}_${clave}`)) {
    return { ok: false, motivo: "chat_atendido_por_persona", reintentar: true };
  }
  if (!memberId || !channelId) {
    const canalPrincipal = process.env.WOZTELL_CHANNEL_ID;
    if (!canalPrincipal) return { ok: false, motivo: "WOZTELL_CHANNEL_ID_no_configurado" };
    try {
      const r = await buscarOCrearMiembroWoztell(canalPrincipal, clave, seg.nombre);
      memberId = r.memberId;
      channelId = canalPrincipal;
    } catch (e) {
      return { ok: false, motivo: "no_se_pudo_crear_contacto", detalle: String(e.message).slice(0, 300), reintentar: true };
    }
  }
  if (!conversaciones[clave]) resetearConversacion(clave);
  const estado = conversaciones[clave];
  estado.memberId  = memberId;
  estado.channelId = channelId;
  estado.step  = "presu_respuesta";
  // toque 3 = "¿has aparcado el presupuesto?": el clasificador lo necesita
  // para entender que un "sí" es que lo deja
  const esAparcado = !!PRESU_PLANTILLA_APARCADO && plantilla === PRESU_PLANTILLA_APARCADO;
  estado.presu = { ref: seg.ref, caseId: seg.caseId, toque: esAparcado ? 3 : numToque };

  const nombreCorto = seg.nombre ? String(seg.nombre).trim().split(/\s+/)[0] : "de nuevo";
  const r = await enviarPlantillaConRespaldo(clave, plantilla, [nombreCorto], process.env.PRESU_TEMPLATE_LANG || "es", seg.nombre);
  if (!r.ok) {
    estado.step = "menu_principal";
    alertarPlantillaRota(plantilla, r.detalle);
    return { ok: false, motivo: "plantilla_fallida", detalle: r.detalle, reintentar: true };
  }
  seg.ultimaPlantilla = plantilla;
  return { ok: true };
}

// ¿Sigue el parte en Presupuesto / Enviado en Zoho? Si no, se cierra el
// seguimiento con el estado al que pasó. null = no se pudo comprobar.
async function presupuestoSigueEnviado(seg) {
  try {
    const token = await obtenerTokenZoho();
    const c = await axios.get(`https://www.zohoapis.eu/crm/v2/Cases/${seg.caseId}`, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
    });
    const caso = c.data?.data?.[0];
    if (caso && !esCasoPresupuestoEnviado(caso)) {
      seg.estado = "cancelado";
      seg.estadoFinalCrm = `${caso.Status || "?"} / ${caso.Subestado || "—"}`;
      guardarSeguimientosPresu();
      registrarResultadoPresu(seg.ref, `cancelado_cambio_de_estado_en_crm: ${seg.estadoFinalCrm}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[Presupuestos] Re-verificación falló:", e.message);
    return null;
  }
}

async function avisarPresu(seg, descripcion) {
  try {
    const dest = destinatarioPresupuestos();
    const ahoraStr = new Date().toLocaleString("es-ES", { timeZone: "Europe/Madrid", hour12: false });
    await enviarNotificacionAgente(dest, {
      nombre: seg.nombre || `Cliente ${String(seg.clave || "").slice(-9)}`,
      telefono: String(seg.clave || "—").slice(-9),
      direccion: "—", descripcion, apertura: ahoraStr, refParte: seg.ref, agente: "Seguimiento presupuestos",
    });
  } catch (e) { console.error("[Presupuestos] Aviso falló:", e.message); }
}

// Barrido de los mensajes de Marta: cada 30 min, en ventana comercial.
// Después, si ya son las 10:00 y no se ha enviado hoy, la agenda de María.
let barridoPresuEnCurso = false;
async function barridoToquesPresupuesto(forzarVentana) {
  if (!presuActivo()) return { ok: false, motivo: "desactivado_por_PRESU_AUTO" };
  if (barridoPresuEnCurso) return { ok: false, motivo: "barrido_ya_en_curso" };
  if (!forzarVentana && !dentroVentanaComercial()) return { ok: false, motivo: "fuera_de_ventana_comercial" };
  barridoPresuEnCurso = true;
  const resumen = { toques: [], cierres: 0 };
  try {
    const ahora = Date.now();
    const dia = 24 * 3600 * 1000;
    for (const seg of Object.values(seguimientosPresu)) {
      normalizarSegPresu(seg);
      if (seg.estado !== "en_curso") continue;
      if (esBaja(seg.clave || seg.telefono)) {
        seg.estado = "baja";
        registrarResultadoPresu(seg.ref, "baja_cliente (sin más mensajes)");
        guardarSeguimientosPresu();
        continue;
      }
      const plan = PLANES_PRESU[seg.tipo] || PLANES_PRESU.particular;
      const n = seg.enviados || 0;
      if (n >= plan.marta.length) { seg.estado = "fin_marta"; guardarSeguimientosPresu(); continue; }
      const tocaTs = seg.enviadoTs + plan.marta.at(n) * dia;
      if (ahora < tocaTs) continue;

      if ((await presupuestoSigueEnviado(seg)) === false) continue;

      // Mensaje con varios días de retraso: Marta no lo manda tarde.
      if (ahora - tocaTs > PRESU_DIAS_RETRASO_MAX * dia) {
        if (seg.migrado) {
          // Venía del protocolo anterior: termina aquí y pasa a la llamada de María
          seg.estado = "fin_marta";
          guardarSeguimientosPresu();
          registrarResultadoPresu(seg.ref, "fin_marta_tras_cambio_de_protocolo");
          continue;
        }
        const ultimoMotivo = (presuHistorial.find((h) => h.ref === seg.ref)?.resultado || "desconocido").split(":")[0];
        seg.estado = "no_enviable";
        guardarSeguimientosPresu();
        resumen.cierres++;
        registrarResultadoPresu(seg.ref, `no_enviable_aviso_al_equipo (${ultimoMotivo})`);
        await avisarPresu(seg, `Presupuesto ${seg.ref}: Marta no pudo enviar su mensaje ${n + 1} por WhatsApp (${ultimoMotivo}) — conviene llamar`);
        crearNotaParte(seg.caseId, `Seguimiento presupuesto (Marta): no se pudo enviar el mensaje ${n + 1} por WhatsApp (${ultimoMotivo}). Avisada la responsable para llamar.`);
        continue;
      }

      const plantilla = plantillaPresu(seg.tipo, n, plan.marta.length);
      const r = await enviarToquePresu(seg, plantilla, n + 1);
      if (r.ok) {
        seg.enviados = n + 1;
        seg.ultimoMensajeTs = ahora;
        if (n === 0) seg.toque1Ts = ahora;
        if (seg.enviados >= plan.marta.length) seg.estado = "fin_marta";
        guardarSeguimientosPresu();
        registrarResultadoPresu(seg.ref, `toque${n + 1}_enviado`);
        console.log(`[Presupuestos] Mensaje ${n + 1}/${plan.marta.length} enviado — ${seg.ref} (${seg.clave}, ${seg.tipo})`);
      } else {
        registrarResultadoPresu(seg.ref, r.detalle ? `${r.motivo}: ${r.detalle}` : r.motivo);
        if (!r.reintentar) { seg.estado = "cancelado"; guardarSeguimientosPresu(); }
      }
      resumen.toques.push({ ref: seg.ref, toque: n + 1, resultado: r.ok ? "enviado" : r.motivo });
    }
    resumen.agenda = await agendaPresupuestos({ forzar: false });
    return { ok: true, ...resumen };
  } catch (e) {
    console.error("[Presupuestos] Barrido falló:", e.message);
    return { ok: false, motivo: `error: ${e.message}` };
  } finally {
    barridoPresuEnCurso = false;
  }
}

// ── Agenda diaria de María (10:00, L-V) ──────────────────────
// Un solo mensaje con lo que toca hoy, en vez de avisos sueltos:
//   📞 llamar: 2 días después del último mensaje de Marta sin respuesta;
//      el día 7 si el presupuesto pasa de 500 € (particular y empresa);
//      "volver a llamar" en la fecha acordada; al administrador el día
//      siguiente a la junta (comunidades)
//   ✉️ email al tramitador (compañías): días 3, 10 y 20
//   🔒 cerrar con R6: día 45 (comunidades, 90) si sigue abierto
// Cada tarea se avisa una sola vez. Antes de incluirla se comprueba en
// Zoho que el presupuesto sigue en Enviado.
let agendaPresuDia = null; // último día (YYYY-MM-DD) en que se envió
async function agendaPresupuestos({ forzar = false } = {}) {
  const hoy = diaMadrid(new Date());
  if (!forzar) {
    if (!esLaborable(new Date())) return { ok: false, motivo: "no_laborable" };
    if (minutosActualesMadrid() < 10 * 60) return { ok: false, motivo: "antes_de_las_10" };
    if (!agendaPresuDia) agendaPresuDia = await redisGet("iberica:presuAgendaDia");
    if (agendaPresuDia === hoy) return { ok: false, motivo: "ya_enviada_hoy" };
  }
  const ahora = Date.now(), dia = 24 * 3600 * 1000;
  const tareas = []; // { seg, claves, grupo, texto }
  for (const seg of Object.values(seguimientosPresu)) {
    normalizarSegPresu(seg);
    if (!PRESU_ESTADOS_VIVOS.includes(seg.estado)) continue;
    const plan = PLANES_PRESU[seg.tipo] || PLANES_PRESU.particular;
    const dias = (ahora - seg.enviadoTs) / dia;
    const quien = `${seg.nombre || "Cliente"} ${seg.ref}`;
    const nuevas = [];
    const add = (claves, grupo, detalle) => {
      const pendientes = [].concat(claves).filter((k) => !seg.avisos[k]);
      if (pendientes.length) nuevas.push({ seg, claves: pendientes, grupo, texto: `${quien} (${detalle})` });
    };
    if (dias >= plan.cierre) {
      add("r6", "cerrar", `${Math.floor(dias)} días abierto${seg.tipo === "comunidad" ? ", comunidad" : ""}`);
    } else {
      const emails = plan.emails.filter((d) => dias >= d);
      if (emails.length) add(emails.map((d) => `email${d}`), "email", `día ${emails.at(-1)}`);
      const sinRespuesta = ["en_curso", "fin_marta", "no_enviable"].includes(seg.estado);
      if (plan.llamada7 && sinRespuesta && dias >= 7 && !seg.importe && !seg.avisos.llamada7 && !seg.importeRevisado) {
        seg.importeRevisado = true;
        await refrescarImportePresu(seg);
      }
      if (plan.llamada7 && sinRespuesta && seg.importe > PRESU_IMPORTE_LLAMADA && dias >= 7) {
        add("llamada7", "llamar", `día 7, ${Math.round(seg.importe)} €`);
      }
      if (seg.estado === "fin_marta" && ahora >= (seg.ultimoMensajeTs || seg.enviadoTs) + PRESU_DIAS_LLAMADA_FIN * dia) {
        add("llamada_fin", "llamar", `no contestó a ${seg.enviados || 0} mensajes de Marta`);
      }
      if (seg.volverLlamarTs && ahora >= seg.volverLlamarTs) add("volver", "llamar", "volver a llamar, lo acordó con Marta");
      if (seg.juntaTs && ahora >= seg.juntaTs + dia) add("junta", "llamar", "al administrador, tras la junta");
    }
    if (!nuevas.length) continue;
    if ((await presupuestoSigueEnviado(seg)) === false) continue;
    tareas.push(...nuevas);
  }

  const grupos = [
    ["llamar", "📞 Llamar"],
    ["email", "✉️ Email al tramitador (nunca al asegurado)"],
    ["cerrar", "🔒 Cerrar con R6 en Zoho y FactuSOL"],
  ];
  const partes = grupos
    .map(([g, titulo]) => [titulo, tareas.filter((t) => t.grupo === g).map((t) => t.texto)])
    .filter(([, lista]) => lista.length)
    .map(([titulo, lista]) => `${titulo}: ${lista.join("; ")}.`);

  if (tareas.length) {
    // Los parámetros de plantilla no admiten saltos de línea: todo en una
    // línea, y troceado si es largo.
    const texto = partes.join(" ");
    const trozos = texto.match(/.{1,900}(\s|$)/g) || [texto];
    for (const [i, trozo] of trozos.entries()) {
      await avisarPresu(
        { nombre: `AGENDA DE PRESUPUESTOS ${hoy}${trozos.length > 1 ? ` (${i + 1}/${trozos.length})` : ""}`, ref: `${tareas.length} tareas`, clave: "—" },
        trozo.trim()
      );
    }
    for (const t of tareas) {
      for (const k of t.claves) t.seg.avisos[k] = ahora;
      if (t.grupo === "cerrar") { t.seg.estado = "cerrado_r6"; registrarResultadoPresu(t.seg.ref, "agenda_cerrar_con_R6"); }
      else registrarResultadoPresu(t.seg.ref, `agenda_${t.claves.at(-1)}`);
    }
    guardarSeguimientosPresu();
  }
  agendaPresuDia = hoy;
  redisSet("iberica:presuAgendaDia", hoy);
  console.log(`[Presupuestos] Agenda de ${hoy}: ${tareas.length} tareas`);
  return { ok: true, tareas: tareas.length, texto: partes };
}

// Los avisos del seguimiento de presupuestos (respuestas, sin respuesta,
// no se pudo enviar, plantilla rota) van a la persona responsable del
// seguimiento, no a quien esté de turno. Hoy: Mari. Se cambia con
// PRESU_RESPONSABLE (mari / nieves / guardia) sin tocar código.
function destinatarioPresupuestos() {
  const quien = (process.env.PRESU_RESPONSABLE || "mari").toLowerCase();
  return NOTIFICACIONES_CONFIG[quien] || determinarDestinatarioNotificacion();
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
  // Meta rechaza parámetros de plantilla con saltos de línea, tabuladores o
  // más de 4 espacios seguidos (p. ej. una respuesta de cliente citada).
  datos = Object.fromEntries(Object.entries(datos).map(([k, v]) =>
    [k, String(v ?? "—").replace(/[\r\n\t]+/g, " · ").replace(/ {4,}/g, " ").trim() || "—"]));
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
  const [botActivoGuardado, actividadGuardada, pausasGuardadas, resenasGuardadas, cierresGuardados, reglasGuardadas, leadsGuardados] = await Promise.all([
    redisGet("iberica:botActivo"),
    redisGet("iberica:actividad"),
    redisGet("iberica:pausaExpira"),
    redisGet("iberica:resenasPedidas"),
    redisGet("iberica:cierresProcesados"),
    redisGet("iberica:reglasComentarios"),
    redisGet("iberica:captacionLeads"),
  ]);
  const historialGuardado = await redisGet("iberica:resenasHistorial");
  const wamidsGuardados = await redisGet("iberica:wamidsBot");
  if (wamidsGuardados) {
    for (const [id, ts] of Object.entries(wamidsGuardados)) wamidsBot.set(id, ts);
  }
  if (process.env.UPSTASH_REDIS_REST_URL) wamidsCargados = true;
  const acusesGuardados = await redisGet("iberica:acusesAjenos");
  if (Array.isArray(acusesGuardados)) acusesAjenos = acusesGuardados;
  if (Array.isArray(historialGuardado)) resenasHistorial = historialGuardado;
  const enCursoGuardadas = await redisGet("iberica:resenasEnCurso");
  if (enCursoGuardadas) Object.assign(resenasEnCurso, enCursoGuardadas);
  const bajasGuardadas = await redisGet("iberica:bajas");
  if (bajasGuardadas) Object.assign(bajas, bajasGuardadas);
  const consentGuardados = await redisGet("iberica:consentimientos");
  if (consentGuardados) Object.assign(consentimientos, consentGuardados);
  const campanasGuardadas = await redisGet("iberica:campanas");
  if (campanasGuardadas) {
    Object.assign(campanas.listas, campanasGuardadas.listas || {});
    Object.assign(campanas.contactos, campanasGuardadas.contactos || {});
    Object.assign(campanas.conversaciones, campanasGuardadas.conversaciones || {});
    indexarWamidsCampana();
  }
  const seguimientosGuardados = await redisGet("iberica:seguimientosPresu");
  if (seguimientosGuardados) Object.assign(seguimientosPresu, seguimientosGuardados);
  const presuHistGuardado = await redisGet("iberica:presuHistorial");
  if (Array.isArray(presuHistGuardado)) presuHistorial = presuHistGuardado;
  if (botActivoGuardado) Object.assign(botActivo, botActivoGuardado);
  if (actividadGuardada) Object.assign(actividad, actividadGuardada);
  if (pausasGuardadas) Object.assign(pausaExpira, pausasGuardadas);
  if (resenasGuardadas) Object.assign(resenasPedidas, resenasGuardadas);
  if (cierresGuardados) Object.assign(cierresProcesados, cierresGuardados);
  if (Array.isArray(reglasGuardadas)) reglasComentarios = reglasGuardadas;
  if (leadsGuardados) Object.assign(captacionLeads, leadsGuardados);
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

    // Woztell puede devolver ok:1 arriba y aun así traer un rechazo de Meta
    // dentro de sendResult (p. ej. propiedad del hilo en Instagram).
    const falloInterno = res.data?.sendResult?.result?.find?.((r) => r?.ok === 0);
    if (res.data?.ok === 1 && !falloInterno) {
      console.log(`[Woztell] ✅ Mensaje enviado correctamente.`);
    } else if (falloInterno) {
      console.error(`[Woztell] ❌ Meta rechazó el envío a ${telefono}:`, JSON.stringify(falloInterno.error).slice(0, 300));
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
HORARIO DE LA TIENDA Y EXPOSICIÓN (atención al público en C/ San Leonardo 34: copias de llaves, venta en mostrador, ver puertas y cerraduras):
- Todo el año salvo agosto: lunes a viernes, de 9:30 a 13:30 y de 17:00 a 20:00. Al mediodía, de 13:30 a 17:00, está CERRADA.
- En agosto: lunes a viernes, solo de mañana, de 9:30 a 13:30.
- Sábados y domingos: CERRADA, todo el año.
URGENCIAS DE CERRAJERÍA: 24 horas, todos los días.
FESTIVOS: la tienda y exposición CIERRAN todos los festivos (nacionales, de Andalucía y locales de Almería). Las urgencias de cerrajería siguen atendiéndose 24 horas. Los festivos de las próximas semanas te los indica la línea "PRÓXIMOS FESTIVOS" al final de esta ficha; para fechas que no aparezcan ahí, no afirmes si un día es o no festivo.
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

// Festivos de Almería capital en los que cierra la tienda. Fuente: los
// calendarios laborales 2026 y 2027 de calendarios.ideal.es, que se
// declaran provisionales; revisar cuando salgan los oficiales.
const FESTIVOS_ALMERIA = {
  "2026-01-01": "Año Nuevo", "2026-01-06": "Epifanía del Señor", "2026-02-28": "Día de Andalucía",
  "2026-04-02": "Jueves Santo", "2026-04-03": "Viernes Santo", "2026-05-01": "Fiesta del Trabajo",
  "2026-06-24": "San Juan Bautista", "2026-08-15": "Asunción de la Virgen", "2026-08-29": "Virgen del Mar",
  "2026-10-12": "Fiesta Nacional de España", "2026-11-02": "Todos los Santos (trasladado al lunes)",
  "2026-12-07": "Día de la Constitución (trasladado al lunes)", "2026-12-08": "La Inmaculada Concepción",
  "2026-12-25": "Navidad",
  "2027-01-01": "Año Nuevo", "2027-01-06": "Epifanía del Señor", "2027-02-28": "Día de Andalucía",
  "2027-03-25": "Jueves Santo", "2027-03-26": "Viernes Santo", "2027-05-01": "Fiesta del Trabajo",
  "2027-06-24": "San Juan Bautista", "2027-08-15": "Asunción de la Virgen", "2027-10-12": "Fiesta Nacional de España",
  "2027-11-01": "Todos los Santos", "2027-12-06": "Día de la Constitución", "2027-12-08": "La Inmaculada Concepción",
  "2027-12-25": "Navidad",
};
const ULTIMO_FESTIVO_CONOCIDO = Object.keys(FESTIVOS_ALMERIA).sort().at(-1);

// ══════════════════════════════════════════════════════════════════
// TARIFA QUE MARTA PUEDE DAR (solo por WhatsApp; la Marta del teléfono no)
// Aperturas por zona (IVA incluido) e instalación de Toy y cerrojo. Nada
// de productos, puertas, automatismos ni fabricación: eso, presupuesto.
// Las zonas van por distancia, como en la tarifa de la oficina.
// ══════════════════════════════════════════════════════════════════
const TARIFA_APERTURAS = [
  // Zona 1: hasta unos 20 km (capital, Roquetas, Retamar, Benahadux)
  { zona: "Zona 1", pueblos: "Almería capital y sus barrios cercanos (La Cañada, El Alquián, Costacabana, Los Molinos), Huércal de Almería, Viator, Benahadux, Retamar, El Toyo, Aguadulce, El Parador y Roquetas de Mar (con La Gangosa)",
    normal: 80, guardia: 140, especialNormal: 110, especialGuardia: 160 },
  // Zona 2: hasta unos 40 km (Cabo de Gata, San José, El Ejido, Campohermoso)
  { zona: "Zona 2", pueblos: "Pechina, Rioja, Gádor, Santa Fe de Mondújar, Alhama de Almería, Vícar, La Mojonera, El Ejido (con Santa María del Águila, Las Norias, Almerimar, San Agustín y Balerma), Cabo de Gata (con Pujaire y Ruescas), San José, Los Escullos y Campohermoso (con San Isidro)",
    normal: 110, guardia: 140, especialNormal: 130, especialGuardia: 160 },
  // Zona 3: hasta unos 60 km (Berja, Adra, Níjar, Tabernas, Las Negras, Sorbas, Lucainena)
  { zona: "Zona 3", pueblos: "Berja, Dalías, Adra, Níjar pueblo, Fernán Pérez, Rodalquilar, Las Negras, Tabernas, Gérgal, Canjáyar, Sorbas y Lucainena de las Torres",
    normal: 120, guardia: 160, especialNormal: 140, especialGuardia: 170 },
  // Zona 4: más de 60 km (Abla, Agua Amarga, Abrucena)
  { zona: "Zona 4", pueblos: "Abla, Abrucena, Fiñana y Agua Amarga",
    normal: 140, guardia: 170, especialNormal: 160, especialGuardia: 180 },
];
const INSTALACIONES_TARIFA = { toy: 80, cerrojo: 60 };

// Bombines y escudos (hoja de la furgoneta): precio cerrado, IVA incluido,
// instalado y con 5 llaves nuevas. "enCasa": si el técnico ya está en la
// casa (p. ej. tras una apertura); "soloEsto": si va solo para esto (+30 €
// de viaje; esta columna es la de la zona 1, fuera la confirma la oficina).
const BOMBINES_TARIFA = [
  { nombre: "Bombín de seguridad antibumping (ABUS o AMIG)", enCasa: 69, soloEsto: 99, pack: true },
  { nombre: "Bombín + escudo de seguridad Basset", enCasa: 169, soloEsto: 199, pack: true },
  { nombre: "Escudo de seguridad Basset (protege el bombín por fuera)", enCasa: 109, soloEsto: 139, pack: false },
  { nombre: "Gama alta: bombín M&C Minos, con tarjeta de propiedad para las copias", enCasa: 179, soloEsto: 209, pack: true },
  { nombre: "Minos + escudo Basset", enCasa: 289, soloEsto: 319, pack: true },
];
// Fuera de la zona 1, si vamos solo para esto, se suma el desplazamiento
const PLUS_DESPLAZAMIENTO_FUERA_Z1 = parseInt(process.env.PLUS_DESPLAZAMIENTO || "20", 10);
// Subida del 1 de enero de 2027 (apertura de la zona 1: 89 € / 149 €)
const SUBIDA_2027 = "2027-01-01";

// Precio de apertura de una zona en una fecha
function aperturaZona(z, fecha = new Date()) {
  if (z.zona === "Zona 1" && diaMadrid(fecha) >= SUBIDA_2027) return { normal: 89, guardia: 149 };
  return { normal: z.normal, guardia: z.guardia };
}
// Pack apertura + producto: suma redondeada a la cifra acabada en 9 más cercana
const redondea9 = (n) => Math.round((n - 9) / 10) * 10 + 9;

// Cifras que Marta puede escribir hoy; cualquier otra en euros se bloquea
function cifrasPermitidas(fecha = new Date()) {
  const c = new Set([...Object.values(INSTALACIONES_TARIFA), 30]);
  for (const z of TARIFA_APERTURAS) {
    const a = aperturaZona(z, fecha);
    [a.normal, a.guardia, z.especialNormal, z.especialGuardia].forEach((n) => c.add(n));
    for (const b of BOMBINES_TARIFA) {
      c.add(b.enCasa); c.add(b.soloEsto); c.add(b.soloEsto + PLUS_DESPLAZAMIENTO_FUERA_Z1);
      if (b.pack) { c.add(redondea9(a.normal + b.enCasa)); c.add(redondea9(a.guardia + b.enCasa)); }
    }
  }
  return c;
}

// ¿Ahora es tarifa normal o de guardia? Guardia: de lunes a viernes desde
// las 20:30, fines de semana y festivos.
function franjaTarifaAhora(ahora = new Date()) {
  const dia = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Madrid", weekday: "short" }).format(ahora);
  const festivo = FESTIVOS_ALMERIA[diaMadrid(ahora)];
  const hm = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit", hour12: false }).format(ahora);
  const [h, m] = hm.split(":").map(Number);
  if (festivo) return { guardia: true, texto: `hoy es festivo (${festivo}): AHORA es tarifa de GUARDIA` };
  if (dia === "Sat" || dia === "Sun") return { guardia: true, texto: "es fin de semana: AHORA es tarifa de GUARDIA" };
  if (h * 60 + m >= 20 * 60 + 30) return { guardia: true, texto: `son las ${hm}: AHORA es tarifa de GUARDIA (desde las 20:30)` };
  return { guardia: false, texto: `son las ${hm} de un día laborable: AHORA es tarifa NORMAL (hasta las 20:30)` };
}

function bloqueTarifa(fecha = new Date()) {
  const filas = TARIFA_APERTURAS.map((z) => {
    const a = aperturaZona(z, fecha);
    return `- ${z.zona} (${z.pueblos}): ${a.normal} € normal / ${a.guardia} € guardia. Cerradura especial: ${z.especialNormal} € normal / ${z.especialGuardia} € guardia.`;
  }).join("\n");
  const bombines = BOMBINES_TARIFA.map((b) => `- ${b.nombre}: si vamos solo para esto, ${b.soloEsto} € en la zona 1 y ${b.soloEsto + PLUS_DESPLAZAMIENTO_FUERA_Z1} € en las zonas 2, 3 y 4 · ${b.enCasa} € si el técnico ya está en la casa`).join("\n");
  const packs = TARIFA_APERTURAS.map((z) => {
    const a = aperturaZona(z, fecha);
    return `- ${z.zona}: apertura + bombín ${redondea9(a.normal + 69)} € de día / ${redondea9(a.guardia + 69)} € noche y festivos · apertura + bombín + escudo ${redondea9(a.normal + 169)} € / ${redondea9(a.guardia + 169)} € · apertura + Minos ${redondea9(a.normal + 179)} € / ${redondea9(a.guardia + 179)} €`;
  }).join("\n");
  return `
TARIFA DE APERTURAS DE PUERTA (precio final, IVA incluido):
${filas}
- "Normal": de lunes a viernes hasta las 20:30. "Guardia": a partir de las 20:30, fines de semana y festivos. ${franjaTarifaAhora(fecha).texto}.
- "Cerradura especial": cerraduras de alta seguridad (tipo Fichet) en las que hay que taladrar. El cliente no suele saberlo: da el precio normal y añade que si la cerradura es especial sube a la otra cifra.
- Las zonas van por kilómetros desde Almería capital. Si el pueblo no aparece en la lista, NO lo adivines: pregunta o di que la oficina le confirma el precio de su zona.
- NO cubrimos la zona de levante (Carboneras, Mojácar, Vera, Garrucha, Turre, Cuevas del Almanzora, Pulpí, Huércal-Overa, Antas, Los Gallardos, Bédar…): dilo con amabilidad.
BOMBINES Y ESCUDOS (precio cerrado, IVA incluido, instalado y con 5 llaves nuevas):
${bombines}
- Fuera de la zona 1 se suman ${PLUS_DESPLAZAMIENTO_FUERA_Z1} € de desplazamiento (ya están en la cifra de las zonas 2, 3 y 4).
- Los 30 € de diferencia entre columnas son el viaje: si ya estamos en la casa, la furgoneta no tiene que volver. No es un descuento.
PACK APERTURA + BOMBÍN (si se lo cambiamos en la misma visita de la apertura; la apertura no se cobra dos veces):
${packs}
- Si deja el bombín para otro día, paga la apertura hoy y el bombín "solo para esto" ese día.
PUERTAS DE LLAVE LARGA (gorjas): NUNCA una cifra. "Es otro trabajo: te damos el precio cerrado por teléfono antes de hacer nada" (lo da Nieves). Pregunta si la llave es plana (bombín) o larga (gorjas) antes de dar precio de bombín.
INSTALACIONES CON PRECIO FIJO (IVA incluido, mano de obra): instalar un Toy, ${INSTALACIONES_TARIFA.toy} €; instalar un cerrojo nuevo (FAC, SAG…), ${INSTALACIONES_TARIFA.cerrojo} €. El material va aparte.
CÓMO ASESORAR (tú no ves la puerta: no diagnostiques, orienta y deja que el técnico lo confirme):
1. Pregunta lo justo, de una en una y en palabras sencillas: ¿en qué pueblo está la casa? y ¿la llave es plana o es larga, de las antiguas?
   Para saber si ya tiene ESCUDO (tú no lo ves y el cliente lo confunde con el embellecedor fino que llevan casi todas las puertas), pregunta: "Mirando la cerradura por fuera, ¿el bombín sobresale de la puerta o queda tapado por una pieza metálica gruesa, de las que se atornillan desde dentro?".
   - Sobresale o se ve solo un aro fino → no tiene escudo.
   - Pieza gruesa que lo tapa → ya tiene escudo.
   - No lo sabe o no lo tiene claro → no insistas: da las dos opciones con su precio (con escudo y sin él) y di que el técnico lo mira al llegar y le confirma cuál hace falta antes de tocar nada. Nunca le pidas una foto de la llave por los dientes.
2. Llave larga (gorjas): sin cifra; un compañero le llama con el precio cerrado.
3. Llave plana: recomienda directamente el bombín M&C Minos, con su precio, explicado en una línea: es un bombín de gama alta y las copias solo se hacen presentando su tarjeta de propiedad, así nadie puede copiar la llave sin permiso. Si no tiene escudo, ofrece Minos + escudo como lo recomendable (el escudo evita que arranquen o rompan el bombín por fuera).
4. Si el precio le frena o pide algo más económico: la opción sencilla es el bombín de seguridad antibumping (ABUS o AMIG), con su precio. No es un descuento, es otra opción. No ofrezcas más de dos opciones a la vez.
5. Si duda, no insistas: una sola recomendación y, si dice que no, perfecto. Si quiere que le asesoren mejor, ofrece que le llame un compañero de la oficina o que el técnico se lo mire allí y le diga el precio antes de tocar nada.
CÓMO DAR UN PRECIO:
- Solo estas cifras, enteras y de una vez ("Son 99 € con IVA, instalado y con 5 llaves nuevas"). NUNCA "desde", "solo", "nada más", "más o menos" ni "este precio es solo para hoy".
- Si no sabes la zona o el tipo de llave, pregúntalo antes. Di que el técnico lo confirma antes de empezar.
- Nadie rebaja: si pide descuento, "el precio es el mismo para todo el mundo; lo más sencillo es solo el bombín".
- Nunca metas miedo ("te van a robar", "en tu calle han entrado"). Si su bombín está bien, no hace falta cambiarlo.
- "¿Lo cubre el seguro?": "Eso te lo dice mejor tu compañía". Nunca digas lo que nos cuesta a nosotros un producto.
- Productos que no están aquí (cerraduras, puertas, automatismos, fabricación…): SIN cifras, presupuesto sin compromiso.`;
}

// Fecha YYYY-MM-DD en hora de Madrid
function diaMadrid(fecha) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(fecha);
}

// La IA no sabe qué día es: se le da la fecha de hoy (hora de Madrid), el
// horario de tienda que aplica hoy y los próximos festivos, para que no
// confunda agosto con el resto del año ni diga "abrimos" un festivo.
function fechaYHorarioDeHoy(ahora = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", weekday: "long", day: "numeric", month: "long", year: "numeric" })
      .formatToParts(ahora).map((x) => [x.type, x.value])
  );
  const mes = Number(new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Madrid", month: "numeric" }).format(ahora));
  const finde = ["sábado", "domingo"].includes(p.weekday);
  const festivoHoy = FESTIVOS_ALMERIA[diaMadrid(ahora)];
  const hoy = festivoHoy
    ? `hoy es festivo (${festivoHoy}): la tienda está CERRADA`
    : finde
      ? "hoy la tienda está CERRADA (fin de semana)"
      : mes === 8
        ? "hoy la tienda abre solo de mañana, de 9:30 a 13:30 (horario de agosto)"
        : "hoy la tienda abre de 9:30 a 13:30 y de 17:00 a 20:00";

  // Festivos de los próximos 60 días, para preguntas tipo "¿abrís el lunes?"
  const hoyIso = diaMadrid(ahora);
  const limite = diaMadrid(new Date(ahora.getTime() + 60 * 24 * 3600 * 1000));
  const fmt = new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });
  const proximos = Object.entries(FESTIVOS_ALMERIA)
    .filter(([d]) => d > hoyIso && d <= limite)
    .map(([d, nombre]) => `${fmt.format(new Date(`${d}T12:00:00Z`))} (${nombre})`);
  const lineaFestivos = proximos.length
    ? `PRÓXIMOS FESTIVOS, tienda cerrada: ${proximos.join("; ")}.`
    : "PRÓXIMOS FESTIVOS: ninguno en los próximos 60 días.";
  const aviso = limite > ULTIMO_FESTIVO_CONOCIDO
    ? " Más allá de esas fechas no tienes el calendario: no afirmes si un día es festivo."
    : "";

  return `HOY: ${p.weekday} ${p.day} de ${p.month} de ${p.year} (hora de Madrid) — ${hoy}.\n${lineaFestivos}${aviso}`;
}

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

// Clasifica la respuesta de un cliente al seguimiento de su presupuesto.
// Devuelve: acepta | precio | aplaza | consulta | declina | duda.
// Primero la IA (entiende "de momento no voy a hacer nada", "lo tengo que
// ver con la comunidad"…); si falla o tarda, palabras clave.
// `toque` = el mensaje de Marta al que responde: tras el 3.º ("¿has
// aparcado el presupuesto?") un "sí" significa que NO sigue adelante.
const CATEGORIAS_PRESU = ["acepta", "precio", "aplaza", "consulta", "declina", "duda"];
async function clasificarRespuestaPresu(mensaje, toque) {
  const contexto = toque === 3
    ? `\nCONTEXTO: Marta le acaba de preguntar si ha decidido aparcar o dejar el presupuesto. Un "sí", "sí, lo dejamos" o similar es "declina"; un "no, sigo interesado" es "aplaza" salvo que pida seguir adelante ya ("acepta").`
    : "";
  try {
    const res = await Promise.race([
      openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0,
        max_tokens: 10,
        messages: [
          {
            role: "system",
            content:
`Un cliente de Ibérica Seguridad (cerrajería y puertas de seguridad) responde al seguimiento de un presupuesto que le enviamos. Clasifica su respuesta con UNA sola palabra:
- acepta: quiere seguir adelante, acepta, pregunta cuándo podéis venir a hacerlo.
- precio: le parece caro, pide descuento, lo compara con otro presupuesto.
- aplaza: no por ahora, de momento no, más adelante, se lo está pensando, no va a hacer nada por el momento.
- consulta: la decisión no es solo suya; tiene que verlo o consultarlo con otra persona o grupo (pareja, familia, socio, jefe, la comunidad de vecinos, la junta, el administrador).
- declina: no lo va a hacer, ya lo hizo con otra empresa, no le interesa.
- duda: hace una pregunta concreta o pide algo que debe responder una persona.${contexto}
Responde solo la palabra.`,
          },
          { role: "user", content: mensaje },
        ],
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 8000)),
    ]);
    const cat = normalizaTxt(res.choices?.[0]?.message?.content || "").replace(/[^a-z]/g, "");
    if (CATEGORIAS_PRESU.includes(cat)) return cat;
  } catch (e) { console.error("[Presupuestos] Clasificación IA falló, uso palabras clave:", e.message); }
  return clasificarRespuestaPresuPorPalabras(mensaje, toque);
}
function clasificarRespuestaPresuPorPalabras(mensaje, toque) {
  const low = normalizaTxt(mensaje).trim();
  if (toque === 3 && /^(si|sí|vale|ok|efectivamente|asi es)\b/.test(low) && !/adelante|seguir|hacerlo/.test(low)) return "declina";
  if (/(adelante|acepto|acepta(mos)?|de acuerdo|confirmo|hacedlo|cuando (pueden|podeis|puedan)|vale,? si|queremos hacerlo|me lo quedo)/.test(low)) return "acepta";
  if (/(caro|carisimo|precio|coste|cuesta|barato|rebaja|descuento|competencia|otro presupuesto)/.test(low)) return "precio";
  if (/(consultar|comentar|hablar|ver|decidir) (lo |la |con )?(con )?(mi |la |el |los )?(mujer|marido|pareja|familia|socio|jefe|hijo|hija|comunidad|junta|vecinos|administrador)|(la |una )?junta( de vecinos)?|comunidad de (vecinos|propietarios)|administrador de fincas/.test(low)) return "consulta";
  if (/(pensar|pensando|mas adelante|todavia no|aun no|ahora no|por (el|ahora|lo pronto)|de momento|por ahora|ya (te|os) (dire|digo)|consultar|decidir|dudando|no lo (tengo|tenemos) claro|no (voy|vamos) a hacer nada)/.test(low)) return "aplaza";
  if (/(no (lo )?(quiero|queremos|vamos a hacerlo|va a ser)|no me interesa|descartado|ya lo (hice|hicimos|contrate|contratamos)|otra empresa|dejalo|no,? gracias)/.test(low)) return "declina";
  return "duda";
}

// Tras un "me lo pienso" o "lo tengo que consultar", Marta pregunta qué
// falta y cuándo volver a escribir. Esto extrae de la respuesta: cuándo
// (en días desde hoy), qué información o duda queda pendiente, y si en
// realidad ya decide (acepta / declina).
async function extraerSiguientePaso(mensaje) {
  try {
    const hoy = diaMadrid(new Date());
    const res = await Promise.race([
      openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0,
        max_tokens: 120,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
`Hoy es ${hoy}. Un cliente responde a: "¿Qué te queda por resolver para decidirte y cuándo te viene bien que te vuelva a escribir?" sobre un presupuesto de cerrajería o puertas. Devuelve SOLO este JSON:
{"dias": número de días desde hoy hasta la fecha que da (cuando quiere que le contacten, o la de la reunión en la que lo decidirán; null si no da ninguna), "junta": true si esa fecha es una junta o reunión (de vecinos, de la comunidad, de socios) en la que se decidirá, false si no, "falta": texto breve con la información, duda o condición que le falta (null si nada), "decision": "acepta" | "declina" | "ninguna"}
"la semana que viene" = 7, "dentro de un mes" = 30, "la junta es el día 20" = días hasta el día 20 y junta = true. No inventes plazos que no diga.`,
          },
          { role: "user", content: mensaje },
        ],
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 8000)),
    ]);
    const j = JSON.parse(res.choices?.[0]?.message?.content || "{}");
    return {
      dias: Number.isFinite(j.dias) ? j.dias : null,
      junta: j.junta === true || /\bjunta\b|reuni[oó]n de (vecinos|la comunidad|socios)/i.test(String(mensaje || "")),
      falta: j.falta ? String(j.falta).slice(0, 200) : null,
      decision: ["acepta", "declina"].includes(j.decision) ? j.decision : "ninguna",
    };
  } catch (e) {
    console.error("[Presupuestos] Extracción IA del siguiente paso falló, uso palabras clave:", e.message);
  }
  const low = normalizaTxt(mensaje);
  let dias = null;
  const m = low.match(/(\d+)\s*(dia|dias|semana|semanas|mes|meses)/);
  if (m) dias = Number(m[1]) * (m[2].startsWith("semana") ? 7 : m[2].startsWith("mes") ? 30 : 1);
  else if (/(quince dias|dos semanas)/.test(low)) dias = 14;
  else if (/semana (que viene|proxima)|proxima semana/.test(low)) dias = 7;
  else if (/(mes que viene|proximo mes|un mes)/.test(low)) dias = 30;
  const cat = clasificarRespuestaPresuPorPalabras(mensaje);
  const diaJunta = low.match(/junta[^0-9]{0,30}(\d{1,2})/);
  if (dias === null && diaJunta) {
    const hoyD = Number(diaMadrid(new Date()).slice(8));
    const objetivo = Number(diaJunta[1]);
    dias = objetivo >= hoyD ? objetivo - hoyD : objetivo + 30 - hoyD;
  }
  return { dias, junta: /junta|reunion de (vecinos|la comunidad|socios)/.test(low), falta: null, decision: ["acepta", "declina"].includes(cat) ? cat : "ninguna" };
}

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
- agente: pide expresamente hablar con una persona o que le llamen, o pide algo administrativo que solo puede resolver la oficina (una factura, un recibo, un pago, un cambio de datos).
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
2. Precios: SOLO los de la TARIFA DE APERTURAS e INSTALACIONES CON PRECIO FIJO de la ficha, siguiendo sus reglas (zona, normal o guardia, cerradura especial, el técnico lo confirma antes de empezar). Cualquier otra cosa (productos, puertas, automatismos, otros trabajos): sin cifras, ofrece un presupuesto sin compromiso.
3. PROHIBIDO prometer plazos o fechas que no puedas confirmar.
4. Si preguntan si eres una persona o un robot: di con simpatía que eres la asistente virtual de Ibérica Seguridad, que puedes gestionarlo todo igualmente, y ofrece pasar con una persona si lo prefiere.
5. No inventes NADA. Ante la duda, deriva a un compañero.
6. No hables de otras empresas o competidores, ni de temas ajenos a los servicios de Ibérica Seguridad: reconduce con amabilidad.

FICHA DE LA EMPRESA:
${BASE_CONOCIMIENTO}
${bloqueTarifa()}
${fechaYHorarioDeHoy()}`,
      },
      ...estado.historialIA,
      ...mensajesExtra,
    ],
  });

  let texto = res.choices[0].message.content.trim();
  // Sin markdown en WhatsApp: fuera asteriscos y almohadillas
  texto = texto.replace(/\*\*/g, "").replace(/\*/g, "").replace(/^#+\s*/gm, "");
  // Guardarraíl extra en código: solo pueden salir las cifras de la tarifa
  const cifras = [...texto.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:€|euros?)/gi)].map((m) => Number(m[1].replace(",", ".")));
  const permitidas = cifrasPermitidas();
  if (cifras.some((n) => !permitidas.has(n))) {
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
      `- Precios: solo los de la TARIFA DE APERTURAS e INSTALACIONES CON PRECIO FIJO de la ficha (con sus reglas: zona, normal o guardia, cerradura especial y que el técnico lo confirma antes de empezar). Para cualquier otra cosa, sin cifras: depende del caso y el técnico se lo confirma antes de hacer nada, sin compromiso. PROHIBIDO prometer plazos.\n` +
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

// Respuesta de un cliente a un seguimiento de presupuesto (todos los
// mensajes que mandó seguidos, juntos). Dos pasos:
//   presu_respuesta  → qué contesta al mensaje de Marta (acepta, precio,
//                      se lo piensa, lo tiene que consultar, no, duda)
//   presu_siguiente  → tras "me lo pienso" o "lo tengo que consultar", su
//                      respuesta a "¿qué te falta y cuándo te escribo?"
// Técnicas comerciales aplicadas:
//   - Sandler: dejar claro que un "no" es una respuesta aceptable, para
//     que el cliente no tenga que dar largas.
//   - Gong Labs: ante "tengo que pensarlo", preguntar qué falta por
//     resolver y acordar el siguiente contacto (con fecha).
//   - Sandler, decisiones en comité: si decide con otros (pareja, socio,
//     junta de la comunidad), preguntar con quién, para cuándo y qué
//     información necesita para presentarlo.
// Líneas rojas de marca: sin precios ni presión. Todo queda anotado en el
// parte y el equipo recibe aviso cuando hay señal de venta o de pérdida,
// o cuando el cliente pide información.
const PRESU_ESPERA_MS = parseInt(process.env.PRESU_ESPERA_MS || "20000");
const NO_ES_PROBLEMA = "Y si al final no os encaja, me lo dices con total confianza, ¿vale? Un no también nos ayuda 🙂";

async function procesarRespuestaPresu(telefono) {
  const estado = conversaciones[telefono];
  if (!estado || !["presu_respuesta", "presu_siguiente"].includes(estado.step)) return;
  const msg = (estado.presuBuffer || []).join("\n").trim();
  estado.presuBuffer = [];
  if (!msg) return;
  const paso   = estado.step;
  const ref    = estado.presu?.ref || "—";
  const caseId = estado.presu?.caseId || null;
  const toque  = estado.presu?.toque || null;
  const seg    = caseId ? seguimientosPresu[caseId] : null;
  if (seg) { seg.estado = "respondido"; guardarSeguimientosPresu(); }
  estado.step = "menu_principal";

  const avisar = async (titulo, texto = msg) => {
    try {
      const dest = destinatarioPresupuestos();
      const ahoraStr = new Date().toLocaleString("es-ES", { timeZone: "Europe/Madrid", hour12: false });
      await enviarNotificacionAgente(dest, {
        nombre: estado.nombre || seg?.nombre || `Cliente ${telefono.slice(-9)}`,
        telefono: telefono.slice(-9), direccion: "—",
        descripcion: `${titulo} (presupuesto ${ref}): "${String(texto).slice(0, 150)}"`,
        apertura: ahoraStr, refParte: ref, agente: "Seguimiento presupuestos",
      });
    } catch (e) { console.error("[Presupuestos] Aviso falló:", e.message); }
  };

  const acepta = async () => {
    await enviarMensaje(telefono, "¡Genial! 🙌 Le paso ahora mismo tu confirmación al equipo y te llaman para cuadrar fechas. ¡Gracias por confiar en Ibérica!");
    crearNotaParte(caseId, `Seguimiento presupuesto (Marta): el cliente ACEPTA. Respuesta: "${msg.slice(0, 300)}"`);
    registrarResultadoPresu(ref, "respondio_ACEPTA");
    await avisar("🎯 PRESUPUESTO ACEPTADO");
  };
  const declina = async () => {
    await enviarMensaje(telefono, "Entendido, ¡y gracias por decírnoslo! 🙏 Te guardamos el presupuesto por si más adelante lo retomas. Aquí nos tienes para lo que necesites 🔐");
    crearNotaParte(caseId, `Seguimiento presupuesto (Marta): el cliente DECLINA. Motivo/respuesta: "${msg.slice(0, 300)}"`);
    registrarResultadoPresu(ref, "respondio_declina");
    await avisar("❌ Presupuesto declinado");
  };

  // ── Paso 2: qué falta y cuándo volver a escribir ──
  if (paso === "presu_siguiente") {
    const sig = await extraerSiguientePaso(msg);
    console.log(`[Presupuestos] Siguiente paso de ${telefono} (${ref}):`, JSON.stringify(sig));
    if (sig.decision === "acepta") return acepta();
    if (sig.decision === "declina") return declina();

    const partes = [];
    if (sig.falta) {
      partes.push(`le falta: ${sig.falta}`);
      await avisar("📋 El cliente necesita información para decidir", sig.falta);
    }
    if (sig.dias !== null) {
      const dias = Math.min(90, Math.max(1, Math.round(sig.dias)));
      const cuando = laborableDesde(new Date(Date.now() + dias * 24 * 3600 * 1000));
      const fecha = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", weekday: "long", day: "numeric", month: "long" }).format(cuando);
      const ddmm = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", day: "2-digit", month: "2-digit" }).format(cuando);
      const otroDia = new Date(cuando.getTime() + 24 * 3600 * 1000);
      const ddmmJunta = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", day: "2-digit", month: "2-digit" }).format(otroDia);
      if (sig.junta) {
        // Comunidades: María llama al administrador al día siguiente de la junta
        if (seg) { seg.estado = "respondido"; seg.juntaTs = cuando.getTime(); guardarSeguimientosPresu(); }
        await enviarMensaje(telefono, `¡Perfecto! Después de la junta un compañero os llama para ver cómo ha ido.${sig.falta ? " Y lo que necesitáis para presentarlo se lo paso ya." : ""} Cualquier cosa antes, aquí estoy 🙂`);
        partes.push(`junta el ${fecha}: llamar al administrador el ${ddmmJunta}`);
        registrarResultadoPresu(ref, `junta_en_${dias}_dias`);
      } else {
        // "Me lo pienso" con fecha: «Volver a llamar dd/mm» (llama María)
        if (seg) { seg.estado = "volver_a_llamar"; seg.volverLlamarTs = cuando.getTime(); guardarSeguimientosPresu(); }
        await enviarMensaje(telefono, `¡Perfecto! Te llamamos hacia el ${fecha}.${sig.falta ? " Y lo que necesitas se lo paso ya a un compañero." : ""} Cualquier cosa antes, aquí estoy 🙂`);
        partes.push(`Volver a llamar ${ddmm}`);
        registrarResultadoPresu(ref, `volver_a_llamar_en_${dias}_dias`);
      }
    } else {
      await enviarMensaje(telefono, `¡Perfecto! Te guardamos el presupuesto.${sig.falta ? " Lo que necesitas se lo paso ya a un compañero." : ""} Cuando lo tengáis claro, me escribes por aquí 🙂`);
      registrarResultadoPresu(ref, "aplazado_sin_fecha");
    }
    crearNotaParte(caseId, `Seguimiento presupuesto (Marta): siguiente paso — ${partes.join("; ") || "sin fecha ni pendientes"}. Respuesta: "${msg.slice(0, 300)}"`);
    return;
  }

  // ── Paso 1: qué contesta al mensaje de Marta ──
  const categoria = await clasificarRespuestaPresu(msg, toque);
  console.log(`[Presupuestos] Respuesta de ${telefono} (${ref}) clasificada como: ${categoria}`);

  if (categoria === "acepta") return acepta();
  if (categoria === "declina") return declina();

  if (categoria === "precio") {
    await enviarMensaje(
      telefono,
      "Te entiendo, es una inversión importante. Incluye la instalación por nuestro equipo propio y 3 años de garantía, y tenemos financiación para pagarlo con comodidad. Si quieres, un compañero te llama y ve contigo cómo ajustarlo, sin compromiso.\n" + NO_ES_PROBLEMA
    );
    crearNotaParte(caseId, `Seguimiento presupuesto (Marta): objeción de PRECIO. Respuesta: "${msg.slice(0, 300)}"`);
    registrarResultadoPresu(ref, "respondio_objecion_precio");
    await avisar("💶 Objeción de precio");
    return;
  }
  if (categoria === "aplaza") {
    await enviarMensaje(
      telefono,
      "¡Claro, sin ninguna prisa! 🙂 ¿Hay algo concreto que te quede por resolver para decidirte? Y dime hacia cuándo te viene bien que te vuelva a escribir.\n" + NO_ES_PROBLEMA
    );
    crearNotaParte(caseId, `Seguimiento presupuesto (Marta): APLAZA / se lo piensa. Respuesta: "${msg.slice(0, 300)}"`);
    registrarResultadoPresu(ref, "respondio_aplaza");
    estado.step = "presu_siguiente";
    return;
  }
  if (categoria === "consulta") {
    await enviarMensaje(
      telefono,
      "¡Claro, es normal decidirlo juntos! 🙂 ¿Con quién lo vais a ver y para cuándo, más o menos? Si para presentarlo te viene bien alguna información (opciones, fotos, garantía, financiación…), dímelo y un compañero te la prepara.\n" + NO_ES_PROBLEMA
    );
    crearNotaParte(caseId, `Seguimiento presupuesto (Marta): lo tiene que CONSULTAR con otros. Respuesta: "${msg.slice(0, 300)}"`);
    registrarResultadoPresu(ref, "respondio_consulta");
    estado.step = "presu_siguiente";
    return;
  }

  // Cualquier otra cosa (dudas técnicas, cambios...) → persona
  await enviarMensaje(telefono, "¡Buena pregunta! Se la paso ahora mismo a un compañero del equipo para que te conteste por aquí en breve 🙂");
  crearNotaParte(caseId, `Seguimiento presupuesto (Marta): duda/consulta del cliente: "${msg.slice(0, 300)}"`);
  registrarResultadoPresu(ref, "respondio_duda_derivada");
  await avisar("❓ Duda sobre presupuesto");
  pausarBot(`${estado.channelId}_${telefono}`, PAUSA_AGENTE_H, "duda de presupuesto derivada al equipo");
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
    // Caso frecuente en partes de seguro: la encuesta llega al TITULAR de
    // la póliza pero el trabajo se hizo a otra persona (inquilino,
    // familiar) → "no he contratado nada con vosotros". No es una
    // valoración mala: se aclara con amabilidad, se anota y se avisa al
    // equipo para que verifique el teléfono del parte.
    if (noIdentificaServicio(low)) {
      estado.step = "menu_principal";
      cerrarResenaEnCurso(telefono);
      await enviarMensaje(
        telefono,
        `¡Disculpe la confusión! 🙏 Le escribíamos por una reparación gestionada a través de su compañía de seguros${estado.resena?.refParte ? ` (aviso ${estado.resena.refParte})` : ""} — es posible que en la vivienda atendiéramos a otra persona (un inquilino o familiar). No necesita hacer nada más. ¡Gracias y disculpe las molestias!`
      );
      crearNotaParte(estado.resena?.caseId, `Encuesta postventa (Marta): el receptor del WhatsApp NO identifica el servicio ("${msg.slice(0, 200)}"). Posible titular de póliza distinto de la persona atendida (inquilino/familiar). Verificar teléfono del contacto.`);
      registrarResultadoResena(estado.resena?.refParte || telefono, "respondio_no_identifica_el_servicio");
      try {
        const destinatario = determinarDestinatarioNotificacion();
        const ahoraStr = new Date().toLocaleString("es-ES", { timeZone: "Europe/Madrid", hour12: false });
        await enviarNotificacionAgente(destinatario, {
          nombre:      estado.nombre || `Cliente ${telefono.slice(-9)}`,
          telefono:    telefono.slice(-9),
          direccion:   "—",
          descripcion: `⚠️ Encuesta: el receptor NO identifica el servicio (parte ${estado.resena?.refParte || "—"}): "${msg.slice(0, 150)}". Posible titular del seguro ≠ persona atendida. Verificar teléfono del parte.`,
          apertura:    ahoraStr,
          refParte:    estado.resena?.refParte || "—",
          agente:      "Postventa",
        });
      } catch (e) { console.error("[Reseñas] No se pudo avisar al equipo:", e.message); }
      return;
    }
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
      registrarResultadoResena(estado.resena?.refParte || telefono, `respondio_${n !== null ? n : "positivo"}_enlace_enviado`);
      cerrarResenaEnCurso(telefono);
      // Permiso para escribirle (solo si aún no lo ha contestado)
      const kc = claveBaja(telefono);
      if (!consentimientos[kc] && !esBaja(kc)) {
        await new Promise((r) => setTimeout(r, CONSENT_ESPERA_MS));
        estado.step = "resena_consentimiento";
        await enviarMensaje(telefono, PREGUNTA_CONSENTIMIENTO);
      }
      return;
    }
    if (n !== null || negativo) {
      estado.step = "resena_feedback";
      estado.resena = estado.resena || {};
      estado.resena.nota = n !== null ? `${n}/10` : `negativa ("${msg.slice(0, 80)}")`;
      registrarResultadoResena(estado.resena?.refParte || telefono, `respondio_${n !== null ? n : "negativo"}_pidiendo_mejora`);
      await enviarMensaje(telefono, "Muchas gracias por la sinceridad 🙏 ¿Qué podríamos haber hecho mejor? Se lo paso tal cual al equipo.");
      return;
    }
    if ((estado.resena?.intentos || 0) >= 1) {
      estado.step = "menu_principal";
      await enviarMensaje(telefono, "¡Gracias por tu tiempo! 😊 Si necesitas cualquier cosa, aquí estamos.");
      cerrarResenaEnCurso(telefono);
      return;
    }
    estado.resena = estado.resena || {};
    estado.resena.intentos = 1;
    await enviarMensaje(telefono, "¿Me lo dices con una nota del 0 al 10? 🙂");
    return;
  }
  if (estado.step === "resena_consentimiento") {
    estado.step = "menu_principal";
    const r = respuestaConsentimiento(msg);
    if (r) {
      registrarConsentimiento(telefono, r, msg, { origen: "encuesta", refParte: estado.resena?.refParte || null });
      crearNotaParte(estado.resena?.caseId, `Encuesta postventa (Marta): ${r === "si" ? "ACEPTA" : "NO acepta"} recibir mensajes comerciales por WhatsApp (máx. 4 al año). Respuesta: "${msg.slice(0, 100)}"`);
      await enviarMensaje(telefono, r === "si"
        ? "¡Genial, apuntado! 🙌 Como mucho 4 mensajes al año, y si en algún momento prefieres que no, escribe BAJA."
        : "¡Entendido, sin problema! No te escribiremos con eso. Aquí nos tienes para lo que necesites 🙂");
      return;
    }
    // No contesta a la pregunta (p. ej. "ya la he puesto"): no se apunta
    // nada y el mensaje sigue el flujo normal.
  }
  if (estado.step === "resena_feedback") {
    estado.step = "menu_principal";
    cerrarResenaEnCurso(telefono);
    // "No os conozco / no contraté nada" tampoco es una valoración baja aquí
    if (noIdentificaServicio(normalizaTxt(msg))) {
      await enviarMensaje(
        telefono,
        `¡Disculpe la confusión! 🙏 Le escribíamos por una reparación gestionada a través de su compañía de seguros${estado.resena?.refParte ? ` (aviso ${estado.resena.refParte})` : ""} — es posible que en la vivienda atendiéramos a otra persona. No necesita hacer nada más. ¡Gracias!`
      );
      crearNotaParte(estado.resena?.caseId, `Encuesta postventa (Marta): el receptor NO identifica el servicio ("${msg.slice(0, 200)}"). Posible titular de póliza distinto de la persona atendida. Verificar teléfono del contacto.`);
      registrarResultadoResena(estado.resena?.refParte || telefono, "respondio_no_identifica_el_servicio");
      return;
    }
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

  // ── Respuesta a un seguimiento de presupuesto ───────────
  if (estado.step === "presu_respuesta" || estado.step === "presu_siguiente") {
    // El cliente a veces escribe en varios mensajes ("Hola" + "vale,
    // adelante"): se juntan los que lleguen en PRESU_ESPERA_MS y se
    // clasifican como una sola respuesta.
    estado.presuBuffer = [...(estado.presuBuffer || []), msg];
    clearTimeout(estado.presuTimer);
    estado.presuTimer = setTimeout(() => {
      procesarRespuestaPresu(telefono).catch((e) => console.error("[Presupuestos] Error procesando respuesta:", e.message));
    }, PRESU_ESPERA_MS);
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
// Persistir en Redis: sin esto, cada redeploy vaciaba los leads en curso y el
// siguiente mensaje del cliente reiniciaba el guion (guía repetida, etc.).
function guardarCaptacionLeads() {
  redisSet("iberica:captacionLeads", captacionLeads);
}

// La captación SOLO se activa en el canal del número de la campaña (el de los
// anuncios). En cualquier otro número/canal del bot NUNCA se dispara.
// Si no está configurado, la captación queda DESACTIVADA (a prueba de fallos).
const CAMPANA_CHANNEL_ID = process.env.CAMPANA_CHANNEL_ID || null;

// Frase distintiva del mensaje precargado del anuncio/landing (normalizada).
// Un cliente de urgencias NUNCA la escribe → así separamos leads de clientes.
const FRASE_CAMPANA = "campana de puertas";

// Interruptor del embudo del anuncio de puertas. Con la publicidad de Meta
// parada queda APAGADO: ningún contacto nuevo entra al guion de puertas
// (ni por canal de campaña, ni por referral, ni por mención del anuncio) y
// los comentarios de Instagram solo responden si encaja una regla de
// /admin/comentarios. Quien ya esté a mitad del guion lo termina igual.
// Para reactivarlo al relanzar la campaña: CAPTACION_ANUNCIO=on en Railway.
const CAPTACION_ANUNCIO = (process.env.CAPTACION_ANUNCIO || "off").toLowerCase() === "on";

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
  // Solo menciones EXPLÍCITAS del anuncio. "en instagram" / "en facebook" a
  // secas metían en el embudo de puertas a cualquiera que dijera "os vi en
  // Instagram" preguntando por otra cosa.
  return /(vi (tu|el|vuestro|su) anuncio|del anuncio|por el anuncio|me interesa la puerta)/.test(n);
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
    guardarCaptacionLeads();
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
  // Registrar el texto como envío propio: sin esto, el eco MANUAL de estos
  // mensajes (Instagram) se confundiría con una intervención humana y el
  // bot se pausaría a sí mismo en plena cualificación.
  registrarEnvioBot(lead.telefono, mensaje);
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

// Un lead que recibió la guía pero no terminó el embudo (ni foto ni zona)
// NO puede morir en silencio: pasados 45 min sin actividad, se avisa al
// equipo con los datos que haya para que lo atienda una persona.
async function barrerLeadsAbandonados() {
  const ahora = Date.now();
  for (const [telefono, lead] of Object.entries(captacionLeads)) {
    if (lead.avisado) continue;
    if (ahora - (lead.updatedAt || 0) < 45 * 60 * 1000) continue;
    lead.avisado = true;
    guardarCaptacionLeads();
    console.log(`[Captación] Lead sin terminar → aviso al equipo: ${telefono} (${lead.origen || "origen desconocido"})`);
    await notificarLeadPuertas({
      telefono,
      zona: lead.zona, mejora: lead.mejora, plazo: lead.plazo,
      fotos: !!lead.fotos,
      origen: `${lead.origen || "—"} · SIN TERMINAR (dejó de responder en ${lead.step})`,
    });
  }
}
setInterval(() => barrerLeadsAbandonados().catch((e) => console.error("[Captación] Barrido falló:", e.message)), 10 * 60 * 1000);

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
  guardarCaptacionLeads();
}

// ── Comentarios de Instagram (posts y reels) ─────────────────
// Un comentario dispara un DM privado de Marta ofreciendo la guía, y el
// autor queda dentro del flujo de leads (si responde al DM, sigue la
// cualificación normal). Un DM por comentario, sin repetir.
//
// Reglas por palabra clave (editables en /admin/comentarios, persistidas en
// Redis): si el comentario contiene la palabra, se envía ese mensaje/enlace
// en vez de la guía por defecto. La primera regla que encaje gana.
let reglasComentarios = []; // [{ palabra, mensaje, enlace?, publica? }]
const comentariosRespondidos = {}; // { commentId: ts }
async function manejarComentarioIG(body) {
  const usuario   = body?.data?.from?.id || body?.from;
  const username  = body?.data?.from?.username || "";
  const texto     = body?.data?.text || "";
  const canal     = body?.channel;
  const memberId  = body?.member;
  const commentId = body?.comment_id || body?.data?.id;
  if (!usuario || !canal || !memberId || !commentId) return;
  if (usuario === body?.to) return;               // comentario de la propia cuenta
  if (comentariosRespondidos[commentId]) return;  // ya respondido
  comentariosRespondidos[commentId] = Date.now();
  if (Object.keys(comentariosRespondidos).length > 500) {
    const limite = Date.now() - 30 * 24 * 3600 * 1000;
    for (const [id, ts] of Object.entries(comentariosRespondidos)) if (ts < limite) delete comentariosRespondidos[id];
  }
  console.log(`[Comentarios] @${username} comentó "${texto.slice(0, 60)}" en ${body?.data?.media?.media_product_type || "post"}`);
  // No interrumpir si ya está en mitad de otro flujo o en plena cualificación
  if (captacionActiva(usuario)) return;
  const conv = conversaciones[usuario];
  if (conv && conv.step && conv.step !== "menu_principal") return;
  // Ni si una persona de la oficina está atendiendo ese DM (bot en pausa)
  if (botPausado(`${canal}_${usuario}`)) return;

  // ¿Alguna regla por palabra clave encaja con el texto del comentario?
  const regla = reglasComentarios.find(
    (r) => r?.palabra && normalizaTxt(texto).includes(normalizaTxt(r.palabra))
  );

  // Con el embudo del anuncio apagado, solo responden los comentarios que
  // encajan con una regla de /admin/comentarios (la guía por defecto era
  // parte de la campaña de puertas).
  if (!regla && !CAPTACION_ANUNCIO) {
    delete comentariosRespondidos[commentId]; // por si mañana se añade la regla
    return;
  }

  captacionLeads[usuario] = {
    telefono: usuario, step: "cap_guia",
    zona: null, mejora: null, plazo: null, fotos: false,
    origen: `comentario en ${String(body?.data?.media?.media_product_type || "post").toLowerCase()} (@${username})` +
            (regla ? ` [${regla.palabra}]` : ""),
    memberId, channelId: canal, updatedAt: Date.now(),
  };
  guardarCaptacionLeads();
  const mensajeDM = regla
    ? `${regla.mensaje}${regla.enlace ? " 👉 " + regla.enlace : ""}`
    : CAP.bienvenida;
  await enviarCap(captacionLeads[usuario], mensajeDM);

  // Respuesta pública bajo el comentario (texto fijo, nunca IA en público).
  // Requiere INSTAGRAM_TOKEN en Railway: el Access Token del canal de
  // Instagram que muestra Woztell en Canales → Instagram → Plataforma.
  if (process.env.INSTAGRAM_TOKEN) {
    try {
      await axios.post(`https://graph.facebook.com/${commentId}/replies`, null, {
        params: {
          message: (regla?.publica || "").trim() || "¡Te hemos escrito por privado! 📩 Revisa tus mensajes 😊",
          access_token: process.env.INSTAGRAM_TOKEN,
        },
        timeout: 10000,
      });
      console.log(`[Comentarios] ✅ Respuesta pública publicada bajo el comentario de @${username}`);
    } catch (e) {
      console.error("[Comentarios] ❌ No se pudo responder públicamente:", JSON.stringify(e.response?.data || e.message).slice(0, 300));
    }
  }
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
    const origen = ref.headline || ref.source_id || ref.ctwa_clid || ref.body ||
      (channelId === CAMPANA_CHANNEL_ID ? "canal de campaña" : "mención del anuncio en el chat");
    lead = captacionLeads[telefono] = {
      telefono, step: "cap_guia",
      zona: null, mejora: null, plazo: null, fotos: !!esImagen,
      origen, memberId, channelId, updatedAt: Date.now(),
    };
    guardarCaptacionLeads();
    await enviarCap(lead, CAP.bienvenida);
    return;
  }

  lead.memberId = memberId;
  lead.channelId = channelId;
  lead.updatedAt = Date.now();
  guardarCaptacionLeads();

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
// Auto-takeover: últimos acuses de mensajes que el bot no envió y qué se
// hizo con cada uno (pausa / ignorado), para revisar un "Marta habló encima".
app.get("/admin/api/takeover-diag", authAdmin, (req, res) => {
  res.json({
    registroWamidsPersistente: wamidsCargados,
    wamidsDelBotRecordados: wamidsBot.size,
    minutosDesdeArranque: Math.round((Date.now() - arranqueTs) / 60000),
    acusesAjenos,
  });
});

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

// ── Reglas de comentarios de Instagram (palabra clave → DM) ──
app.get("/admin/api/comentarios-reglas", authAdmin, (req, res) => {
  res.json({ reglas: reglasComentarios });
});
app.post("/admin/api/comentarios-reglas", authAdmin, (req, res) => {
  const reglas = req.body?.reglas;
  if (!Array.isArray(reglas)) return res.status(400).json({ error: "se espera { reglas: [...] }" });
  reglasComentarios = reglas
    .filter((r) => r && typeof r.palabra === "string" && r.palabra.trim() && typeof r.mensaje === "string" && r.mensaje.trim())
    .map((r) => ({
      palabra: r.palabra.trim(),
      mensaje: r.mensaje.trim(),
      enlace:  (r.enlace || "").trim() || null,
      publica: (r.publica || "").trim() || null,
    }));
  redisSet("iberica:reglasComentarios", reglasComentarios);
  console.log(`[Comentarios] Reglas actualizadas: ${reglasComentarios.length}`);
  res.json({ ok: true, reglas: reglasComentarios });
});

// ── Pantalla de gestión de las reglas de comentarios ─────────
app.get("/admin/comentarios", authAdmin, (req, res) => {
  res.send(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Comentarios de Instagram — Ibérica</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #F5F7F5; color: #2A2A2A; padding: 24px; }
  h1 { color: #1A5C2B; font-size: 1.3rem; margin-bottom: 6px; }
  p.ayuda { color: #747576; font-size: .9rem; margin-bottom: 18px; max-width: 720px; }
  table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 10px rgba(26,92,43,.09); }
  th { background: #1A5C2B; color: #fff; text-align: left; padding: 10px 12px; font-size: .8rem; }
  td { padding: 8px 10px; border-top: 1px solid #E0E8E2; vertical-align: top; }
  input, textarea { width: 100%; padding: 8px; border: 1px solid #E0E8E2; border-radius: 6px; font: inherit; font-size: .85rem; }
  textarea { min-height: 64px; resize: vertical; }
  button { cursor: pointer; border: none; border-radius: 8px; padding: 10px 18px; font-weight: 700; }
  .add { background: #E8F1EA; color: #1A5C2B; margin: 14px 8px 0 0; }
  .save { background: #26843D; color: #fff; margin-top: 14px; }
  .del { background: #fbe9e7; color: #c62828; padding: 6px 10px; }
  .aviso { margin-top: 12px; font-size: .9rem; color: #1A5C2B; font-weight: 600; min-height: 1.2em; }
</style></head><body>
<h1>Comentarios de Instagram → respuesta de Marta</h1>
<p class="ayuda">Si un comentario contiene la <b>palabra clave</b>, Marta envía por DM ese <b>mensaje</b> (con su enlace si lo pones) en vez de la guía de puertas. En "respuesta pública" puedes personalizar lo que se escribe debajo del comentario (vacío = "¡Te hemos escrito por privado! 📩"). Si ninguna palabra encaja, se envía la guía de siempre. Ejemplo de uso en el pie del post: <i>"Comenta CERROJO y te mandamos la información"</i>.</p>
<table id="tabla"><thead><tr><th style="width:14%">Palabra clave</th><th style="width:36%">Mensaje del DM</th><th style="width:22%">Enlace (opcional)</th><th style="width:22%">Respuesta pública (opcional)</th><th></th></tr></thead><tbody></tbody></table>
<button class="add" onclick="fila()">+ Añadir regla</button>
<button class="save" onclick="guardar()">Guardar cambios</button>
<div class="aviso" id="aviso"></div>
<script>
const tbody = document.querySelector('#tabla tbody');
function fila(r = {}) {
  const tr = document.createElement('tr');
  tr.innerHTML = '<td><input class="palabra" value=""></td>' +
    '<td><textarea class="mensaje"></textarea></td>' +
    '<td><input class="enlace" value=""></td>' +
    '<td><input class="publica" value=""></td>' +
    '<td><button class="del" onclick="this.closest(\\'tr\\').remove()">✕</button></td>';
  tr.querySelector('.palabra').value = r.palabra || '';
  tr.querySelector('.mensaje').value = r.mensaje || '';
  tr.querySelector('.enlace').value  = r.enlace  || '';
  tr.querySelector('.publica').value = r.publica || '';
  tbody.appendChild(tr);
}
async function cargar() {
  const res = await fetch('/admin/api/comentarios-reglas');
  const j = await res.json();
  (j.reglas || []).forEach(fila);
  if (!j.reglas || !j.reglas.length) fila();
}
async function guardar() {
  const reglas = [...tbody.querySelectorAll('tr')].map(tr => ({
    palabra: tr.querySelector('.palabra').value,
    mensaje: tr.querySelector('.mensaje').value,
    enlace:  tr.querySelector('.enlace').value,
    publica: tr.querySelector('.publica').value,
  })).filter(r => r.palabra.trim() && r.mensaje.trim());
  const res = await fetch('/admin/api/comentarios-reglas', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reglas }),
  });
  document.getElementById('aviso').textContent = res.ok ? '✅ Guardado — activo desde ya' : '❌ Error al guardar';
}
cargar();
</script></body></html>`);
});

// ── Seguimiento de presupuestos: estado y pruebas ────────────
// Bajas: lista, y alta/quitar a mano (p. ej. lo pidió por teléfono)
//   /admin/api/bajas · ?anadir=611222333&motivo=telefono · ?quitar=611222333
app.get("/admin/api/bajas", authAdmin, async (req, res) => {
  if (req.query.anadir) {
    const k = claveBaja(req.query.anadir);
    if (k.length !== 9) return res.json({ ok: false, error: "teléfono no válido" });
    await registrarBaja(k, String(req.query.motivo || "a_mano").slice(0, 40), "", { origen: "panel" });
  }
  if (req.query.quitar) {
    const k = claveBaja(req.query.quitar);
    delete bajas[k];
    guardarBajas();
    console.log(`[Bajas] ${k} quitado de la lista desde el panel`);
  }
  const lista = Object.entries(bajas)
    .map(([telefono, b]) => ({ telefono, fecha: new Date(b.ts).toLocaleString("es-ES", { timeZone: "Europe/Madrid", hour12: false }), motivo: b.motivo, origen: b.origen, texto: b.texto }))
    .sort((a, b) => (bajas[b.telefono].ts - bajas[a.telefono].ts));
  res.json({ ok: true, total: lista.length, bajas: lista });
});

// Consentimientos para mensajes comerciales (prueba ante protección de datos)
app.get("/admin/api/consentimientos", authAdmin, (req, res) => {
  const lista = Object.entries(consentimientos)
    .map(([telefono, c]) => ({ telefono, respuesta: esBaja(telefono) && c.respuesta === "si" ? "revocado" : c.respuesta,
      fecha: new Date(c.ts).toLocaleString("es-ES", { timeZone: "Europe/Madrid", hour12: false }), origen: c.origen, refParte: c.refParte, texto: c.texto }))
    .sort((a, b) => consentimientos[b.telefono].ts - consentimientos[a.telefono].ts);
  const cuenta = (r) => lista.filter((x) => x.respuesta === r).length;
  res.json({ ok: true, si: cuenta("si"), no: cuenta("no"), revocados: cuenta("revocado"), pregunta: PREGUNTA_CONSENTIMIENTO, consentimientos: lista });
});

app.get("/admin/api/presupuestos-stats", authAdmin, (req, res) => {
  const ahora = Date.now();
  res.json({
    activo: presuActivo(),
    responsable: destinatarioPresupuestos().nombre,
    plantillas: {
      primera: process.env.PRESU_TEMPLATE || null,
      intermedias: process.env.PRESU_TEMPLATE2 || process.env.PRESU_TEMPLATE || null,
      ultimaAparcado: PRESU_PLANTILLA_APARCADO,
      comunidad: process.env.PRESU_TEMPLATE_COMUNIDAD || null,
    },
    calendario: Object.fromEntries(Object.entries(PLANES_PRESU).map(([t, p]) => [t, { martaEscribeDias: p.marta, emailsTramitadorDias: p.emails, llamadaDia7SiMasDe: p.llamada7 ? PRESU_IMPORTE_LLAMADA : null, cierreR6Dia: p.cierre }])),
    agendaEnviadaHoy: agendaPresuDia === diaMadrid(new Date()),
    seguimientos: Object.values(seguimientosPresu).map((s) => normalizarSegPresu(s)).map((s) => ({
      ref: s.ref, telefono: s.clave, nombre: s.nombre, tipo: s.tipo, importe: s.importe ?? null,
      estado: s.estado, mensajesMarta: s.enviados || 0,
      diasDesdeEnvio: s.enviadoTs ? Math.round((ahora - s.enviadoTs) / 86400000) : null,
      volverALlamar: s.volverLlamarTs ? diaMadrid(new Date(s.volverLlamarTs)) : undefined,
      junta: s.juntaTs ? diaMadrid(new Date(s.juntaTs)) : undefined,
    })),
    historial: presuHistorial.slice(0, 30),
    motivos: presuHistorial.reduce((acc, h) => {
      const clave = String(h.resultado).split(":")[0].trim();
      acc[clave] = (acc[clave] || 0) + 1;
      return acc;
    }, {}),
  });
});

// Lanza a mano el sondeo + barrido (con ?forzar=1 se salta la ventana
// comercial — útil para probar; PRESU_AUTO debe estar en on igualmente)
// ── ¿Qué ha pasado con los presupuestos que Marta siguió? ────
// Consulta en Zoho el estado ACTUAL de cada presupuesto en el que Marta
// llegó a escribir al cliente (toque 1 enviado), y lo agrupa por estado.
// Es la base para medir cuántos se cierran tras el seguimiento.
app.get("/admin/api/presupuestos-resultados", authAdmin, async (req, res) => {
  const contactados = Object.values(seguimientosPresu).filter((s) => s.toque1Ts);
  let token;
  try { token = await obtenerTokenZoho(); }
  catch (e) { return res.json({ ok: false, motivo: `sin_token_zoho: ${e.message}` }); }
  const detalle = [];
  for (const seg of contactados) {
    let estadoActual = null;
    try {
      const c = await axios.get(`https://www.zohoapis.eu/crm/v2/Cases/${seg.caseId}`, {
        headers: { Authorization: `Zoho-oauthtoken ${token}` },
      });
      const caso = c.data?.data?.[0];
      if (caso) estadoActual = `${caso.Status || "?"} / ${caso.Subestado || "—"}`;
    } catch (e) { estadoActual = `error: ${e.response?.status || e.message}`; }
    detalle.push({
      ref: seg.ref, nombre: seg.nombre || null,
      seguimientoMarta: seg.estado,
      respondioAMarta: seg.estado === "respondido",
      toques: seg.enviados || (seg.toque2Ts ? 2 : 1),
      estadoActualZoho: estadoActual,
    });
  }
  const porEstadoZoho = detalle.reduce((acc, d) => {
    acc[d.estadoActualZoho || "desconocido"] = (acc[d.estadoActualZoho || "desconocido"] || 0) + 1;
    return acc;
  }, {});
  res.json({ ok: true, contactadosPorMarta: detalle.length, porEstadoZoho, detalle });
});

app.get("/admin/api/test-presupuestos", authAdmin, async (req, res) => {
  const sondeo  = await sondearPresupuestosEnviados();
  const barrido = await barridoToquesPresupuesto(req.query.forzar === "1");
  const agenda  = req.query.agenda === "1" ? await agendaPresupuestos({ forzar: true }) : undefined;
  res.json({ sondeo, barrido, agenda });
});

// ── Qué tipo de cliente e importe deduce Marta (diagnóstico) ──
// Para comprobar la clasificación particular / empresa / comunidad /
// compañía y si encuentra el importe, sobre los últimos presupuestos de
// Zoho. `camposPosibles` = campos del parte que podrían decirlo, para
// fijarlos con PRESU_CAMPO_TIPO / PRESU_CAMPO_IMPORTE si hace falta.
app.get("/admin/api/presupuestos-tipos", authAdmin, async (req, res) => {
  try {
    const token = await obtenerTokenZoho();
    const r = await axios.get("https://www.zohoapis.eu/crm/v2/Cases", {
      params: { sort_by: "Modified_Time", sort_order: "desc", per_page: 50 },
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
    });
    const casos = (r.data?.data || []).filter((c) => normalizaTxt(c.Status || "").includes("presupuesto")).slice(0, 15);
    const salida = [];
    for (const caso of casos) {
      let contacto = {};
      try {
        if (caso.Related_To?.id) {
          const c = await axios.get(`https://www.zohoapis.eu/crm/v2/Contacts/${caso.Related_To.id}`, { headers: { Authorization: `Zoho-oauthtoken ${token}` } });
          contacto = c.data?.data?.[0] || {};
        }
      } catch (_) {}
      const camposPosibles = Object.fromEntries(Object.entries(caso)
        .filter(([k, v]) => v != null && v !== "" && /tipo|cliente|segur|compa|importe|amount|total|precio|anotac|cuenta|account/i.test(k))
        .map(([k, v]) => [k, typeof v === "object" ? (v.name || JSON.stringify(v).slice(0, 60)) : String(v).slice(0, 60)]));
      salida.push({
        ref: caso.ref_Parte || caso.id, cliente: caso.Related_To?.name || null,
        estado: `${caso.Status || "?"} / ${caso.Subestado || "—"}`,
        tipoDeducido: tipoClientePresu(caso, contacto), importeDeducido: importePresu(caso, await notasDelParte(caso.id, token)),
        empresaDelContacto: contacto.Account_Name?.name || null,
        camposPosibles,
      });
    }
    res.json({ ok: true, campoTipo: process.env.PRESU_CAMPO_TIPO || null, campoImporte: process.env.PRESU_CAMPO_IMPORTE || null, presupuestos: salida });
  } catch (e) {
    res.json({ ok: false, error: String(e.message).slice(0, 200) });
  }
});

// ── Canales visibles en Woztell (diagnóstico) ────────────────
// Lista los canales reales con sus IDs exactos, para configurar
// WOZTELL_CHANNEL_ID sin teclear a mano (un ID mal copiado rompe la
// creación de contactos con "Cannot read properties of null").
app.get("/admin/api/woztell-canales", authAdmin, async (req, res) => {
  try {
    const d = await graphqlWoztell(
      `query canales($first: IntMax100) {
         apiViewer { channels(first: $first) { edges { node { _id name connected } } } }
       }`,
      { first: 30 }
    );
    const canales = (d?.apiViewer?.channels?.edges || []).map((e) => ({
      id: e?.node?._id, nombre: e?.node?.name, conectado: !!e?.node?.connected,
    }));
    res.json({ ok: true, configurado: process.env.WOZTELL_CHANNEL_ID || null, canales });
  } catch (e) {
    res.json({ ok: false, error: String(e.message).slice(0, 300) });
  }
});

// ── Relanzar a mano una encuesta postventa ───────────────────
// Para partes cuyo envío falló y cuya ventana de reintento ya caducó:
// GET /admin/api/pedir-resena?tel=6XXXXXXXX&nombre=Juan&ref=2026-11622
// Busca el parte en Zoho por la referencia (para poder anotar la respuesta
// en él) y lanza pedirResena con las mismas reglas de siempre (dedupe 7
// días incluido).
app.get("/admin/api/pedir-resena", authAdmin, async (req, res) => {
  const tel    = String(req.query.tel || "").trim();
  const nombre = String(req.query.nombre || "").trim() || null;
  const ref    = String(req.query.ref || "").trim() || null;
  if (!tel) return res.json({ ok: false, motivo: "falta_el_parametro_tel" });
  let caseId = null;
  if (ref) {
    try { caseId = (await consultarParteZoho(ref))?.id || null; }
    catch (e) { console.error("[Reseñas] No se pudo buscar el parte:", e.message); }
  }
  const r = await pedirResena({ telefono: tel, nombre, refParte: ref, caseId });
  registrarResultadoResena(ref || tel, r.ok ? `enviada_por_${r.via}` : (r.detalle ? `${r.motivo}: ${r.detalle}` : r.motivo));
  res.json(r);
});

// ── Barrido manual de leads abandonados (diagnóstico) ────────
app.get("/admin/api/test-leads-abandonados", authAdmin, async (req, res) => {
  await barrerLeadsAbandonados();
  res.json({
    ok: true,
    campanaChannelId: CAMPANA_CHANNEL_ID,
    leadsActivos: Object.entries(captacionLeads).map(([t, l]) => ({
      telefono: t, step: l.step, origen: l.origen, avisado: !!l.avisado,
      minutosSinActividad: Math.round((Date.now() - (l.updatedAt || 0)) / 60000),
    })),
  });
});

// ── Sondeo manual de cierres desde el panel (diagnóstico) ────
// ── Estado del circuito de reseñas de un vistazo ─────────────
app.get("/admin/api/resenas-stats", authAdmin, (req, res) => {
  const ahora = Date.now();
  const pedidas = Object.entries(resenasPedidas)
    .sort((a, b) => b[1] - a[1])
    .map(([tel, ts]) => ({ telefono: tel, hace_horas: Math.round((ahora - ts) / 3600000) }));
  res.json({
    plantillaConfigurada: !!process.env.RESENA_TEMPLATE,
    nombrePlantilla: process.env.RESENA_TEMPLATE || null,
    encuestasPedidasTotal: pedidas.length,
    ultimas: pedidas.slice(0, 25),
    cierresProcesadosRegistrados: Object.keys(cierresProcesados).length,
    // Qué pasó con cada parte cerrado que vio el sondeo (más reciente primero)
    historial: resenasHistorial.slice(0, 30),
    // Conteo por motivo (sin el detalle tras ":", para agrupar bien)
    motivos: resenasHistorial.reduce((acc, h) => {
      const clave = String(h.resultado).split(":")[0].trim();
      acc[clave] = (acc[clave] || 0) + 1;
      return acc;
    }, {}),
  });
});

app.get("/admin/api/test-cierres", authAdmin, async (req, res) => {
  res.json(await sondearPartesCerrados());
});

// Comprueba la clave ?k= de los webhooks y herramientas de voz. Tolera
// espacios o saltos de línea colados al copiar, y deja en el log el motivo
// exacto de cada rechazo (sin exponer las claves completas).
function claveWebhookValida(req) {
  const esperada = (process.env.AVISO_LLAMADA_KEY || "").trim();
  const recibida = String(req.query.k || "").trim();
  if (esperada && recibida === esperada) return true;
  const pista = (s) => (s ? `${s.slice(0, 3)}…${s.slice(-3)} (${s.length} caracteres)` : "vacía");
  console.warn(
    `[Auth] ${req.path}: clave rechazada — recibida ${pista(recibida)}, esperada ${pista(esperada)}` +
    (esperada ? "" : " ⚠️ AVISO_LLAMADA_KEY no está configurada en Railway")
  );
  return false;
}

// ══════════════════════════════════════════════════════════════
// HERRAMIENTAS DEL AGENTE DE VOZ (ElevenLabs) — Marta al teléfono
// El agente telefónico llama a estos endpoints durante la llamada.
// Seguridad: ?k=<AVISO_LLAMADA_KEY> en la URL de cada tool.
// ══════════════════════════════════════════════════════════════

// Crear un parte de urgencia desde una llamada. El agente debe haber
// recogido antes los cuatro datos. Devuelve la referencia para leérsela.
app.post("/voz/crear-parte", async (req, res) => {
  if (!claveWebhookValida(req)) return res.status(401).json({ error: "no autorizado" });
  const d = req.body || {};
  console.log("[Voz] Crear parte:", JSON.stringify(d).slice(0, 300));
  const faltan = ["nombre", "telefono", "direccion", "descripcion"].filter((c) => !String(d[c] || "").trim());
  if (faltan.length) return res.json({ ok: false, motivo: "faltan_datos", faltan });
  try {
    const { refParte } = await crearParteZoho({
      nombre:      String(d.nombre).trim(),
      telefono:    String(d.telefono).replace(/\D/g, ""),
      direccion:   String(d.direccion).trim(),
      descripcion: String(d.descripcion).trim(),
      agente:      "Marta (teléfono)",
    });
    // Avisos al turno (plantilla de WhatsApp + llamada), sin bloquear la respuesta
    const destinatario = determinarDestinatarioNotificacion();
    const ahoraStr = new Date().toLocaleString("es-ES", { timeZone: "Europe/Madrid", hour12: false });
    enviarNotificacionAgente(destinatario, {
      nombre: d.nombre, telefono: String(d.telefono).slice(-9), direccion: d.direccion,
      descripcion: `[Llamada] ${d.descripcion}`, apertura: ahoraStr, refParte, agente: "Marta (teléfono)",
    }).catch((e) => console.error("[Voz] Aviso WhatsApp falló:", e.message));
    llamarAvisoParte({ refParte, nombre: d.nombre, telefono: d.telefono, direccion: d.direccion, descripcion: d.descripcion });
    console.log(`[Voz] ✅ Parte ${refParte} creado desde llamada telefónica`);
    res.json({ ok: true, refParte });
  } catch (e) {
    console.error("[Voz] ❌ Error creando parte:", e.message);
    res.json({ ok: false, motivo: "error_al_crear", detalle: "No se pudo registrar el parte; toma los datos y di que llamaremos nosotros." });
  }
});

// Consultar el estado de un parte por su referencia (ej: "2026-11300")
app.post("/voz/consultar-parte", async (req, res) => {
  if (!claveWebhookValida(req)) return res.status(401).json({ error: "no autorizado" });
  const ref = String(req.body?.refParte || req.body?.referencia || "").trim();
  console.log("[Voz] Consultar parte:", ref);
  if (!ref) return res.json({ ok: false, motivo: "falta_referencia" });
  try {
    const caso = await consultarParteZoho(ref);
    if (!caso) return res.json({ ok: false, motivo: "no_encontrado" });
    res.json({
      ok: true,
      referencia: caso.ref_Parte || ref,
      asunto:     caso.Subject || null,
      estado:     caso.Status || "N/D",
      subestado:  caso.Subestado || null,
      operario:   caso.Operario || null,
    });
  } catch (e) { res.json({ ok: false, motivo: "error_zoho" }); }
});

// Buscar el parte más reciente por teléfono (cuando no recuerdan la referencia)
app.post("/voz/parte-por-telefono", async (req, res) => {
  if (!claveWebhookValida(req)) return res.status(401).json({ error: "no autorizado" });
  const tel = String(req.body?.telefono || "").replace(/\D/g, "");
  console.log("[Voz] Partes por teléfono:", tel.slice(-9));
  if (tel.length < 9) return res.json({ ok: false, motivo: "telefono_invalido" });
  try {
    const partes = await consultarPartesPorContacto(tel);
    if (!partes.length) return res.json({ ok: false, motivo: "sin_partes" });
    const p = partes[0];
    res.json({
      ok: true,
      referencia: p.ref_Parte || "N/D",
      asunto:     p.Subject || null,
      estado:     p.Status || "N/D",
      subestado:  p.Subestado || null,
      totalPartes: partes.length,
    });
  } catch (e) { res.json({ ok: false, motivo: "error_zoho" }); }
});

// ── Webhook del CRM: parte CERRADO → encuesta postventa/reseña ──
// El workflow de Zoho CRM (estado → Cerrado) llama aquí y Marta pregunta la
// nota en el chat del cliente. Seguridad: ?k=<AVISO_LLAMADA_KEY>.
app.post("/zoho/parte-cerrado", async (req, res) => {
  if (!claveWebhookValida(req)) return res.status(401).json({ error: "no autorizado" });
  const d = req.body || {};
  console.log("[Reseñas] Parte cerrado en Zoho:", JSON.stringify(d).slice(0, 400));
  const resultado = await pedirResena({
    telefono: d.telefono || d.movil || d.phone || null,
    nombre:   d.nombre || d.cliente || null,
    refParte: d.refParte || d.ref || d.numero || null,
    caseId:   d.caseId || d.id || null,
  });
  console.log("[Reseñas] Resultado:", JSON.stringify(resultado));
  res.json(resultado);
});

// ── Webhook de Zoho Flow: parte creado → llamada de aviso ────
// Zoho Flow llama aquí cuando se crea un parte en el CRM y el bot lanza la
// llamada de voz al teléfono de turno. Seguridad: ?k=<AVISO_LLAMADA_KEY>.
app.post("/zoho/parte-creado", async (req, res) => {
  if (!claveWebhookValida(req)) return res.status(401).json({ error: "no autorizado" });
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

    // Botones de respuesta rápida de las plantillas («Sí, llamadme»…): se
    // tratan como un texto con la etiqueta del botón.
    if (String(req.body?.eventType || "").toUpperCase() === "INBOUND" &&
        ["PAYLOAD", "BUTTON", "QUICK_REPLY", "INTERACTIVE", "POSTBACK"].includes(String(req.body?.type || "").toUpperCase())) {
      const d = req.body.data || {};
      const textoBoton = d.text || d.title || d.button?.text || d.interactive?.button_reply?.title || d.payload?.title || (typeof d.payload === "string" ? d.payload : null);
      if (textoBoton) {
        console.log(`[Webhook] Botón pulsado por ${req.body.from}: "${textoBoton}" (${req.body.type})`);
        req.body = { ...req.body, type: "TEXT", data: { ...d, text: typeof textoBoton === "string" ? textoBoton : JSON.stringify(textoBoton) } };
      }
    }
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
        try { const w = req.body?.data?.messageId || req.body?.messageId; if (w) marcarAcuseCampana(w, "FAILED"); } catch (_) {}
      } else if (tipo === "COMMENT") {
        // Comentario en un post/reel de Instagram → DM privado con la guía.
        // (Se maneja aquí a propósito: un comentario trae texto del CLIENTE y
        // no debe pasar por la detección de intervención humana.)
        try { await manejarComentarioIG(req.body); } catch (e) { console.error("[Comentarios] Error:", e.message); }
      } else if (tipo === "SMB_CONTACTS") {
        // Sincronización de la agenda de la app de WhatsApp Business: llegan
        // cientos seguidos, sin texto. Ni son respuestas ni llenan los logs.
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
    // La captación responde 24/7 (se salta el horario comercial), pero NUNCA
    // se salta la pausa: si una persona de la oficina ha intervenido en el
    // chat, Marta se calla también aquí.
    if (CAMPANA_CHANNEL_ID && channelId === CAMPANA_CHANNEL_ID &&
        !etiquetaEntradaNavidad(texto) && !conversacionCampana(telefono) &&
        (captacionActiva(telefono) ||
         (CAPTACION_ANUNCIO &&
          (esInicioCampana(texto) || esContactoNuevo(telefono) ||
           tieneReferralAnuncio(req.body) || mencionaAnuncio(texto) || esTemaPuertas(texto))))) {
      if (botPausado(`${channelId}_${telefono}`)) {
        console.log(`[Captación] Bot pausado para ${telefono} — mensaje ignorado (lo atiende una persona)`);
        return res.sendStatus(200);
      }
      await manejarCaptacion({ telefono, memberId, channelId, texto, esImagen, req });
      return res.sendStatus(200);
    }

    // A partir de aquí, el flujo normal solo continúa con mensajes de TEXTO.
    if (tipo !== "TEXT") {
      if (conversacionCampana(telefono) && !botPausado(`${channelId}_${telefono}`)) {
        try { if (await manejarRespuestaCampana({ telefono, memberId, channelId, texto: "", tipoEvento: tipo })) return res.sendStatus(200); }
        catch (e) { console.error("[Campañas] Respuesta (media):", e.message); }
      }
      // Un lead en cualificación puede mandar su foto por un canal normal
      if (esImagen && captacionActiva(telefono) && !botPausado(`${channelId}_${telefono}`)) {
        await manejarCaptacion({ telefono, memberId, channelId, texto: "", esImagen, req });
        return res.sendStatus(200);
      }
      // Foto/documento fuera de la campaña: con la IA activa, agradecerla en
      // vez de ignorarla en silencio (la oficina la ve en la bandeja).
      if (
        esImagen && IA_MODO === "on" &&
        conversaciones[telefono]?.memberId &&
        !botPausado(`${channelId}_${telefono}`)
      ) {
        await enviarNatural(telefono, "¡Gracias por la foto! 📸 Se la paso al equipo para que lo valore mejor. Seguimos por aquí 😊");
      }
      return res.sendStatus(200);
    }

    // ── Canal BOT/Soporte: reconstruir encuestas tras un redeploy ─────
    // Las encuestas en frío salen por este canal y la respuesta puede
    // llegar horas después, cuando `conversaciones` (memoria) ya se vació.
    // Si el cliente tiene una encuesta en curso (Redis), se reconstruye el
    // paso resena_nps antes de cualquier otra comprobación.
    const CANAL_SOPORTE = "69fda40ba6876fcf26d5407f";
    if (channelId === CANAL_SOPORTE &&
        !(conversaciones[telefono]?.step || "").startsWith("resena_") &&
        resenasEnCurso[telefono] &&
        Date.now() - (resenasEnCurso[telefono].ts || 0) < 7 * 24 * 3600 * 1000) {
      if (!conversaciones[telefono]) resetearConversacion(telefono);
      const est = conversaciones[telefono];
      est.memberId  = memberId;
      est.channelId = channelId;
      est.step      = "resena_nps";
      est.resena    = { refParte: resenasEnCurso[telefono].refParte || null, caseId: resenasEnCurso[telefono].caseId || null, intentos: 0 };
      console.log(`[Reseñas] Encuesta en curso reconstruida para ${telefono} (parte ${est.resena.refParte || "—"})`);
    }

    // Lo mismo para seguimientos de presupuesto con toque pendiente de
    // respuesta: se reconstruye el paso presu_respuesta tras un redeploy.
    if (channelId === CANAL_SOPORTE && !(conversaciones[telefono]?.step || "").match(/^(resena_|presu_)/)) {
      const segAbierto = Object.values(seguimientosPresu).find(
        (s) => s.clave === telefono && ["en_curso", "fin_marta", "toque1", "toque2", "toque3"].includes(s.estado) &&
               (s.enviados || s.toque1Ts) &&
               Date.now() - (s.ultimoMensajeTs || s.toque3Ts || s.toque2Ts || s.toque1Ts || 0) < 7 * 24 * 3600 * 1000
      );
      if (segAbierto) {
        if (!conversaciones[telefono]) resetearConversacion(telefono);
        const est = conversaciones[telefono];
        est.memberId  = memberId;
        est.channelId = channelId;
        est.step      = "presu_respuesta";
        est.presu     = { ref: segAbierto.ref, caseId: segAbierto.caseId, toque: (segAbierto.estado === "toque3" || (segAbierto.ultimaPlantilla && segAbierto.ultimaPlantilla === PRESU_PLANTILLA_APARCADO)) ? 3 : null };
        console.log(`[Presupuestos] Seguimiento reconstruido para ${telefono} (${segAbierto.ref})`);
      }
    }

    // Una respuesta a la encuesta postventa o a un seguimiento de
    // presupuesto se procesa siempre, aunque el canal esté en pausa o
    // fuera de horario (son intercambios puntuales).
    const enFlujoResena = /^(resena_|presu_)/.test(conversaciones[telefono]?.step || "");

    // ── BAJA: a cualquier hora y en cualquier chat ──────────────────
    // Si una persona de la oficina lleva el chat, se registra en silencio
    // (la persona ve el mensaje); si no, Marta lo confirma.
    const motivoBaja = detectarBaja(texto, enFlujoResena || !!conversacionCampana(telefono));
    if (motivoBaja) {
      await registrarBaja(telefono, motivoBaja, texto);
      if (!conversaciones[telefono]) resetearConversacion(telefono);
      const est = conversaciones[telefono];
      est.memberId  = memberId;
      est.channelId = channelId;
      if (/^(resena_|presu_)/.test(est.step || "")) est.step = "menu_principal";
      delete est.presu;
      delete est.resena;
      if (!botPausado(`${channelId}_${telefono}`) || enFlujoResena) {
        await enviarMensaje(telefono, RESPUESTA_BAJA[motivoBaja]);
      }
      return res.sendStatus(200);
    }

    // ── Comprobar si el bot está pausado para este cliente en este canal ──
    const claveBot = `${channelId}_${telefono}`;
    if (!enFlujoResena && botPausado(claveBot)) {
      console.log(`[Webhook] Bot pausado para ${telefono} en canal ${channelId} — mensaje ignorado`);
      return res.sendStatus(200);
    }

    // ── Respuestas a las campañas (Navidad y reactivación) ──────────
    // A cualquier hora: Marta contesta, y lo que toca lo pasa a Nieves.
    if (!enFlujoResena && (conversacionCampana(telefono) || etiquetaEntradaNavidad(texto))) {
      try {
        if (await manejarRespuestaCampana({ telefono, memberId, channelId, texto, tipoEvento: "TEXT" })) return res.sendStatus(200);
      } catch (e) { console.error("[Campañas] Respuesta:", e.message); }
    }
    // Cliente de la casa: lo ve la oficina directamente
    if (!enFlujoResena && campanas.contactos[claveBaja(telefono)]?.casa) {
      try { if (await manejarClienteDeLaCasa({ telefono, memberId, channelId, texto })) return res.sendStatus(200); }
      catch (e) { console.error("[Campañas] Cliente de la casa:", e.message); }
    }

    // ── Canal Soporte (encuestas/reseñas) — derivar a agente humano ──
    // Este canal se usa para envíos automáticos. Si un cliente responde,
    // pausamos el bot, avisamos al agente de turno y le decimos que le
    // llamamos — SALVO que esté contestando una encuesta postventa: esa
    // respuesta la gestiona Marta (nota 0-10, enlace de Google...).
    if (channelId === CANAL_SOPORTE && !enFlujoResena) {
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
    // Solo se considera lead del anuncio a quien llega CON SEÑAL del
    // anuncio: el referral de Meta o una mención explícita ("vi tu
    // anuncio"). Quien pregunta por puertas de forma orgánica sigue el
    // flujo normal de Marta (presupuesto, urgencia...), que recoge sus
    // datos y avisa a la oficina como corresponde.
    if (!etiquetaEntradaNavidad(texto) && captacionActiva(telefono) ||
        (CAPTACION_ANUNCIO && !etiquetaEntradaNavidad(texto) && !conversaciones[telefono] && esContactoNuevo(telefono) &&
         (tieneReferralAnuncio(req.body) || mencionaAnuncio(texto)))) {
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
// CAMPAÑAS COMERCIALES — Navidad 2026 y reactivación de clientes
// Documento: «Instrucciones para Marta · Navidad y reactivación» (28/10/2026)
// Marta envía las plantillas que prepara la oficina (listas subidas en
// /admin/campanas), consigue el «Sí, llamadme» y se lo pasa a Nieves con
// su etiqueta. No vende ni da precios a estos clientes.
// ============================================================
const CAMP_TEXTOS = {
  nav: "Hola, {{1}}. Somos Ibérica Seguridad, cerrajería de Almería; te atendimos {{2}} para {{3}}. Antes de las fiestas queremos saber si a tu puerta le falta algo: en una llamada de tres minutos te orientamos y, si conviene mejorar algo, te damos precio cerrado. Que en Navidad las únicas visitas sorpresa sean las de la familia. ¿Te llamamos? (Para urgencias, llama al 950 088 086.) Si no quieres más mensajes, responde BAJA.",
  navRecordatorio: "Hola, {{1}}. Te escribimos hace unos días desde Ibérica Seguridad. Si te viene bien, te llamamos tres minutos y te orientamos sobre tu puerta; puedes dejarla lista antes de Navidad o con fecha para enero. Si no, no te volvemos a escribir con esto. ¿Te llamamos?",
  t7: "Hola {{1}}, soy Marta, de Ibérica Seguridad. Como has hablado con Nieves, ya eres cliente de la casa. Guarda este número: lo que escribas aquí lo ve la oficina directamente y, si coinciden dos urgencias, la tuya va delante. Te avisaremos cuando el técnico pase por tu zona. Contigo, hasta dejarlo resuelto. Para no recibir más mensajes, responde BAJA.",
  t3: "Hola {{1}}, soy Marta, de Ibérica Seguridad. Nieves te ha llamado un par de veces; no es nada urgente. Queríamos agradecerte la confianza de estos años y ofrecerte una revisión de tu puerta sin coste cuando el técnico pase por tu zona. Si te interesa, responde SÍ. Para no recibir más mensajes, BAJA.",
  t4: "Hola {{1}}, soy Marta, de Ibérica Seguridad. Hace un año te hicimos {{2}}. Un repaso de la cerradura, con engrase y ajuste, ayuda a que siga funcionando como el primer día. Si quieres que te avisemos cuando el técnico pase por tu zona, responde SÍ. Para no recibir más mensajes, BAJA.",
  t5: "Hola {{1}}, soy Marta, de Ibérica Seguridad. Antes de las vacaciones conviene tener claras dos cosas: que la puerta cierra bien con todas sus vueltas y quién tiene copia de tus llaves. Si quieres que revisemos la cerradura o el bombín antes de agosto, responde SÍ y te llama Nieves. Para no recibir más mensajes, BAJA.",
  t6: "Hola {{1}}, soy Marta, de Ibérica Seguridad. Si este mes entra un inquilino nuevo en alguno de tus pisos, cambiar el bombín entre uno y otro es la forma más sencilla de saber quién tiene llave. Lo coordinamos contigo o con el inquilino. ¿Te llama Nieves? Responde SÍ. Para no recibir más mensajes, BAJA.",
};

// Cada campaña: plantilla (variable de Railway), variables, días y cupo.
// "dias": días de la semana permitidos (1 = lunes … 4 = jueves).
const CAMPANAS_CONFIG = {
  NAV26: {
    nombre: "Navidad 2026 · Tu puerta, lista antes de las fiestas", envPlantilla: "NAV_TEMPLATE", texto: "nav",
    variables: ["nombre", "cuando", "trabajo"], etiqueta: "NAV26-WA", comercial: true, control: true,
    dias: [1, 2, 3, 4], cupo: { 1: 40, 2: 40, 3: 40, 4: 20 },
    tramos: [["2026-11-10", "2026-11-12"], ["2026-11-16", "2026-12-03"], ["2026-12-09", "2026-12-17"]],
    sinEnvio: ["2026-11-26", "2026-11-27"],
    recordatorio: { envPlantilla: "NAV_TEMPLATE_RECORDATORIO", texto: "navRecordatorio", desde: "2026-12-09", hasta: "2026-12-17", diasDesdeEnvio: 5 },
  },
  "REACT-T7": { nombre: "T7 · Alta «Cliente de la casa»", envPlantilla: "T7_TEMPLATE", texto: "t7", variables: ["nombre"], etiqueta: "REACT-T7", comercial: false, control: false, casa: true, dias: [2, 3, 4], cupo: { 2: 40, 3: 40, 4: 40 } },
  "REACT-T3": { nombre: "T3 · Cliente top que no contestó", envPlantilla: "T3_TEMPLATE", texto: "t3", variables: ["nombre"], etiqueta: "REACT-T3", comercial: true, control: true, dias: [2, 3, 4], cupo: { 2: 40, 3: 40, 4: 40 } },
  "REACT-T4": { nombre: "T4 · Aniversario", envPlantilla: "T4_TEMPLATE", texto: "t4", variables: ["nombre", "trabajo"], etiqueta: "REACT-T4", comercial: true, control: true, aniversario: true, dias: [2, 3, 4], cupo: { 2: 40, 3: 40, 4: 40 } },
  "REACT-T5": { nombre: "T5 · Antes de vacaciones", envPlantilla: "T5_TEMPLATE", texto: "t5", variables: ["nombre"], etiqueta: "REACT-T5", comercial: true, control: true, dias: [2, 3, 4], cupo: { 2: 40, 3: 40, 4: 40 } },
  "REACT-T6": { nombre: "T6 · Cambio de inquilino", envPlantilla: "T6_TEMPLATE", texto: "t6", variables: ["nombre"], etiqueta: "REACT-T6", comercial: true, control: true, dias: [2, 3, 4], cupo: { 2: 40, 3: 40, 4: 40 } },
};
const CAMP_VENTANA = [10 * 60, 10 * 60 + 30];        // 10:00–10:30
const CAMP_MAX_DIA = parseInt(process.env.CAMP_MAX_DIA || "60", 10); // tope global del número
const CAMP_FRENO_NIEVES = parseInt(process.env.CAMP_FRENO_NIEVES || "12", 10);
const CAMP_RECHAZO_MAX = 0.04;                       // BAJAs + fallos > 4 % → se para
const CAMP_PAUSA_ENTRE_MS = parseInt(process.env.CAMP_PAUSA_ENTRE_MS || "20000", 10);
const CAMP_DIAS_CONVERSACION = 21;                   // respuestas que cuentan como de la campaña

const campanas = { listas: {}, contactos: {}, conversaciones: {} };
// listas[id]      = { id, campana, creada, estado: revision|activa|pausada|terminada, motivo, filas: [...] }
// fila            = { k, clave, nombre, cuando, trabajo, estado: pendiente|control|excluido|enviado|fallido, motivo, ts, wamid, entregado, leido, respondio, recordatorioTs }
// contactos[k]    = { comerciales: [ts], sinRespuesta, casa, noCampana: {NAV26: ts} }
// conversaciones[k] = { campana, etiqueta, listaId, ts, paso, presentado, nievesTs, datos }
const campWamid = new Map(); // wamid → [listaId, índice]
let guardadoCampPendiente = null;
function guardarCampanas() {
  if (guardadoCampPendiente) return;
  guardadoCampPendiente = setTimeout(() => { guardadoCampPendiente = null; redisSet("iberica:campanas", campanas); }, 1500);
}
function indexarWamidsCampana() {
  campWamid.clear();
  for (const l of Object.values(campanas.listas)) l.filas.forEach((f, i) => { if (f.wamid) campWamid.set(f.wamid, [l.id, i]); if (f.wamidRec) campWamid.set(f.wamidRec, [l.id, i]); });
}

const diaSemanaMadrid = (f = new Date()) => ({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 })[new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Madrid", weekday: "short" }).format(f)];
function hoyPermitidoCampana(cfg, f = new Date()) {
  const d = diaMadrid(f);
  if (FESTIVOS_ALMERIA[d]) return { ok: false, motivo: "festivo" };
  if (!cfg.dias.includes(diaSemanaMadrid(f))) return { ok: false, motivo: "dia_no_permitido" };
  if (cfg.sinEnvio?.includes(d)) return { ok: false, motivo: "sin_envio_ese_dia" };
  if (cfg.tramos && !cfg.tramos.some(([a, b]) => d >= a && d <= b)) return { ok: false, motivo: "fuera_de_calendario" };
  return { ok: true };
}
const enVentanaCampana = () => { const m = minutosActualesMadrid(); return m >= CAMP_VENTANA[0] && m < CAMP_VENTANA[1]; };

// ── Subir una lista (CSV/TSV copiado del Excel) ─────────────
// Columnas: telefono, nombre, cuando, trabajo (cabecera obligatoria).
function parsearListaCampana(texto) {
  const lineas = String(texto || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lineas.length < 2) return { error: "La lista necesita una fila de cabecera y al menos un cliente" };
  const sep = lineas[0].includes("\t") ? "\t" : lineas[0].includes(";") ? ";" : ",";
  const cab = lineas[0].split(sep).map((c) => normalizaTxt(c).replace(/[^a-z]/g, ""));
  const col = (...n) => cab.findIndex((c) => n.some((x) => c.includes(x)));
  const iTel = col("telefono", "movil", "tel", "whatsapp"), iNom = col("nombre", "cliente"), iCuando = col("cuando", "fecha"), iTrab = col("trabajo", "servicio");
  if (iTel < 0) return { error: "Falta la columna «telefono»" };
  const filas = lineas.slice(1).map((l) => {
    const c = l.split(sep).map((x) => x.trim().replace(/^"|"$/g, ""));
    return { telefono: c[iTel] || "", nombre: iNom >= 0 ? c[iNom] || "" : "", cuando: iCuando >= 0 ? c[iCuando] || "" : "", trabajo: iTrab >= 0 ? c[iTrab] || "" : "" };
  });
  return { filas };
}

const NO_PARTICULAR = /(\bs\.?\s?l\.?u?\b|\bs\.\s?a\.?\b|\bsociedad\b|\bcom\.?\s?prop|comunidad|propietarios|\bc\.\s?p\.|\bccpp\b|administraci[oó]n|inmobiliaria|\bhotel\b|\bbar\b|\brestaurante\b|\bgrupo\b|\bs\.?c\.?a?\b|parroquia|iglesia|sindicato|ayuntamiento|asociaci[oó]n)/i;

function crearListaCampana(campana, texto) {
  const cfg = CAMPANAS_CONFIG[campana];
  if (!cfg) return { ok: false, error: "Campaña desconocida" };
  const p = parsearListaCampana(texto);
  if (p.error) return { ok: false, error: p.error };
  const vistos = new Set();
  const filas = p.filas.map((r) => {
    const d = String(r.telefono).replace(/\D/g, "");
    const clave = d.length === 9 ? `34${d}` : d;
    const k = claveBaja(clave);
    const nombre = String(r.nombre || "").trim().split(/\s+/)[0] || "";
    const nombrePila = nombre ? nombre.charAt(0).toUpperCase() + nombre.slice(1).toLowerCase() : "";
    const f = { k, clave, nombre: nombrePila, nombreCompleto: r.nombre, cuando: r.cuando, trabajo: r.trabajo, estado: "pendiente" };
    if (!telefonoValido(clave) || k.length !== 9 || !/^[67]/.test(k)) { f.estado = "excluido"; f.motivo = "telefono_no_movil"; }
    else if (vistos.has(k)) { f.estado = "excluido"; f.motivo = "duplicado"; }
    else if (esBaja(k)) { f.estado = "excluido"; f.motivo = "baja"; }
    else if (NO_PARTICULAR.test(r.nombre || "")) { f.estado = "excluido"; f.motivo = "no_es_particular"; }
    else if (cfg.variables.includes("nombre") && !nombrePila) { f.estado = "excluido"; f.motivo = "sin_nombre"; }
    else if (cfg.variables.includes("cuando") && !r.cuando) { f.estado = "excluido"; f.motivo = "sin_cuando"; }
    else if (cfg.variables.includes("trabajo") && !r.trabajo) { f.estado = "excluido"; f.motivo = "sin_trabajo"; }
    vistos.add(k);
    return f;
  });
  // Grupo de control: un 10 % al azar no recibe el mensaje
  if (cfg.control) {
    const candidatas = filas.filter((f) => f.estado === "pendiente");
    const n = Math.round(candidatas.length * 0.1);
    for (let i = 0; i < n; i++) {
      const libres = candidatas.filter((f) => f.estado === "pendiente");
      libres[Math.floor(Math.random() * libres.length)].estado = "control";
    }
  }
  const id = `${campana}-${new Date().toISOString().slice(0, 16).replace(/\D/g, "")}-${Math.random().toString(36).slice(2, 5)}`;
  campanas.listas[id] = { id, campana, creada: Date.now(), estado: "revision", filas };
  guardarCampanas();
  return { ok: true, id };
}

const rellenarTexto = (plantilla, valores) => plantilla.replace(/\{\{(\d)\}\}/g, (_, i) => valores[Number(i) - 1] ?? "");
function variablesFila(cfg, f) { return cfg.variables.map((v) => ({ nombre: f.nombre, cuando: f.cuando, trabajo: f.trabajo })[v]); }

// ── Reglas de cada envío ─────────────────────────────────────
function presupuestoAbierto(k) {
  return Object.values(seguimientosPresu).some((s) => claveBaja(s.clave || s.telefono) === k && PRESU_ESTADOS_VIVOS.includes(s.estado));
}
function motivoNoEnviar(cfg, f, { recordatorio = false } = {}) {
  const c = campanas.contactos[f.k] || {};
  const ahora = Date.now(), dia = 24 * 3600 * 1000;
  if (esBaja(f.k)) return "baja";
  if (presupuestoAbierto(f.k)) return "presupuesto_abierto";
  if (c.noCampana?.[cfg.campana]) return "dijo_no_a_esta_campana";
  if (cfg.comercial && !recordatorio) {
    const recientes = (c.comerciales || []).filter((t) => ahora - t < 365 * dia);
    if (recientes.some((t) => ahora - t < 30 * dia)) return "mensaje_comercial_hace_menos_de_30_dias";
    if (recientes.length >= 4) return "ya_tiene_4_mensajes_este_ano";
    if ((c.sinRespuesta || 0) >= 3 && !cfg.aniversario) return "solo_aniversario_3_sin_respuesta";
  }
  return null;
}

// Zoho: casilla «WhatsApp Opt Out» del contacto (si existe)
const CAMPO_OPTOUT = process.env.ZOHO_CAMPO_OPTOUT || "WhatsApp_Opt_Out";
async function contactoZohoPorTelefono(k) {
  const token = await obtenerTokenZoho();
  const r = await axios.get(`https://www.zohoapis.eu/crm/v2/Contacts/search?phone=${k}`, { headers: { Authorization: `Zoho-oauthtoken ${token}` } });
  return { token, contactos: r.data?.data || [] };
}
async function optOutEnZoho(k) {
  try {
    const { contactos } = await contactoZohoPorTelefono(k);
    return contactos.some((c) => c[CAMPO_OPTOUT] === true);
  } catch (_) { return false; }
}
async function marcarOptOutZoho(k) {
  try {
    const { token, contactos } = await contactoZohoPorTelefono(k);
    if (!contactos.length) return "sin_contacto_en_zoho";
    await axios.put("https://www.zohoapis.eu/crm/v2/Contacts", { data: contactos.map((c) => ({ id: c.id, [CAMPO_OPTOUT]: true })) },
      { headers: { Authorization: `Zoho-oauthtoken ${token}`, "Content-Type": "application/json" } });
    return "ok";
  } catch (e) {
    console.error("[Bajas] No se pudo marcar WhatsApp Opt Out en Zoho:", JSON.stringify(e.response?.data || e.message).slice(0, 200));
    return "error";
  }
}

async function enviarPlantillaCampana(f, plantilla, variables) {
  const canalBot = process.env.WOZTELL_CHANNEL_ID;
  const m = await buscarOCrearMiembroWoztell(canalBot, f.clave, f.nombre);
  if (!conversaciones[f.clave]) resetearConversacion(f.clave);
  conversaciones[f.clave].memberId = m.memberId;
  conversaciones[f.clave].channelId = canalBot;
  actividad[f.clave] = { ...(actividad[f.clave] || { mensajesTotal: 0 }), canalId: canalBot, memberId: m.memberId };
  return enviarPlantillaWoztell(f.clave, plantilla, variables, "es");
}

// Conversaciones con Nieves aún abiertas (pasadas en las últimas 48 h)
const abiertasNieves = () => Object.values(campanas.conversaciones).filter((c) => c.nievesTs && Date.now() - c.nievesTs < 48 * 3600 * 1000 && !c.cerrada).length;

function rechazoLista(l) {
  const enviados = l.filas.filter((f) => ["enviado", "fallido"].includes(f.estado)).length;
  const malos = l.filas.filter((f) => f.estado === "fallido" || (f.estado === "enviado" && esBaja(f.k) && f.ts && (bajas[f.k]?.ts || 0) >= f.ts)).length;
  return { enviados, malos, tasa: enviados ? malos / enviados : 0 };
}

// BAJAs + fallos por encima del 4 % (con 25 envíos o más) → se para la lista
async function pararSiRechazoAlto(l) {
  const r = rechazoLista(l);
  if (r.enviados < 25 || r.tasa <= CAMP_RECHAZO_MAX) return false;
  l.estado = "pausada"; l.motivo = `rechazo ${(r.tasa * 100).toFixed(1)} % (BAJAs + fallos)`; guardarCampanas();
  await avisarEquipoCampana(`⛔ Campaña ${l.campana} PARADA: ${l.motivo} en ${r.enviados} envíos. Revisar antes de seguir.`);
  return true;
}

let tandaEnCurso = false;
const enviadosHoy = () => {
  const hoy = diaMadrid(new Date());
  let n = 0;
  for (const l of Object.values(campanas.listas)) for (const f of l.filas) {
    if (f.ts && diaMadrid(new Date(f.ts)) === hoy && ["enviado", "fallido"].includes(f.estado)) n++;
    if (f.recordatorioTs && diaMadrid(new Date(f.recordatorioTs)) === hoy) n++;
  }
  return n;
};
const enviadosHoyCampana = (campana) => {
  const hoy = diaMadrid(new Date());
  let n = 0;
  for (const l of Object.values(campanas.listas)) if (l.campana === campana) for (const f of l.filas) {
    if (f.ts && diaMadrid(new Date(f.ts)) === hoy && ["enviado", "fallido"].includes(f.estado)) n++;
    if (f.recordatorioTs && diaMadrid(new Date(f.recordatorioTs)) === hoy) n++;
  }
  return n;
};

async function avisarEquipoCampana(texto) {
  const ahoraStr = new Date().toLocaleString("es-ES", { timeZone: "Europe/Madrid", hour12: false });
  for (const d of [NOTIFICACIONES_CONFIG.nieves, NOTIFICACIONES_CONFIG.mari]) {
    await enviarNotificacionAgente(d, { nombre: "Campañas de Marta", telefono: "—", direccion: "—", descripcion: texto, apertura: ahoraStr, refParte: "—", agente: "Marta · Campañas" }).catch(() => {});
  }
}

// Una tanda: cada minuto se mira si toca; dentro de la ventana se envía de
// uno en uno, respetando cupos, freno de Nieves y parada por rechazo.
async function tandaCampanas({ forzar = false } = {}) {
  if (tandaEnCurso) return { ok: false, motivo: "tanda_en_curso" };
  if (!forzar && !enVentanaCampana()) return { ok: false, motivo: "fuera_de_ventana" };
  tandaEnCurso = true;
  const resumen = { enviados: 0, excluidos: 0, fallidos: 0, avisos: [] };
  try {
    if (abiertasNieves() > CAMP_FRENO_NIEVES) { resumen.avisos.push(`freno: Nieves tiene ${abiertasNieves()} conversaciones abiertas`); return resumen; }
    const activas = Object.values(campanas.listas).filter((l) => l.estado === "activa").sort((a, b) => a.creada - b.creada);
    for (const l of activas) {
      const cfg = { ...CAMPANAS_CONFIG[l.campana], campana: l.campana };
      const hoy = hoyPermitidoCampana(cfg);
      if (!hoy.ok && !forzar) { resumen.avisos.push(`${l.id}: ${hoy.motivo}`); continue; }
      const plantilla = process.env[cfg.envPlantilla];
      if (!plantilla) { resumen.avisos.push(`${l.id}: falta la variable ${cfg.envPlantilla}`); continue; }
      const cupo = forzar ? Math.max(...Object.values(cfg.cupo)) : cfg.cupo[diaSemanaMadrid()] || 0;
      if (await pararSiRechazoAlto(l)) { resumen.avisos.push(`${l.id}: parada por rechazo`); continue; }
      // Recordatorio único (Navidad, ola 2)
      const rec = cfg.recordatorio;
      const colaRec = rec && diaMadrid(new Date()) >= rec.desde && diaMadrid(new Date()) <= rec.hasta && process.env[rec.envPlantilla]
        ? l.filas.filter((f) => f.estado === "enviado" && f.entregado && !f.respondio && !f.recordatorioTs && Date.now() - f.ts >= rec.diasDesdeEnvio * 24 * 3600 * 1000)
        : [];
      const cola = [...colaRec.map((f) => [f, true]), ...l.filas.filter((f) => f.estado === "pendiente").map((f) => [f, false])];
      for (const [f, esRec] of cola) {
        if (!forzar && !enVentanaCampana()) break;
        if (enviadosHoyCampana(l.campana) >= cupo || enviadosHoy() >= CAMP_MAX_DIA) break;
        if (l.estado !== "activa") break;
        const motivo = motivoNoEnviar(cfg, f, { recordatorio: esRec }) || (await optOutEnZoho(f.k) ? "whatsapp_opt_out_en_zoho" : null);
        if (motivo) {
          if (!esRec) { f.estado = "excluido"; f.motivo = motivo; resumen.excluidos++; } else { f.recordatorioTs = -1; }
          guardarCampanas();
          continue;
        }
        let res;
        try { res = await enviarPlantillaCampana(f, esRec ? process.env[rec.envPlantilla] : plantilla, esRec ? [f.nombre] : variablesFila(cfg, f)); }
        catch (e) { res = { ok: false, detalle: e.message }; }
        const c = (campanas.contactos[f.k] = campanas.contactos[f.k] || { comerciales: [], sinRespuesta: 0 });
        if (res.ok) {
          if (esRec) { f.recordatorioTs = Date.now(); if (res.wamid) { f.wamidRec = res.wamid; campWamid.set(res.wamid, [l.id, l.filas.indexOf(f)]); } }
          else {
            f.estado = "enviado"; f.ts = Date.now(); f.wamid = res.wamid || null;
            if (res.wamid) campWamid.set(res.wamid, [l.id, l.filas.indexOf(f)]);
            if (cfg.comercial) { c.comerciales.push(Date.now()); c.sinRespuesta = (c.sinRespuesta || 0) + 1; }
            if (cfg.casa) c.casa = Date.now();
          }
          // La T7 no es una oferta: lo que escriba un cliente de la casa va a la oficina
          if (!cfg.casa) campanas.conversaciones[f.k] = { ...(campanas.conversaciones[f.k] || {}), campana: l.campana, etiqueta: cfg.etiqueta, listaId: l.id, ts: Date.now(), paso: null, cerrada: null };
          resumen.enviados++;
        } else if (!esRec) {
          if (/limite_de_creacion/.test(String(res.detalle))) break; // se sigue en la próxima vuelta
          f.estado = "fallido"; f.ts = Date.now(); f.motivo = String(res.detalle || "").slice(0, 160); resumen.fallidos++;
          if (await pararSiRechazoAlto(l)) { resumen.avisos.push(`${l.id}: parada por rechazo`); break; }
          if (/\b132\d{3}\b/.test(String(res.detalle))) {
            l.estado = "pausada"; l.motivo = `la plantilla ${plantilla} falla en Meta`; guardarCampanas();
            await avisarEquipoCampana(`⛔ Campaña ${l.campana} PARADA: la plantilla ${plantilla} no funciona (${String(res.detalle).slice(0, 80)}).`);
            break;
          }
        }
        guardarCampanas();
        if (CAMP_PAUSA_ENTRE_MS) await new Promise((r) => setTimeout(r, CAMP_PAUSA_ENTRE_MS));
      }
      if (!l.filas.some((f) => f.estado === "pendiente") && !(rec && diaMadrid(new Date()) <= rec.hasta)) { l.estado = "terminada"; guardarCampanas(); }
    }
  } finally { tandaEnCurso = false; }
  if (resumen.enviados || resumen.fallidos) console.log("[Campañas] Tanda:", JSON.stringify(resumen));
  return resumen;
}

// Acuses de las plantillas de campaña (entregado / leído / fallido)
function marcarAcuseCampana(wamid, tipo) {
  const ref = campWamid.get(wamid);
  if (!ref) return false;
  const f = campanas.listas[ref[0]]?.filas[ref[1]];
  if (!f) return false;
  if (tipo === "DELIVERED" || tipo === "READ") f.entregado = true;
  if (tipo === "READ") f.leido = true;
  if (tipo === "FAILED" && f.estado === "enviado" && f.wamid === wamid) { f.estado = "fallido"; f.motivo = "no_entregado"; }
  guardarCampanas();
  return true;
}

// ── Respuestas de Marta ──────────────────────────────────────
const PRESENTACION_CAMPANA = "Soy Marta, el asistente automático de WhatsApp de Ibérica Seguridad. Las llamadas y los precios los lleva Nieves, de la oficina.";
const TXT_URGENCIA = "Si estás fuera de casa o es urgente, llama ahora al 950 088 086: te atendemos las 24 horas. Si no es urgente, dímelo y seguimos por aquí.";
const TXT_VIOLENCIA = "Entendido. Le paso tu mensaje a Nieves como prioridad y te llama hoy mismo para cambiar la cerradura cuanto antes. No tienes que contarnos nada más. Si en algún momento estás en peligro, llama al 112; el 016 te atiende las 24 horas y no deja rastro en la factura.";
const PRECIO_WEB = process.env.CAMP_TEXTO_PRECIO_WEB || "El bombín de seguridad instalado son 99 € y con escudo 199 €, con IVA, desplazamiento y 5 llaves nuevas. Nieves te dice en tres minutos cuál le conviene a tu puerta.";
const LEVANTE = /(carboneras|mojacar|vera\b|garrucha|turre|cuevas del almanzora|pulpi|huercal.overa|antas|los gallardos|bedar)/;

// ¿Cuándo llama Nieves? Oficina: laborables de 9:00 a 19:00. null = hoy, ya.
function cuandoLlamaNieves(f = new Date()) {
  const hm = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit", hour12: false }).format(f).split(":").map(Number);
  const m = hm[0] * 60 + hm[1];
  if (esLaborable(f) && m >= 9 * 60 && m < 19 * 60) return null;
  if (esLaborable(f) && m < 9 * 60) return "esta mañana";
  const dia = 24 * 3600 * 1000;
  let d = new Date(f.getTime() + dia);
  for (let i = 0; i < 10 && !esLaborable(d); i++) d = new Date(d.getTime() + dia);
  if (diaMadrid(d) === diaMadrid(new Date(f.getTime() + dia))) return "mañana";
  return "el " + new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", weekday: "long" }).format(d);
}
const teLlamaNieves = (extra = "") => {
  const cuando = cuandoLlamaNieves();
  return cuando
    ? `Ahora la oficina está cerrada. Nieves te llama ${cuando} desde el 950 088 086.${extra}`
    : `¡Genial! Te llama Nieves desde el 950 088 086. Guárdalo y así sabrás que somos nosotros.${extra}`;
};

// Frases de entrada desde la web, Instagram/Facebook o anuncios
function etiquetaEntradaNavidad(texto) {
  const t = normalizaTxt(texto);
  if (!/puerta lista para las fiestas|lista para las fiestas/.test(t)) return null;
  if (/\bweb\b/.test(t)) return "NAV26-WEB";
  if (/\bvideo\b/.test(t)) return "NAV26-ORG";
  if (/\banuncio\b/.test(t)) return "NAV26-ADS";
  return "NAV26-WEB";
}

function conversacionCampana(telefono) {
  const k = claveBaja(telefono);
  const c = campanas.conversaciones[k];
  if (!c || c.cerrada) return null;
  if (Date.now() - (c.ts || 0) > CAMP_DIAS_CONVERSACION * 24 * 3600 * 1000) return null;
  return c;
}

function clasificarRespuestaCampanaReglas(texto, paso) {
  const t = normalizaTxt(texto).replace(/[¡!¿?.,;:"'()]/g, " ").replace(/\s+/g, " ").trim();
  if (/^(si|sii+) llamadme$|^si,? llamadme|^llamadme|^si,? (por favor|claro|vale)?$|^si$|^vale$|^ok$|^claro$|^me interesa|^si me interesa/.test(t)) return "si";
  if (/^mejor en enero|en enero|despues de reyes|despues de navidad|mas adelante/.test(t)) return "enero";
  if (/^no,? gracias|^no me interesa|^no$|^no hace falta|^ahora no/.test(t)) return "no";
  if (paso === "franja" && /(manana|tarde|cualquier|me da igual|mediodia|primera hora|\d{1,2}(:\d\d)? ?(h|horas)?)/.test(t)) return "franja";
  if (/(cuanto|precio|cuesta|vale |coste|presupuesto)/.test(t)) return "precio";
  if (/(gratis|sin coste|cuesta algo|venis a verla|venis a mirar|visita)/.test(t)) return "gratis";
  if (/(timo|estafa|es vuestro|quien sois|es real|de verdad sois|fraude|spam)/.test(t)) return "timo";
  if (/(vais|venis|llegais|cubris|trabajais) (hasta|a|en|por) /.test(t)) return "cobertura";
  if (/(robot|maquina|eres una persona|eres real)/.test(t)) return "robot";
  if (/(alquiler|alquilado|inquilino|casero|piso que alquilo)/.test(t)) return "alquiler";
  if (/(negocio|local|tienda|oficina|empresa)/.test(t)) return "negocio";
  if (/(han robado|robaron|entraron|han entrado) (en|a) (mi )?(vecin|el edificio|la calle|mi calle|el bloque|al lado)/.test(t)) return "robo_cerca";
  if (/(un amigo|una amiga|mi hermano|mi hermana|mi madre|mi padre|mi vecino|mi vecina|os recomiendo|le he pasado|de parte de)/.test(t)) return "recomienda";
  if (/acorazad/.test(t)) return "acorazada";
  if (/(queja|reclamacion|me cobrasteis|mal servicio|muy mal|fatal|desastre|no funciona bien|se rompio)/.test(t)) return "queja";
  if (paso === "llave") return "llave";
  return "otro";
}
async function clasificarRespuestaCampana(texto, paso) {
  const porReglas = clasificarRespuestaCampanaReglas(texto, paso);
  if (porReglas !== "otro" || !process.env.OPENAI_API_KEY) return porReglas;
  try {
    const res = await Promise.race([
      openai.chat.completions.create({
        model: "gpt-4o-mini", temperature: 0, max_tokens: 10,
        messages: [
          { role: "system", content: `Un cliente de una cerrajería contesta a un WhatsApp que le ofrece una llamada de tres minutos para orientarle sobre su puerta${paso ? ` (paso actual: ${paso})` : ""}. Clasifica su respuesta con UNA palabra: si (quiere que le llamen), enero (mejor más adelante), no (no le interesa), franja (dice si mejor mañana o tarde), llave (da la marca de la llave o datos de la puerta), precio, gratis (pregunta si cuesta la llamada o la visita), timo (duda si somos nosotros), cobertura (pregunta si vamos a su pueblo), robot, alquiler, negocio, robo_cerca, recomienda, acorazada, queja, otro.` },
          { role: "user", content: String(texto).slice(0, 400) },
        ],
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 8000)),
    ]);
    const c = normalizaTxt(res.choices?.[0]?.message?.content || "").replace(/[^a-z_]/g, "");
    return ["si", "enero", "no", "franja", "llave", "precio", "gratis", "timo", "cobertura", "robot", "alquiler", "negocio", "robo_cerca", "recomienda", "acorazada", "queja", "otro"].includes(c) ? c : "otro";
  } catch (_) { return porReglas; }
}

const URGENCIA_CAMPANA = /(estoy fuera|me he quedado fuera|sin llaves?|no puedo entrar|urgente|urgencia|me han robado|han entrado en (mi|casa)|robo en (mi|casa)|se me ha roto la llave|llave rota|no abre la puerta|no puedo abrir)/;
const VIOLENCIA_CAMPANA = /(mi ex\b|ex pareja|expareja|ex marido|ex mujer|exmarido|me amenaza|amenaza|no me devuelve la llave|no quiere devolver|tiene llave y|maltrat|orden de alejamiento)/;

async function avisarNievesCampana(telefono, conv, descripcion, prioridad = false) {
  const k = claveBaja(telefono);
  const ahoraStr = new Date().toLocaleString("es-ES", { timeZone: "Europe/Madrid", hour12: false });
  conv.nievesTs = conv.nievesTs || Date.now();
  await enviarNotificacionAgente(NOTIFICACIONES_CONFIG.nieves, {
    nombre: conversaciones[telefono]?.nombre || conv.nombre || `Cliente ${k}`,
    telefono: k, direccion: "—",
    descripcion: `${prioridad ? "🚨 PRIORIDAD · " : ""}[${conv.etiqueta}] ${descripcion}`,
    apertura: ahoraStr, refParte: "—", agente: `Marta · ${conv.etiqueta}`,
  }).catch((e) => console.error("[Campañas] Aviso a Nieves:", e.message));
}
async function avisarNoemiCampana(telefono, conv, descripcion) {
  const ahoraStr = new Date().toLocaleString("es-ES", { timeZone: "Europe/Madrid", hour12: false });
  const destino = NOTIFICACIONES_CONFIG.noemi || NOTIFICACIONES_CONFIG.mari;
  await enviarNotificacionAgente(destino, { nombre: `Cliente ${claveBaja(telefono)}`, telefono: claveBaja(telefono), direccion: "—", descripcion: `⚠️ QUEJA (para Noemí) [${conv.etiqueta}]: ${descripcion}`, apertura: ahoraStr, refParte: "—", agente: "Marta · Campañas" }).catch(() => {});
}

function marcarRespuestaFila(conv) {
  const l = campanas.listas[conv.listaId];
  const k = conv.k;
  const f = l?.filas.find((x) => x.k === k && x.estado === "enviado");
  if (f && !f.respondio) f.respondio = Date.now();
  const c = campanas.contactos[k];
  if (c) c.sinRespuesta = 0;
}

// Devuelve true si el mensaje era de una campaña y ya está contestado.
async function manejarRespuestaCampana({ telefono, memberId, channelId, texto, tipoEvento }) {
  const k = claveBaja(telefono);
  let conv = conversacionCampana(telefono);
  const etiquetaEntrada = !conv && tipoEvento === "TEXT" ? etiquetaEntradaNavidad(texto) : null;
  let recienLlegado = false;
  if (!conv && etiquetaEntrada) {
    conv = campanas.conversaciones[k] = { campana: "NAV26", etiqueta: etiquetaEntrada, ts: Date.now(), paso: "entrada", entrada: true };
    recienLlegado = true;
  }
  if (!conv) return false;
  conv.k = k;
  if (!conversaciones[telefono]) resetearConversacion(telefono);
  const est = conversaciones[telefono];
  est.memberId = memberId; est.channelId = channelId;
  const t = normalizaTxt(texto || "");
  const responder = async (msg) => {
    const pre = conv.presentado ? "" : PRESENTACION_CAMPANA + "\n\n";
    conv.presentado = true;
    await enviarMensaje(telefono, pre + msg);
  };
  marcarRespuestaFila(conv);
  conv.ts = Date.now();
  guardarCampanas();

  // Audios y fotos
  if (tipoEvento === "AUDIO" || tipoEvento === "VOICE") {
    await responder("¿Me lo puedes escribir en una línea? Si lo prefieres, te llama Nieves.");
    return true;
  }
  if (tipoEvento !== "TEXT") {
    if (conv.paso === "llave" || conv.paso === "con_nieves" || conv.paso === "franja") {
      await responder("¡Gracias por la foto! Se la paso a Nieves para que te oriente.");
      await avisarNievesCampana(telefono, conv, "ha mandado una foto de la cerradura (verla en el chat de Marta)");
      conv.paso = "con_nieves";
      guardarCampanas();
      return true;
    }
    return false;
  }

  // Urgencias, por delante de todo
  if (URGENCIA_CAMPANA.test(t) && !/\bno (es|era) (urgente|una urgencia)|sin prisa|no corre prisa/.test(t)) { conv.urgencia = Date.now(); await responder(TXT_URGENCIA); return true; }
  if (VIOLENCIA_CAMPANA.test(t)) {
    await responder(TXT_VIOLENCIA);
    await avisarNievesCampana(telefono, conv, `posible violencia / llave no devuelta: "${texto.slice(0, 120)}". Cambiar cerradura en 24-48 h.`, true);
    conv.paso = "con_nieves"; guardarCampanas();
    return true;
  }

  // Llega desde la web, Instagram/Facebook o un anuncio con la frase de Navidad
  if (recienLlegado) {
    await responder(`${PRECIO_WEB} ¿Quieres que te llame Nieves?`);
    guardarCampanas();
    return true;
  }

  const cat = await clasificarRespuestaCampana(texto, conv.paso);
  const esReact = conv.campana !== "NAV26";
  const preguntaFranja = " ¿Mejor por la mañana o por la tarde?";
  switch (cat) {
    case "si": {
      if (esReact && !cuandoLlamaNieves()) await responder(`Perfecto, se lo paso a Nieves y te llama desde el 950 088 086.${preguntaFranja}`);
      else await responder(`${teLlamaNieves()}${preguntaFranja}`);
      conv.paso = "franja";
      await avisarNievesCampana(telefono, conv, `${esReact ? "SÍ" : "Sí, llamadme"} — pendiente de franja${cuandoLlamaNieves() ? ` (escribió fuera de horario: llamar ${cuandoLlamaNieves()})` : ""}`);
      break;
    }
    case "franja": {
      const franja = /tarde/.test(t) ? "por la tarde" : /manana|primera hora/.test(t) ? "por la mañana" : `«${texto.slice(0, 40)}»`;
      conv.datos = { ...(conv.datos || {}), franja };
      await responder(`Apuntado, ${franja === "por la tarde" || franja === "por la mañana" ? franja : "se lo digo"}. Si quieres ir adelantando, dime qué marca pone en tu llave o mándame una foto.`);
      await avisarNievesCampana(telefono, conv, `prefiere que le llamen ${franja}`);
      conv.paso = "llave";
      break;
    }
    case "llave": {
      conv.datos = { ...(conv.datos || {}), llave: texto.slice(0, 80) };
      await responder("¡Gracias! Se lo paso a Nieves para que te oriente en la llamada.");
      await avisarNievesCampana(telefono, conv, `datos de la puerta/llave: "${texto.slice(0, 100)}"`);
      conv.paso = "con_nieves";
      break;
    }
    case "enero":
      await responder("Perfecto. Si quieres, Nieves te llama unos minutos y te lo deja con fecha para la segunda quincena de enero, con el precio cerrado que te diga. Si no, no te escribimos más con esto.");
      conv.paso = "enero";
      break;
    case "no": {
      await responder("Entendido, gracias por contestar. No te escribimos más con esto.");
      const c = (campanas.contactos[k] = campanas.contactos[k] || { comerciales: [], sinRespuesta: 0 });
      c.noCampana = { ...(c.noCampana || {}), [conv.campana]: Date.now() };
      conv.cerrada = Date.now();
      break;
    }
    case "precio":
      if (conv.entrada) { await responder(`${PRECIO_WEB} ¿Te llama Nieves?`); conv.paso = "entrada"; }
      else await responder("Te lo dice Nieves por teléfono con precio cerrado, antes de que vayamos: sin sorpresas al final. ¿Te llama?");
      break;
    case "gratis":
      await responder("La llamada y la orientación no cuestan nada. Si quieres cambiar algo, Nieves te da antes el precio cerrado y el técnico va a instalar, no a mirar.");
      break;
    case "timo":
      await responder("Sí, es nuestro. Este lo usamos para avisos a clientes; para urgencias y consultas, el 950 088 086, también por la noche. Si quieres comprobarlo, llámanos al 950 088 086 o búscanos en Google como Ibérica Seguridad.");
      break;
    case "cobertura":
      if (LEVANTE.test(t)) await responder("Lo siento, a la zona de levante no llegamos. ¡Gracias por escribirnos!");
      else await responder("Sí, a toda la provincia. Fuera de Almería capital y alrededores vamos en días de ruta por zonas; Nieves te dice la fecha de la tuya.");
      break;
    case "robot":
      await responder("Soy un asistente automático, sí 🙂 Las llamadas y los precios los lleva Nieves, de la oficina. ¿Quieres que te llame?");
      await avisarNievesCampana(telefono, conv, "pregunta si es un robot");
      break;
    case "alquiler": case "negocio": case "robo_cerca": case "recomienda": {
      const txt = {
        alquiler: "Entendido, sin problema: lo coordinamos contigo o con el inquilino. Se lo paso a Nieves y te llama.",
        negocio: "Perfecto, también trabajamos para negocios. Se lo paso a Nieves y te llama.",
        robo_cerca: "Entiendo que preocupe. Nieves te llama y te orienta con calma sobre tu puerta.",
        recomienda: "¡Muchas gracias por acordarte de nosotros! Se lo paso a Nieves para que le llame.",
      }[cat];
      await responder(txt);
      await avisarNievesCampana(telefono, conv, `${cat.replace("_", " ")}: "${texto.slice(0, 100)}"`);
      conv.paso = "con_nieves";
      break;
    }
    case "acorazada":
      await responder("¡Apuntado! Las puertas acorazadas las lleva Nieves: se lo paso y te llama.");
      await avisarNievesCampana(telefono, conv, `quiere una puerta ACORAZADA: "${texto.slice(0, 100)}"`);
      conv.paso = "con_nieves";
      break;
    case "queja":
      await responder("Siento mucho lo que nos cuentas. Se lo paso ahora mismo a Noemí, la responsable, para que te llame.");
      await avisarNoemiCampana(telefono, conv, `"${texto.slice(0, 120)}"`);
      conv.paso = "queja";
      break;
    default:
      if (conv.paso === "enero" && /^(si|vale|ok|claro|perfecto)/.test(t)) {
        await responder(`${teLlamaNieves()} Te lo deja con fecha para enero.`);
        await avisarNievesCampana(telefono, conv, "Mejor en enero: quiere que le llame para dejarlo con fecha (2.ª quincena de enero)");
        conv.paso = "con_nieves";
      } else {
        await responder("Se lo paso a Nieves, de la oficina, que te contesta en cuanto pueda.");
        await avisarNievesCampana(telefono, conv, `escribe: "${texto.slice(0, 120)}"`);
      }
  }
  guardarCampanas();
  return true;
}

// Cliente de la casa (T7): lo que escribe lo ve la oficina directamente.
// Se pasa a Mari o a Nieves según el horario y Marta no sigue el chat.
async function manejarClienteDeLaCasa({ telefono, memberId, channelId, texto }) {
  const k = claveBaja(telefono);
  if (!campanas.contactos[k]?.casa || esBaja(k)) return false;
  if (!conversaciones[telefono]) resetearConversacion(telefono);
  const est = conversaciones[telefono];
  est.memberId = memberId; est.channelId = channelId;
  const t = normalizaTxt(texto || "");
  const urgente = URGENCIA_CAMPANA.test(t) && !/\bno (es|era) (urgente|una urgencia)|sin prisa|no corre prisa/.test(t);
  const enHorario = !cuandoLlamaNieves();
  const destino = enHorario ? determinarDestinatarioNotificacion() : urgente ? NOTIFICACIONES_CONFIG.guardia : NOTIFICACIONES_CONFIG.mari;
  const nombreDestino = destino?.nombre === "Guardia" ? "el técnico de guardia" : destino?.nombre || "la oficina";
  await enviarMensaje(telefono, urgente
    ? `Recibido. Si estás fuera de casa o es urgente, llama ahora al 950 088 086: te atendemos las 24 horas. Ya se lo paso a ${nombreDestino}.`
    : enHorario
      ? `Recibido 🙌 Se lo paso ahora mismo a ${nombreDestino}, de la oficina.`
      : "Recibido 🙌 Ahora la oficina está cerrada: te contestan mañana a primera hora. Si es urgente, llama al 950 088 086.");
  const ahoraStr = new Date().toLocaleString("es-ES", { timeZone: "Europe/Madrid", hour12: false });
  await enviarNotificacionAgente(destino, { nombre: est.nombre || `Cliente de la casa ${k}`, telefono: k, direccion: "—", descripcion: `⭐ CLIENTE DE LA CASA escribe: "${String(texto).slice(0, 150)}"`, apertura: ahoraStr, refParte: "—", agente: "Marta · Cliente de la casa" }).catch(() => {});
  pausarBot(`${channelId}_${telefono}`, PAUSA_TAKEOVER_H, "cliente de la casa: lo atiende la oficina");
  return true;
}

function estadisticasCampanas() {
  const listas = Object.values(campanas.listas).sort((a, b) => b.creada - a.creada).map((l) => {
    const n = (fn) => l.filas.filter(fn).length;
    const r = rechazoLista(l);
    return {
      id: l.id, campana: l.campana, nombre: CAMPANAS_CONFIG[l.campana]?.nombre, estado: l.estado, motivo: l.motivo || null,
      creada: new Date(l.creada).toLocaleString("es-ES", { timeZone: "Europe/Madrid", hour12: false }),
      plantilla: process.env[CAMPANAS_CONFIG[l.campana]?.envPlantilla] || `⚠️ falta ${CAMPANAS_CONFIG[l.campana]?.envPlantilla}`,
      total: l.filas.length, pendientes: n((f) => f.estado === "pendiente"), grupoControl: n((f) => f.estado === "control"),
      excluidos: n((f) => f.estado === "excluido"), enviados: n((f) => f.estado === "enviado"), fallidos: n((f) => f.estado === "fallido"),
      entregados: n((f) => f.entregado), leidos: n((f) => f.leido), respondieron: n((f) => f.respondio), recordatorios: n((f) => f.recordatorioTs > 0),
      rechazo: `${(r.tasa * 100).toFixed(1)} %`,
      motivosExclusion: l.filas.filter((f) => f.estado === "excluido").reduce((a, f) => ((a[f.motivo] = (a[f.motivo] || 0) + 1), a), {}),
    };
  });
  const etiquetas = {};
  for (const c of Object.values(campanas.conversaciones)) if (c.nievesTs) etiquetas[c.etiqueta] = (etiquetas[c.etiqueta] || 0) + 1;
  return { ventana: "10:00–10:30", maxDia: CAMP_MAX_DIA, enviadosHoy: enviadosHoy(), abiertasNieves: abiertasNieves(), frenoNieves: CAMP_FRENO_NIEVES, pasadosANievesPorEtiqueta: etiquetas, clientesDeLaCasa: Object.values(campanas.contactos).filter((c) => c.casa).length, listas };
}

// ── Panel de campañas ─────────────────────────────────────────
app.get("/admin/api/campanas", authAdmin, (req, res) => res.json({ ok: true, ...estadisticasCampanas() }));

app.post("/admin/api/campanas/lista", authAdmin, (req, res) => {
  const { campana, texto } = req.body || {};
  const r = crearListaCampana(String(campana || ""), String(texto || ""));
  if (!r.ok) return res.status(400).json(r);
  res.json({ ok: true, id: r.id, lista: estadisticasCampanas().listas.find((l) => l.id === r.id) });
});

// Vista previa: cómo le llega el mensaje a cada cliente (revisar a mano)
app.get("/admin/api/campanas/lista/:id", authAdmin, (req, res) => {
  const l = campanas.listas[req.params.id];
  if (!l) return res.status(404).json({ ok: false, error: "No existe esa lista" });
  const cfg = CAMPANAS_CONFIG[l.campana];
  res.json({
    ok: true, id: l.id, campana: l.campana, estado: l.estado,
    filas: l.filas.map((f) => ({
      telefono: f.k, nombre: f.nombreCompleto, estado: f.estado, motivo: f.motivo || null,
      enviado: f.ts ? new Date(f.ts).toLocaleString("es-ES", { timeZone: "Europe/Madrid", hour12: false }) : null,
      entregado: !!f.entregado, leido: !!f.leido, respondio: !!f.respondio,
      mensaje: rellenarTexto(CAMP_TEXTOS[cfg.texto], variablesFila(cfg, f)),
    })),
  });
});

app.post("/admin/api/campanas/lista/:id/estado", authAdmin, (req, res) => {
  const l = campanas.listas[req.params.id];
  if (!l) return res.status(404).json({ ok: false, error: "No existe esa lista" });
  const estado = String(req.body?.estado || "");
  if (estado === "borrar") {
    if (l.filas.some((f) => f.estado === "enviado")) return res.status(400).json({ ok: false, error: "Ya tiene envíos: páusala en vez de borrarla" });
    delete campanas.listas[l.id]; guardarCampanas();
    return res.json({ ok: true, borrada: true });
  }
  if (!["activa", "pausada", "terminada"].includes(estado)) return res.status(400).json({ ok: false, error: "Estado no válido" });
  if (estado === "activa" && !process.env[CAMPANAS_CONFIG[l.campana].envPlantilla]) {
    return res.status(400).json({ ok: false, error: `Antes hay que poner en Railway la variable ${CAMPANAS_CONFIG[l.campana].envPlantilla} con el nombre de la plantilla aprobada` });
  }
  l.estado = estado; l.motivo = estado === "pausada" ? "pausada a mano" : null;
  guardarCampanas();
  res.json({ ok: true, estado });
});

// Prueba manual de una tanda (?forzar=1 se salta la ventana y el calendario)
app.get("/admin/api/campanas/tanda", authAdmin, async (req, res) => {
  res.json({ ok: true, resumen: await tandaCampanas({ forzar: req.query.forzar === "1" }) });
});

app.get("/admin/campanas", authAdmin, (req, res) => {
  const opciones = Object.entries(CAMPANAS_CONFIG).map(([k, c]) => `<option value="${k}">${c.nombre}</option>`).join("");
  res.send(`<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Campañas de Marta</title>
<style>
:root{--bg:#f5f7f5;--sf:#fff;--ink:#131715;--ink2:#48514c;--rule:#e1e6e2;--verde:#1f882c;--rojo:#b3261e}
@media (prefers-color-scheme:dark){:root{--bg:#0f1210;--sf:#171b18;--ink:#e8ece9;--ink2:#b3bcb6;--rule:#29302b;--verde:#3e9f4e;--rojo:#ec7b70}}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,Segoe UI,sans-serif}
main{max-width:960px;margin:0 auto;padding:20px 16px 60px;display:grid;gap:18px}
section{background:var(--sf);border:1px solid var(--rule);border-radius:10px;padding:16px;display:grid;gap:10px}
h1{font-size:24px;margin:0}h2{font-size:17px;margin:0}
textarea,select,button{font:inherit;border:1px solid var(--rule);border-radius:8px;padding:8px;background:var(--sf);color:var(--ink)}
textarea{min-height:140px;width:100%;box-sizing:border-box}
button{cursor:pointer;background:var(--verde);color:#fff;border:0}button.sec{background:transparent;color:var(--ink);border:1px solid var(--rule)}
.tabla{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:14px}th,td{padding:6px 8px;border-bottom:1px solid var(--rule);text-align:left;vertical-align:top}
.muted{color:var(--ink2);font-size:13px}.err{color:var(--rojo)}.fila{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
</style></head><body><main>
<h1>Campañas de Marta</h1>
<p class="muted">Marta envía de 10:00 a 10:30 (Navidad: lunes a jueves; reactivación: martes a jueves), nunca en festivos. Un 10 % de cada lista queda como grupo de control. Antes de activar una lista, revisa los mensajes.</p>
<section><h2>1 · Subir una lista</h2>
<select id="campana">${opciones}</select>
<p class="muted">Pega desde el Excel con cabecera: <b>telefono</b>, <b>nombre</b> y, en Navidad, <b>cuando</b> («en marzo», «hace un tiempo») y <b>trabajo</b> («abrirte la puerta de casa»). En el aniversario (T4), <b>trabajo</b>.</p>
<textarea id="texto" placeholder="telefono	nombre	cuando	trabajo"></textarea>
<div class="fila"><button onclick="subir()">Subir lista</button><span id="msg" class="muted"></span></div></section>
<section><h2>2 · Listas</h2><div id="resumen" class="muted"></div><div class="tabla" id="listas"></div></section>
<section id="vista" hidden><h2>Vista previa</h2><div class="tabla" id="filas"></div></section>
<script>
const $=(i)=>document.getElementById(i);
async function api(u,o){const r=await fetch(u,o);return r.json();}
async function cargar(){
  const d=await api('/admin/api/campanas');
  $('resumen').textContent='Enviados hoy: '+d.enviadosHoy+' de '+d.maxDia+' · Conversaciones abiertas de Nieves: '+d.abiertasNieves+' (freno a partir de '+d.frenoNieves+') · Clientes de la casa: '+d.clientesDeLaCasa;
  $('listas').innerHTML='<table><tr><th>Lista</th><th>Estado</th><th>Envíos</th><th>Respuesta</th><th></th></tr>'+d.listas.map(l=>'<tr><td><b>'+l.nombre+'</b><br><span class="muted">'+l.creada+' · plantilla: '+l.plantilla+'</span></td><td>'+l.estado+(l.motivo?'<br><span class="err">'+l.motivo+'</span>':'')+'</td><td>'+l.enviados+' enviados · '+l.pendientes+' pendientes<br><span class="muted">'+l.grupoControl+' control · '+l.excluidos+' excluidos · '+l.fallidos+' fallidos</span></td><td>'+l.entregados+' entregados · '+l.respondieron+' respondieron<br><span class="muted">rechazo '+l.rechazo+'</span></td><td class="fila"><button class="sec" onclick="ver(\\''+l.id+'\\')">Ver</button>'+(l.estado!=='activa'&&l.estado!=='terminada'?'<button onclick="estado(\\''+l.id+'\\',\\'activa\\')">Activar</button>':'')+(l.estado==='activa'?'<button class="sec" onclick="estado(\\''+l.id+'\\',\\'pausada\\')">Pausar</button>':'')+(l.enviados===0?'<button class="sec" onclick="estado(\\''+l.id+'\\',\\'borrar\\')">Borrar</button>':'')+'</td></tr>').join('')+'</table>';
}
async function subir(){
  $('msg').textContent='Subiendo…';
  const r=await api('/admin/api/campanas/lista',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({campana:$('campana').value,texto:$('texto').value})});
  $('msg').textContent=r.ok?'Lista subida: '+r.lista.pendientes+' para enviar, '+r.lista.grupoControl+' de control, '+r.lista.excluidos+' excluidos. Revísala antes de activarla.':(r.error||'Error');
  if(r.ok){$('texto').value='';cargar();ver(r.id);}
}
async function estado(id,e){
  if(e==='activa'&&!confirm('¿Activar la lista? Marta empezará a enviar en la próxima ventana de 10:00 a 10:30.'))return;
  const r=await api('/admin/api/campanas/lista/'+id+'/estado',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({estado:e})});
  if(!r.ok)alert(r.error);cargar();
}
async function ver(id){
  const d=await api('/admin/api/campanas/lista/'+id);
  $('vista').hidden=false;
  const esc=(s)=>String(s??'').replace(/[&<>]/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
  $('filas').innerHTML='<table><tr><th>Cliente</th><th>Estado</th><th>Mensaje</th></tr>'+d.filas.map(f=>'<tr><td>'+esc(f.nombre)+'<br><span class="muted">'+f.telefono+'</span></td><td>'+f.estado+(f.motivo?'<br><span class="muted">'+esc(f.motivo)+'</span>':'')+'</td><td>'+esc(f.mensaje)+'</td></tr>').join('')+'</table>';
  $('vista').scrollIntoView({behavior:'smooth'});
}
cargar();
</script></main></body></html>`);
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
  // Seguimiento de presupuestos: sondeo cada 5 min (desfasado del de
  // cierres) y barrido de toques cada 30 min (solo actúa en ventana
  // comercial y con PRESU_AUTO=on)
  setTimeout(sondearPresupuestosEnviados, 3 * 60 * 1000);
  setInterval(sondearPresupuestosEnviados, 5 * 60 * 1000);
  setTimeout(barridoToquesPresupuesto, 5 * 60 * 1000);
  setInterval(barridoToquesPresupuesto, 30 * 60 * 1000);
  // Campañas comerciales: cada minuto se mira si toca tanda (10:00–10:30)
  setInterval(() => tandaCampanas().catch((e) => console.error("[Campañas] Tanda falló:", e.message)), 60 * 1000);

  // Pre-cargar el token de Zoho al arrancar para detectar errores de configuración
  try {
    await obtenerTokenZoho();
    console.log("✅ Token de Zoho obtenido correctamente al arrancar.");
  } catch (err) {
    console.warn("⚠️  No se pudo obtener el token de Zoho al arrancar:", err.message);
    console.warn("   Comprueba ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET y ZOHO_REFRESH_TOKEN en .env");
  }
});
