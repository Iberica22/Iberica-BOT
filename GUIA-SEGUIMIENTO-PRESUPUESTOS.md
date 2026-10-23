# Seguimiento de presupuestos — Marta comercial

Sigue el protocolo de seguimiento de presupuestos (15/10/2026): **Marta
escribe, María llama y la oficina cierra en Zoho y FactuSOL**. Marta manda
los WhatsApp del plan y responde a lo que conteste el cliente. Cada día
laborable a las 10:00, María recibe una **agenda** con las llamadas, los
emails y los cierres R6 del día. Vive dentro del mismo bot de Railway.

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
   "Presupuesto" y Subestado "enviado" entra en seguimiento. Solo entran los
   que pasan a ese estado después de activar el circuito. Los teléfonos de
   relleno (000000000…) se descartan.
2. **Tipo de cliente**, sacado del campo **Origen del Parte** de Zoho:
   - Compañía de Seguros → **compañía**;
   - Administrador de Fincas → **comunidad**;
   - Teléfono, Tienda y Recomendación de terceros → **particular**, siempre.

   Si el origen está vacío (-None-), el bot lo deduce del nombre (comunidad,
   empresa con S.L./S.A., o particular).

   **Importe**: el campo Importe del parte NO se usa (ahí va lo facturado).
   La oficina pone una **nota en el parte**, por ejemplo «Presupuesto:
   850 €». Si hay varias cantidades, manda la que va tras «presupuesto»,
   «importe» o «total». Las notas de Marta no cuentan. Si no hay nota, se
   mira la descripción, pero solo si pone «Presupuesto: X €». La nota puede
   ponerse después: el día 7 se vuelve a mirar antes de decidir la llamada.
   Para comprobarlo: `/admin/api/presupuestos-tipos`.
3. **Plan por tipo** (días desde el envío). Los WhatsApp salen solo L-V de
   9:30 a 19:00 y nunca en festivo:

   | Tipo | Marta escribe | María | Cierre R6 |
   |---|---|---|---|
   | Particular | días 2, 5 y 10 | llama el día 7 si pasa de 500 € · llama 2 días después del último mensaje sin respuesta | día 45 |
   | Empresa | días 2, 7, 14 y 21 | igual que particular | día 45 |
   | Comunidad | días 3, 10, 30, 45 y 60 | llama al administrador el día siguiente a la junta | día 90 |
   | Compañía | **nunca** (no se escribe al asegurado) | email al tramitador los días 3, 10 y 20 | día 45 |

   Último mensaje del particular y la empresa: «¿has aparcado el
   presupuesto?» (`PRESU_TEMPLATE3`).
4. **Respuestas**: la IA entiende lo que dice el cliente. Marta nunca da
   precios ni presiona, y todo queda como nota en el parte.
   - **Acepta** → "te llaman para cuadrar fechas" + 🎯 aviso a María.
   - **Le parece caro** → valor (equipo propio, 3 años de garantía,
     financiación), ofrece llamada + "un no también nos ayuda" + 💶 aviso.
   - **Me lo pienso / ahora no** → qué le falta y cuándo le viene bien +
     "un no también nos ayuda". Si da fecha: «¡Perfecto! Te llamamos hacia
     el…» y nota «Volver a llamar dd/mm». Marta deja de escribir y ese día
     sale en la agenda de María. Si pide información: 📋 aviso.
   - **Lo tengo que consultar / lo vemos en la junta** → con quién, para
     cuándo y qué información necesitan. Con la fecha de la junta: «Después
     de la junta un compañero os llama» y, el día siguiente, María llama al
     administrador.
   - **No lo va a hacer** → agradecer, guardar el presupuesto + ❌ aviso.
   - **Pregunta concreta** → a la oficina (pausa a Marta en ese chat) + ❓.

   Si el cliente escribe varios mensajes seguidos, Marta espera 20 s y
   responde a todo junto. Las fechas que caen en fin de semana o festivo
   pasan al siguiente día laborable.
5. **Agenda de María**: cada día laborable desde las 10:00, un solo mensaje
   con los grupos:
   - 📞 Llamar;
   - ✉️ Email al tramitador (nunca al asegurado);
   - 🔒 Cerrar con R6 en Zoho y FactuSOL.

   Cada tarea se avisa una sola vez, y antes de mandarla el bot comprueba en
   Zoho que el presupuesto sigue "enviado".
6. **Cancelaciones automáticas**: el seguimiento se cancela en silencio si
   el parte cambia de estado en el CRM (R1-R7, aceptado…) o si una persona
   de la oficina escribe en el chat. Si un mensaje no puede salir en 3 días,
   se avisa a María para llamar. Los seguimientos del sistema anterior se
   pasan al nuevo plan.
7. **Desde qué número sale**: desde el número donde el cliente ya tiene
   chat; si allí no existe la plantilla, desde el número del BOT. Las
   plantillas hay que crearlas en la cuenta de WhatsApp del número del BOT.

## Bajas

Si un cliente escribe **BAJA**, o lo pide con otras palabras («no me
escribáis más», «quitadme de la lista», «stop»…), Marta:

1. le confirma que no le volveremos a escribir;
2. cancela sus seguimientos de presupuesto y su encuesta pendiente;
3. deja una nota en el parte;
4. avisa a Mari para poner `[NOCOM]` en FactuSOL.

