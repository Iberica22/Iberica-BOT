# Estrategia: de servicio suelto a programa

Esta guía se basa en el reel de @kimfermisson sobre centros de estética. La idea
es la misma para cerrajería y seguridad: **antes de subir precios o buscar más
clientes, mira qué haces ya y qué hace tu cliente**. Después, convierte los
servicios sueltos en *programas* o *packs* que resuelvan el problema completo.

> No se pudo ver el vídeo desde el entorno de trabajo (Instagram está bloqueado
> por la red). La guía se apoya en los dos comentarios fijados de la autora y en
> los subtítulos: *"…cuáles transforman y cuáles dejan de ser simples
> tratamientos para convertirse en rituales, experiencias o programas
> completos"*.

---

## 1. Las dos listas del reel, traducidas a Ibérica

| Estética (reel) | Ibérica Seguridad |
|---|---|
| Tratamiento | Servicio: apertura, cambio de bombín, instalación de cerradura, puerta acorazada, automatismo… |
| Producto que se vende | Material: bombines, escudos, cerraduras, motores, mandos… |
| Recepción | Oficina, teléfono y Marta (WhatsApp/voz): lo que se ofrece y presupuesta |
| Cabina | La visita: lo que el técnico recomienda en casa del cliente |
| "Antes de que la clienta salga por la puerta" | **Antes de que el técnico se vaya** de la vivienda o del local |
| Ritual / programa | Pack: el servicio completo que resuelve el problema, no solo la urgencia |

### Lista A — qué hacen nuestros servicios
1. ¿Qué servicios hemos vendido más?
2. ¿Cuáles casi nadie ha comprado?
3. ¿Cuáles facturan mucho pero dejan poco beneficio?
4. ¿Cuáles ocupan demasiado tiempo de agenda?
5. ¿Cuáles tienen potencial para convertirse en algo mucho más grande?

### Lista B — qué hace nuestro cliente
1. Cuánto compra cada cliente.
2. Cada cuánto vuelve.
3. Qué servicios combina.
4. Cuánto material vendemos.
5. Qué ofrecemos desde la oficina.
6. Qué recomienda el técnico en la visita.
7. Qué podría venderse antes de que el técnico se vaya.

---

## 2. El informe automático (FACTUSOL)

El Worker de FACTUSOL (`factusol-worker/worker.js`) tiene ahora una ruta que
responde a las dos listas con los datos reales de facturación:

```
https://factusol-iberica.<tu-subdominio>.workers.dev/analisis?k=TU_DIAG_KEY
```

| Parámetro | Para qué |
|---|---|
| `ejercicios=2025,2026` | Analiza varios años. Recomendado para medir cada cuánto vuelve el cliente. |
| `coste_hora=25` | Coste real por hora de técnico. Sin él, la mano de obra sale con un 100 % de margen y la pregunta 3 queda incompleta. También vale la variable `COSTE_HORA_TECNICO` del Worker. |
| `formato=json` | Datos en bruto, por ejemplo para pasárselos a Claude. |

Usa la misma clave que `/diag` (`DIAG_KEY`). Sin ella, la ruta devuelve 403.
Para activarlo, vuelve a pegar `worker.js` en Cloudflare (Paso 2 de
`factusol-worker/GUIA-INSTALACION.md`).

**Qué responde cada bloque**

| Pregunta | Cómo se calcula |
|---|---|
| Más vendidos | Nº de facturas en las que aparece cada artículo o servicio, con facturación, margen y con qué suele ir |
| Casi nadie compra | Artículos con 1–2 facturas en el periodo, más el nº de artículos del catálogo sin ninguna venta |
| Mucha facturación, poco beneficio | Entre el 30 % que más factura, los que tienen margen bajo (precio de coste `PCOART` del artículo) |
| Ocupan agenda | Horas de "mano de obra" de las facturas donde aparece, y margen por hora de técnico |
| Potencial de programa | Se venden a menudo, tienen buen margen y casi siempre van acompañados: es el **pack natural** que el cliente ya está comprando por piezas |
| Cuánto compra / cada cuánto vuelve | Total y ticket medio por cliente, días medios entre facturas, % de clientes que solo vinieron una vez |
| Qué combina | Familias que aparecen juntas en la misma factura |
| Cuánto material | % de la facturación que es material y % de facturas sin ningún material |
| Qué ofrece la oficina | Presupuestos por serie (5 Carpintería, 7 Particular) y su estado |
| Antes de que el técnico se vaya | En cada servicio frecuente, el producto que mejor encaja, cuántas veces el cliente se quedó sin él y cuánto supondría que lo aceptara 1 de cada 5 |

**Límites que conviene conocer**
- Una línea cuenta como servicio o como material según su descripción: *mano de
  obra, apertura, instalación, desplazamiento, urgencia…* es servicio. Si una
  línea de servicio no lleva esas palabras, saldrá como material.
