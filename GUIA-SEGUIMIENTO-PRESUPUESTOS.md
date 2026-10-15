# Seguimiento de presupuestos — Marta comercial

Marta hace el seguimiento de los presupuestos enviados que se quedan sin
respuesta: mensajes suaves por WhatsApp, conversación según lo que conteste
el cliente y, si no hay señal, aviso al equipo para una llamada comercial.
Vive dentro del mismo bot de Railway.

## Técnicas comerciales que aplica

| Referente | Técnica | Cómo la aplica Marta |
|---|---|---|
| Método Sandler | Dejar claro que un «no» es una respuesta aceptable | En sus respuestas a "me lo pienso", "lo tengo que consultar" y "es caro" añade: «Y si al final no os encaja, me lo dices con total confianza, ¿vale? Un no también nos ayuda». El 2.º mensaje ya da esa salida; el 1.º, con la plantilla `seguimiento_presupuesto_v2` (abajo) |
| Gong Labs | Ante «tengo que pensarlo», aclarar qué falta y acordar el siguiente contacto | Pregunta qué le queda por resolver y cuándo le viene bien que le vuelva a escribir. Si da fecha, Marta le escribe ese día; si dice qué le falta, avisa al equipo con ello |
| Sandler, decisiones en comité | Entender quién decide y qué necesita para aprobar | Si lo tiene que ver con otros (pareja, socio, comunidad de vecinos, junta, administrador), pregunta con quién, para cuándo y qué información le ayudaría a presentarlo; lo que pida va al equipo |
| Chris Voss / Black Swan | «¿Habéis abandonado este proyecto?», solo tras varios mensajes sin respuesta | 3.er mensaje opcional, «¿has decidido aparcar el presupuesto?», cuando no contestó a los dos primeros. Un «sí» se entiende como que lo deja, no como que acepta |