Cuando contesta a un mensaje nuestro, también cuenta como baja un enfado
(«spam», «os denuncio», «qué pesados») o la noticia de un fallecimiento:
Marta se disculpa o da el pésame. En una conversación normal no, porque
«tengo la denuncia del robo» es una petición de servicio.

La baja es para siempre y bloquea **todo** lo que enviamos nosotros:
seguimientos, encuestas y campañas. Si el cliente nos escribe, se le
atiende con normalidad. Si una persona de la oficina lleva el chat, la
baja se apunta en silencio.

- `GET /admin/api/bajas` — lista de bajas.
- `GET /admin/api/bajas?anadir=611222333&motivo=telefono` — dar de baja a
  mano (por ejemplo, si lo pidió por teléfono).
- `GET /admin/api/bajas?quitar=611222333` — quitarla (solo si el cliente
  lo pide).

## Permiso para mensajes comerciales (consentimiento)

En la encuesta postventa, cuando el cliente da una buena nota (9-10), Marta
le manda el enlace de Google y, unos segundos después, le pregunta:

> «Una última cosa: ¿te parece bien que te escribamos por aquí de vez en
> cuando, como mucho 4 veces al año, con revisiones y avisos de temporada?
> Responde SÍ o NO. Puedes darte de baja cuando quieras escribiendo BAJA.»

- Se pregunta una sola vez por cliente, nunca tras una nota baja ni a
  quien pidió la baja.
- Marta apunta la fecha, la pregunta y la respuesta exacta (la prueba ante
  protección de datos) y deja una nota en el parte.
- Si contesta otra cosa («ya la he puesto»), no se apunta nada.
- Una BAJA posterior revoca el permiso.
- `GET /admin/api/consentimientos` — cuántos han dicho sí y no, y quiénes.

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

**`seguimiento_presupuesto_3`** (mensajes intermedios, en uso):

```
Hola {{1}}, soy Marta de Ibérica Seguridad 🙂 No quiero resultar pesada,
solo recordarte que tu presupuesto sigue vigente y que cualquier duda te
la resuelvo por aquí. Y si prefieres dejarlo, dímelo y no te escribimos
más por este tema 🙏
```

**`seguimiento_presupuesto_aparcado`** (último mensaje, técnica de Voss,
activarlo con `PRESU_TEMPLATE3`):

```
Hola {{1}}, soy Marta de Ibérica Seguridad. No he vuelto a saber de ti
sobre el presupuesto: ¿has decidido aparcarlo? Si es así, con un simple
«sí» me basta y no te escribimos más por este tema 🙂
```

## Variables en Railway

| Variable | Valor | Notas |
|---|---|---|
| `PRESU_AUTO` | `on` | Interruptor general |
| `PRESU_RESPONSABLE` | `mari` | Quién recibe la agenda y TODOS los avisos: `mari`, `nieves` o `guardia`. Por defecto, Mari |
| `PRESU_TEMPLATE` | `seguimiento_presupuesto` | Primer mensaje (o `seguimiento_presupuesto_v2` cuando esté aprobada) |
| `PRESU_TEMPLATE2` | `seguimiento_presupuesto_3` | Mensajes intermedios |
| `PRESU_TEMPLATE3` | `seguimiento_presupuesto_aparcado` | Último mensaje «¿has aparcado...?». Activada por defecto (aprobada en Meta); `off` = usa la 2 |
| `PRESU_TEMPLATE_COMUNIDAD` | — | Opcional, mensajes 2 a 5 de comunidades. Sin definir = usa la 2 |
| `PRESU_PLAN_PARTICULAR` / `_EMPRESA` / `_COMUNIDAD` | `2,5,10` / `2,7,14,21` / `3,10,30,45,60` | Opcional, días en que escribe Marta |
| `PRESU_IMPORTE_LLAMADA` | `500` | A partir de este importe, María llama el día 7 |
| `PRESU_CAMPO_TIPO` / `PRESU_CAMPO_IMPORTE` | — | Opcional, nombre API del campo de Zoho con el tipo de cliente / el importe |
| `PRESU_TEMPLATE_LANG` | `es` | Idioma de las plantillas en Meta. Si aparecen como "Español (España)", poner `es_ES` |
| `PRESU_DIAS_RETRASO_MAX` | 3 | Días que un mensaje puede llevar sin poder salir antes de pasárselo a María (estado `no_enviable`) |
| `PRESU_ESPERA_MS` | 20000 | Espera para juntar varios mensajes seguidos del cliente |

## Panel

- `GET /admin/api/presupuestos-stats` — seguimientos vivos, historial y
  conteo por resultado (mensajes enviados, aceptados, objeciones,
  recontactos acordados...).
- `GET /admin/api/presupuestos-resultados` — estado actual en Zoho de cada
  presupuesto en el que Marta escribió al cliente.
- `GET /admin/api/presupuestos-tipos` — qué tipo de cliente e importe
  deduce de cada presupuesto vivo, y qué campos de Zoho podrían servir.
- `GET /admin/api/test-presupuestos?forzar=1` — lanza sondeo + barrido a
  mano (forzar=1 se salta la ventana comercial; `&agenda=1` manda la agenda
  de María aunque ya haya salido hoy; PRESU_AUTO debe estar on).
