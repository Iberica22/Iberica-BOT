# Seguimiento de presupuestos — Marta comercial

Marta hace el seguimiento de los presupuestos enviados que se quedan sin
respuesta: dos toques suaves por WhatsApp y, si no hay señal, aviso al
equipo para una llamada comercial. Vive dentro del mismo bot de Railway.

## Cómo funciona

1. **Detección**: cada 5 min el bot sondea Zoho. Un parte con Estado
   "Presupuesto" y Subestado "enviado" (comparado por contenido, como en
   reseñas) entra en seguimiento. Presupuestos con más de 14 días al
   detectarse no entran (se asumen ya gestionados).
2. **Cadencia 3-8-11** (protocolo comercial estándar: el primer
   seguimiento a las 48-72 h es el que más convierte; a partir del
   tercero por escrito quema — el tercer toque es humano y por teléfono):
   - **Día 3** → toque 1: "¿pudiste verlo? ¿dudas?" (plantilla).
   - **Día 8** → toque 2: recordatorio suave con salida fácil (plantilla).
   - **Día 11** → sin respuesta: aviso al agente de turno para llamada
     comercial + nota en el parte, y fin.
   Los toques salen solo **L-V de 10:00 a 19:00** (hora de Madrid).
3. **Respuestas** (las gestiona Marta, manual de objeciones, sin presionar
   y sin dar precios):
   - **Acepta** → "te llaman para cuadrar fechas" + 🎯 aviso al equipo.
   - **Precio** → valor (equipo propio, 3 años de garantía, financiación)
     + ofrece llamada, sin compromiso + 💶 aviso al equipo.
   - **Se lo piensa** → sin prisa, presupuesto vigente, puerta abierta.
   - **Declina** → agradecer, guardar presupuesto + ❌ aviso con el motivo.
   - **Duda/otro** → derivar a la oficina (pausa el bot) + ❓ aviso.
   Toda respuesta queda como **nota en el parte de Zoho** y detiene la
   cadencia.
4. **Cancelaciones automáticas**: si el parte cambia de estado en el CRM
   (aceptado, cerrado...) o si una persona de la oficina interviene en el
   chat, el seguimiento se cancela en silencio.
5. **Clientes sin WhatsApp conocido**: igual que en reseñas, se crea el
   contacto en Woztell (canal principal `WOZTELL_CHANNEL_ID`) y se envía
   la plantilla en frío.

## Plantillas a aprobar en Meta (categoría Utility, español)

**`seguimiento_presupuesto`** (toque 1, variable {{1}} = nombre):

```
Hola {{1}} 👋 Soy Marta, de Ibérica Seguridad. Te escribo por el
presupuesto que te preparamos. ¿Pudiste echarle un vistazo? Si tienes
cualquier duda o quieres ajustar algo, respóndeme por aquí y lo vemos,
sin ningún compromiso 🙂
```

**`seguimiento_presupuesto_2`** (toque 2, variable {{1}} = nombre):

```
Hola {{1}}, soy Marta de Ibérica Seguridad 🙂 No quiero resultar pesada,
solo recordarte que tu presupuesto sigue vigente y que cualquier duda te
la resuelvo por aquí. Y si prefieres dejarlo, dímelo y no te escribimos
más por este tema 🙏
```

(Criterio: primer toque orientado a resolver dudas, no a "cerrar"; segundo
con permiso para decir que no — la salida fácil sube la tasa de respuesta
y protege la marca. Nunca precios, nunca urgencia artificial.)

## Variables en Railway

| Variable | Valor | Notas |
|---|---|---|
| `PRESU_AUTO` | `on` | Interruptor general. **Off por defecto**: no activar hasta que Meta apruebe las plantillas. |
| `PRESU_TEMPLATE` | `seguimiento_presupuesto` | Toque 1 |
| `PRESU_TEMPLATE2` | `seguimiento_presupuesto_2` | Toque 2 (si falta, reutiliza la 1) |
| `PRESU_DIAS_TOQUE1/2/CIERRE` | 3 / 8 / 11 | Opcional, para ajustar la cadencia |

## Panel

- `GET /admin/api/presupuestos-stats` — seguimientos vivos, historial y
  conteo por resultado (toques enviados, aceptados, objeciones...).
- `GET /admin/api/test-presupuestos?forzar=1` — lanza sondeo + barrido a
  mano (forzar=1 se salta la ventana comercial; PRESU_AUTO debe estar on).