- Las horas solo se detectan si se facturan como "mano de obra" u "hora". Si las
  aperturas se cobran a precio cerrado, apunta la duración real en el parte de
  Zoho para poder medir la agenda.
- Si las compañías de seguros facturan muchos partes, aparecerán como "grandes
  clientes". Lee la lista de clientes pensando en el particular.
- **Lo que el técnico recomienda en la visita no queda en FACTUSOL.** Ver el
  punto 4.

---

## 3. De servicio a programa: packs para validar con el informe

Estas son propuestas de partida. **Confírmalas con el bloque "Potencial de
programa"** del informe antes de lanzarlas. Lo ideal es que el pack sea lo que
el cliente ya compra junto, ofrecido de golpe y con nombre propio.

| Servicio de entrada | Pack / programa | Por qué encaja |
|---|---|---|
| Apertura de puerta (urgencia) | **"Vuelve a estar seguro"**: apertura + bombín antibumping + juego de llaves + revisión de la puerta | Tras una apertura (y más si fue un robo o se perdieron las llaves), el cliente tiene la necesidad en ese momento. Es la mayor fuga de "antes de que se vaya" |
| Cambio de bombín | **"Puerta protegida"**: bombín de seguridad + escudo protector + ajuste de la puerta | Un bombín sin escudo protege a medias. Es la combinación más lógica |
| Puerta acorazada (FICHET/KIUSO) | **"Puerta llave en mano"**: puerta + retirada de la antigua + cerradura de seguridad + revisión gratis al año + financiación Cetelem | Ya se ofrecen 3 años de garantía y la retirada. Vendido como programa sube el valor percibido y da una visita futura |
| Automatismo de portón/garaje | **"Mantenimiento anual"**: revisión, engrase y ajuste de finales de carrera, con prioridad ante averías | Convierte una venta única en ingreso recurrente. Es la respuesta a "cada cuánto vuelve" |
| Comunidades y empresas | **"Plan comunidad"**: revisión periódica de portales, cierrapuertas, cerraduras y amaestramiento, con un precio por visita acordado | Cliente de varios servicios al año. Hoy probablemente llama solo cuando algo se rompe |
| Domótica / control de accesos | **"Casa conectada"**: cerradura inteligente + configuración + formación al cliente | Es un servicio sin cuotas: el programa es la puesta en marcha completa, no solo el aparato |

Reglas de marca que se mantienen: Marta **no da precios** por WhatsApp ni por
teléfono. Los packs se ofrecen como *"tenemos una solución completa para esto,
te la preparamos en el presupuesto"*, y los importes los pone la oficina en
FACTUSOL. Mientras los packs no estén cerrados, no se añaden a la base de
conocimiento de Marta.

---

## 4. "Antes de que salga por la puerta": protocolo del técnico

Lo que se recomienda en la visita (la "cabina") es justo lo que no queda
registrado. Propuesta mínima:

**Checklist de 1 minuto al terminar cualquier trabajo**
1. ¿El bombín es antibumping o antiganzúa? Si no lo es, se recomienda.
2. ¿Tiene escudo protector? Si no lo tiene, se recomienda.
3. ¿La puerta cierra bien (bisagras, ajuste, burlete)?
4. ¿Tiene copias de llave suficientes? ¿Necesita llave de seguridad con tarjeta?
5. ¿Tiene garaje, portón o comunidad con automatismo? Se menciona el mantenimiento.

**Frase tipo** (sin presionar, en tono de asesor): *"Ya está abierta. Te
comento una cosa: este bombín se abre en un minuto con la técnica del bumping.
Si quieres, te dejo puesto ahora uno de seguridad y así no tengo que volver."*

**Que quede registrado:** el técnico anota en el parte de Zoho qué recomendó y si
el cliente lo aceptó, lo dejó para más adelante o no lo quiso. Lo que "deja para
más adelante" entra en el seguimiento de presupuestos que ya hace Marta
(`GUIA-SEGUIMIENTO-PRESUPUESTOS.md`).

**Oficina / Marta ("recepción"):** cuando el cliente pide presupuesto de un
servicio suelto que forma parte de un pack, la oficina presupuesta las dos
opciones: el servicio suelto y el pack completo.

---

## 5. Rutina mensual (30 minutos)

1. Abrir `/analisis?k=…&ejercicios=<año anterior>,<año actual>&coste_hora=<coste real>`.
2. Mirar tres números: **% de clientes que solo vinieron una vez**, **% de
   facturas sin material** y la tabla **"antes de que el técnico se vaya"**.
3. Elegir **un solo** servicio para convertirlo en pack ese mes, el primero de
   "Potencial de programa", y preparar su presupuesto tipo en FACTUSOL.
4. Revisar "mucha facturación, poco beneficio": ¿hay que subir el precio,
   cambiar de proveedor o dejar de empujar ese servicio?
5. Comparar con el mes anterior: si el % de "se fue sin producto" baja, el
   protocolo del técnico está funcionando.