Fuentes: [Sandler, prospects que no devuelven la llamada](https://go.sandler.com/salesgrowthmd/insights/blog/categories/prospecting-and-qualifying/why-wont-my-prospects-call-me-back-/) ·
[Black Swan, negociaciones paradas](https://www.blackswanltd.com/newsletter/4-tips-for-jump-starting-stalled-negotiations) ·
[Gong, «I need to think about it»](https://www.gong.io/blog/how-to-respond-when-buyers-say-i-need-to-think-about-it-according-to-data) ·
[Sandler, decisiones en comité](https://go.sandler.com/keystone/insights/blog/categories/management-and-leadership/committees-make-decisions-reps-create-consensus-/?scLang=en-AU)

## Cómo funciona

1. **Detección**: cada 5 min el bot sondea Zoho. Un parte con Estado
   "Presupuesto" y Subestado "enviado" entra en seguimiento. Solo los que
   pasan a ese estado después de activar el circuito. Teléfonos de relleno
   (000000000…) se descartan.
2. **Cadencia** (los mensajes salen solo **L-V de 10:00 a 19:00**, hora
   de Madrid):
   - **Día 3** → mensaje 1: "¿pudiste verlo? ¿dudas?".
   - **Día 8** → mensaje 2: recordatorio con salida fácil.
   - **Día 11** → con `PRESU_TEMPLATE3`: mensaje 3, "¿has aparcado el
     presupuesto?". Sin ella: aviso al equipo para llamar, y fin.
   - **Día 14** (si hubo mensaje 3) → sin respuesta: aviso al equipo para
     llamar, y fin.
3. **Respuestas** (la IA entiende lo que dice el cliente; Marta nunca da
   precios ni presiona; todo queda como nota en el parte):
   - **Acepta** → "te llaman para cuadrar fechas" + 🎯 aviso al equipo.
   - **Le parece caro** → valor (equipo propio, 3 años de garantía,
     financiación), ofrece llamada + "un no también nos ayuda" + 💶 aviso.
   - **Me lo pienso / ahora no** → qué le falta y cuándo volver a
     escribir + "un no también nos ayuda". Con su respuesta: si da fecha,
     recontacto ese día; si pide información, 📋 aviso al equipo.
   - **Lo tengo que consultar** → con quién, para cuándo y qué información
     necesitan + "un no también nos ayuda". Con su respuesta, igual que
     arriba.
   - **No lo va a hacer** → agradecer, guardar presupuesto + ❌ aviso.
   - **Pregunta concreta** → a la oficina (pausa a Marta en ese chat) + ❓.
   Si escribe varios mensajes seguidos, Marta espera 20 s y responde a
   todo junto.
4. **Recontacto acordado**: en la fecha que dio el cliente, Marta le
   escribe con la plantilla del recontacto. Si no contesta en 3 días,
   aviso al equipo para llamar, y fin (sin mensaje 3).
5. **Cancelaciones automáticas**: si el parte cambia de estado en el CRM o
   si una persona de la oficina escribe en el chat, el seguimiento se
   cancela en silencio. Si un mensaje no puede salir en 3 días, se avisa
   al equipo para llamar.
6. **Desde qué número sale**: desde el número donde el cliente ya tiene
   chat; si allí no existe la plantilla, desde el número del BOT. Las
   plantillas hay que crearlas en la cuenta de WhatsApp del número del BOT.

## Plantillas en Meta (categoría Utility, español, variable {{1}} = nombre)

Todas se crean en la cuenta de WhatsApp del **número del BOT**.

**`seguimiento_presupuesto`** (mensaje 1, en uso):

```
Hola {{1}} 👋 Soy Marta, de Ibérica Seguridad. Te escribo por el
presupuesto que te preparamos. ¿Pudiste echarle un vistazo? Si tienes
cualquier duda o quieres ajustar algo, respóndeme por aquí y lo vemos,
sin ningún compromiso 🙂
```

**`seguimiento_presupuesto_v2`** (mensaje 1 con la técnica de Sandler,
propuesta: crearla y cambiar `PRESU_TEMPLATE` cuando Meta la apruebe):

```
Hola {{1}} 👋 Soy Marta, de Ibérica Seguridad. Te escribo por el
presupuesto que te preparamos. ¿Pudiste echarle un vistazo? Si tienes
cualquier duda, respóndeme por aquí y lo vemos. Y si al final no te
encaja, dímelo con total confianza: un no también nos ayuda 🙂
```

**`seguimiento_presupuesto_3`** (mensaje 2 y recontacto acordado, en uso):

```
Hola {{1}}, soy Marta de Ibérica Seguridad 🙂 No quiero resultar pesada,
solo recordarte que tu presupuesto sigue vigente y que cualquier duda te
la resuelvo por aquí. Y si prefieres dejarlo, dímelo y no te escribimos
más por este tema 🙏
```

**`seguimiento_presupuesto_aparcado`** (mensaje 3, técnica de Voss,
opcional: activarlo con `PRESU_TEMPLATE3`):

```
Hola {{1}}, soy Marta de Ibérica Seguridad. No he vuelto a saber de ti
sobre el presupuesto: ¿has decidido aparcarlo? Si es así, con un simple
«sí» me basta y no te escribimos más por este tema 🙂
```

## Variables en Railway

| Variable | Valor | Notas |
|---|---|---|
| `PRESU_AUTO` | `on` | Interruptor general |
| `PRESU_RESPONSABLE` | `mari` | Quién recibe TODOS los avisos de presupuestos (respuestas, sin respuesta, no enviables, plantilla rota): `mari`, `nieves` o `guardia`. Por defecto, Mari |
| `PRESU_TEMPLATE` | `seguimiento_presupuesto` | Mensaje 1 (o `seguimiento_presupuesto_v2` cuando esté aprobada) |
| `PRESU_TEMPLATE2` | `seguimiento_presupuesto_3` | Mensaje 2 (si falta, reutiliza la 1) |
| `PRESU_TEMPLATE3` | `seguimiento_presupuesto_aparcado` | Mensaje 3 «¿has aparcado...?». Sin definir = no hay mensaje 3 |
| `PRESU_TEMPLATE_RECONTACTO` | — | Recontacto en la fecha acordada. Sin definir = usa `PRESU_TEMPLATE2` |
| `PRESU_DIAS_TOQUE1/2/CIERRE` | 3 / 8 / 11 | Opcional, para ajustar la cadencia |
| `PRESU_TEMPLATE_LANG` | `es` | Idioma de las plantillas en Meta. Si aparecen como "Español (España)", poner `es_ES` |
| `PRESU_DIAS_RETRASO_MAX` | 3 | Días que un mensaje puede llevar sin poder salir antes de pasárselo al equipo (estado `no_enviable`) |
| `PRESU_ESPERA_MS` | 20000 | Espera para juntar varios mensajes seguidos del cliente |

## Panel

- `GET /admin/api/presupuestos-stats` — seguimientos vivos, historial y
  conteo por resultado (mensajes enviados, aceptados, objeciones,
  recontactos acordados...).
- `GET /admin/api/presupuestos-resultados` — estado actual en Zoho de cada
  presupuesto en el que Marta escribió al cliente.
- `GET /admin/api/test-presupuestos?forzar=1` — lanza sondeo + barrido a
  mano (forzar=1 se salta la ventana comercial; PRESU_AUTO debe estar on).
