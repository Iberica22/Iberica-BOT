# Auditoría y plan SEO — Ibérica Seguridad

**Ibérica Servi & Security S.L.** · Almería · 29 de agosto de 2026

> Versión con formato: https://claude.ai/code/artifact/77ad99d1-1f2f-4242-a880-4213d65c2d6b

## Veredicto (confirmado leyendo la ficha)

La ficha está bien en todo lo que se suele mirar: verificada, visible, categoría correcta
(«Cerrajero en Almería»), 4,8 de nota, 108 reseñas, web enlazada. Nada de eso es el problema.

**El problema está en el campo de la dirección:**

```
Calle Estaño, 101 C. San Leonardo, 34, 04004, 04009 Almería
```

Son **dos direcciones y dos códigos postales fundidos en un solo campo**. Google no puede
convertir eso en un punto del mapa. Y como la distancia entre el cliente y ese punto es el
factor que más pesa en el posicionamiento local, una ficha que no se puede situar **no entra
a competir en ninguna búsqueda por cercanía**. Por eso se pueden tener 108 reseñas y no
aparecer: no es que perdamos la carrera, es que no nos dejan salir.

Segundo agujero, más pequeño pero caro: la ficha dice **«Cerrado»** a las 20:40 y abre el
lunes a las 9:30. Nuestro propio rótulo anuncia 24 h, pero en Google no está declarado, así
que desaparecemos de las búsquedas de urgencia nocturna, las de más valor del oficio.

## Problema A: los cuatro arreglos de la ficha

Todos dentro del Perfil de Empresa, en una sola sesión.

**A1 — La dirección: dejar una sola, limpia.** *Esto es la causa.* Borrar el campo y escribir
solo la del local que corresponde a esta ficha, con un único código postal: `Calle Estaño, 101
· 04009 Almería` o `Calle San Leonardo, 34 · 04004 Almería`. Nunca las dos. Después **arrastrar
el pin a mano** hasta la puerta del local. Al guardar, Google puede pedir reverificación: hay
que pasarla, es lo que fija las coordenadas buenas. Plazo hasta notarlo: 2–4 semanas.

**A2 — El horario: declarar las 24 h.** A las nueve de la noche, quien se ha quedado fuera de
casa nos ve «Cerrado», y muchos filtran por «Abierto ahora». Los que nos ganan están todos
marcados 24 h. En el editor de horarios, **«Abre las 24 horas»** en cada día. Alternativa más
fiel pero de menos alcance: horario de oficina como principal y el de urgencias en «Horario
completo» → «Añadir otro horario».

**A3 — El teléfono no coincide con nuestro rótulo.** La ficha da el 950 08 80 86 y la foto de
fachada que subimos anuncia el 950 22 78 89. Google contrasta el teléfono entre ficha, web,
directorios y fotos, y la discrepancia resta confianza — lo que más caro se paga en cerrajería,
el gremio con los filtros antifraude más duros. Decidir cuál es el bueno y unificarlo; el otro,
como secundario.

**A4 — Servicios y reseñas.** La categoría ya es correcta. Queda rellenar la pestaña
**Servicios** (apertura de puertas, cambio de cerradura, bombines, puertas acorazadas,
automatismos, copias de llaves, cerrajería forense): cada servicio declarado es una búsqueda
más en la que la ficha puede entrar. Y poner el enlace de reseña de esta ficha en `RESENA_URL`
(Railway) para que el goteo de Marta siga alimentándola.

### Por qué este orden

A1 no es «una mejora más». Mientras la dirección no se pueda convertir en un punto del mapa,
los otros tres no tienen dónde apoyarse: las reseñas, la categoría y los servicios deciden *en
qué puesto* sale una ficha entre las candidatas, pero para ser candidata hace falta una
ubicación que Google sepa medir.

## Descartado por el camino

| Hipótesis | Estado |
|---|---|
| Pocas reseñas | Descartado — 108, más que las fichas que sí aparecen |
| Ficha suspendida o sin verificar | Descartado — se ve entera y operativa |
| Categoría principal equivocada | Descartado — «Cerrajero en Almería», correcta |
| Reseñas repartidas entre dos fichas | Descartado — están todas en esta |
| **Dirección no geocodificable** | **Confirmado** |
| **24 h sin declarar** | **Confirmado** |

## Problema B: la web

| # | Hallazgo | Impacto | Esfuerzo |
|---|---|---|---|
| 1 | La portada compite por la palabra «Inicio» | Alto | 15 min |
| 2 | Decimos «cerrajería»; la gente escribe «cerrajero» | Alto | 1 tarde |
| 3 | El hueco de «puertas acorazadas Almería» está vacío | Mayor oportunidad | 2 semanas |
| 4 | Dos dominios compitiendo entre ellos (.com y .online) | Alto | 1 hora |
| 5 | La dirección está mal/mezclada en los directorios | Alto | 2 horas |
| 6 | 60 reseñas es poco para el mapa de Almería | Medio | Ya casi hecho |
| 7 | Ausentes de los directorios que sí rankean | Medio | 3 horas |
| 8 | Ninguna señal de precio; la competencia sí la da | Medio | A decidir |

### 1. La portada compite por la palabra «Inicio»
Google muestra la página principal titulada «Inicio - Ibericaseguridad». El título es
la señal más fuerte de una página y la portada es la de más fuerza del dominio; hoy
apunta a una palabra que nadie busca.

- Ahora: `Inicio - Ibericaseguridad`
- Debería ser: `Cerrajeros en Almería 24 h · Puertas acorazadas y cerraduras de seguridad | Ibérica Seguridad`

### 2. «Cerrajería» vs «cerrajero»
La página de urgencias se titula «Cerrajería 24 Horas en Almería». La búsqueda real es
`cerrajeros almería` y `cerrajero almería 24 horas`. Con diez competidores que sí llevan
la palabra exacta en el título, esa diferencia decide.

**Prueba:** en «cerrajero Almería 24 horas urgente» no aparecemos. Los 8 primeros son
cerralmeria.es, cerrajeroenalmeria.com, cerrajerialmeria.com, cerrajerosenalmeria.net,
misterkey24h.com — todos con la palabra exacta en dominio y título.

### 3. Puertas acorazadas: el hueco vacío
Somos instaladores oficiales FICHET y KIUSO, con 20 años, fabricación propia, retirada de
la puerta antigua, 3 años de garantía por escrito y financiación a 12 meses sin intereses.
En Almería no hay ningún resultado local fuerte para esa búsqueda: los primeros puestos son
Leroy Merlin y webs de Alicante, Valencia o Extremadura. Es el término más rentable y menos
disputado que tenemos.

**Prueba:** «puertas acorazadas Almería instalador oficial Fichet precio» — cero empresas
almerienses en la primera página.

### 4. Dos dominios
`ibericaseguridad.com` e `ibericaseguridad.online` están los dos vivos con contenido parecido.
Para Google son dos sitios distintos diciendo lo mismo: reparte la confianza y a menudo no
muestra ninguno. Hay que quedarse con el `.com` y redirigir el otro con 301, página por página.

### 5. NAP inconsistente
En los directorios aparecemos con las dos direcciones fundidas: «Calle Estaño, 101 C. San
Leonardo, 34, 04004, 04009 Almería». Tener dos exposiciones (capital y polígono Sector 20)
está bien, pero la ficha de cada una debe ser idéntica —mismo nombre, dirección, teléfono y
grafía— en Google, Bing, Páginas Amarillas y cada directorio.

### 6. Reseñas: ya están hechas, pero mal repartidas
Descartado como causa de ranking. El volumen supera al de las fichas que sí aparecen — y eso es
justamente lo que destapó el Problema A. Ver arriba: `index.js:429` usa un `RESENA_URL` único
(`https://g.page/r/CXgW_wAoTj0cEAE/review`) para todos los partes. Si cada exposición tiene
ficha propia, el enlace debería ser el de la que atendió el trabajo.

### 7. Directorios
En «mejores cerrajeros en Almería» Google no enseña empresas: enseña listas (Habitissimo,
Portal Cerrajeros, Seprelo, Taskia, Multiguía, cerrajero.io). Estamos en dos directorios
menores (comga.es, henartel.es) y en ninguno de los que ocupan la primera página.

### 8. Señales de precio
Los que nos ganan llevan el precio en el título («Urgentes desde 20 €»). No hace falta cerrar
precio en la web: basta una horquilla honesta («apertura de puerta desde 60 €, presupuesto
cerrado antes de empezar y sin compromiso»). Es además el mejor argumento contra quien
anuncia 20 € y factura 150.

## Búsquedas objetivo

Una página por búsqueda; nunca dos páginas peleando por el mismo término.

| Búsqueda | Página | Situación |
|---|---|---|
| puertas acorazadas almería | Nueva `/puertas-acorazadas-almeria/` | Hueco libre. Prioridad máxima. |
| cerrajeros almería | Portada | Título sin usar. Arreglo inmediato. |
| cerrajero almería 24 horas | `/cerrajeria-horas/` | Existe; reescribir título y H1. |
| puertas blindadas almería | `/puertas-de-vivienda/` | Falta «blindada» y la ciudad. |
| cambiar cerradura almería | Nueva | Mucho volumen, compra directa. |
| bombín de seguridad almería | Nueva | Tesa, Ezcurra, Abus: sección por marca. |
| cerrajero comunidades almería | `/trabajo-para-comunidades/` | Existe. Cliente recurrente. |
| automatismos puerta garaje almería | Nueva | Servicio que damos y no está en la web. |
| cerrajero forense almería | `/cerrajeros-forenses/` | Nicho propio (APFC). Ya posiciona. |

## Plan

### Semana 1 — arreglar la ficha y los básicos de la web
1. **Arreglar la dirección de la ficha** y colocar el pin a mano sobre la puerta del local.
2. **Marcar «Abre las 24 horas»** los siete días.
3. **Unificar el teléfono** entre ficha, web, directorios y rótulo. **Rellenar la pestaña
   Servicios** y pegar el enlace de reseña en `RESENA_URL` (Railway). **Publicar
   `seo/schema-localbusiness.html`** en el `<head>` del sitio, con la dirección ya corregida y
   copiada letra por letra desde Maps.
4. Reescribir título y meta descripción de cada página. Fórmula `Servicio + en Almería + marca`, máx. 60 caracteres. Empezar por la portada.
5. Elegir dominio y redirigir el otro con 301 hacia la página equivalente (no apagarlo sin más).
6. Unificar NAP: escribir nombre, dirección y teléfono de cada exposición en un documento y copiarlos literalmente en Google, Bing Places, Apple Maps y todos los directorios.
7. Revisar el resto de categorías y servicios: principal «Cerrajero»; secundarias «Tienda de puertas», «Servicio de instalación de puertas», «Empresa de sistemas de seguridad».
8. Dar de alta Google Search Console y enviar el sitemap.

### Mes 1 — contenido y presencia
1. Página de puertas acorazadas: fotos de instalaciones propias (no de catálogo), sellos FICHET y KIUSO, garantía de 3 años, retirada de la puerta antigua, financiación Cetelem, horquilla de precios por gama.
2. Alta en Habitissimo, Portal Cerrajeros, Seprelo, Taskia, Multiguía y cerrajero.io con el NAP unificado.
3. Datos estructurados `LocalBusiness`/`Locksmith` en todas las páginas: dirección, teléfono, horario y zona de servicio.
4. Subir el caudal de reseñas: de 60 a 150 en seis meses, con entrada constante (Google valora el goteo estable sobre el pico).
5. Una página por zona real: El Ejido, Roquetas de Mar, Vícar, Níjar, Huércal — con contenido propio de cada una, no plantilla con el nombre cambiado.

### Trimestre — autoridad
- Enlaces locales: Cámara de Comercio de Almería, asociaciones de vecinos y administradores de fincas con los que ya trabajamos, APFC, prensa local a cuenta de los 30 años en 2026.
- Contenido que resuelve las dudas que ya contestamos por WhatsApp: blindada vs acorazada, llave rota dentro, cuánto tarda un cambio de bombín, cerradura para comunidad.
- Fotos y vídeos propios en la ficha de Google con regularidad.
- Responder todas las reseñas, también las malas y las viejas: Google mide la tasa de respuesta.

## Alcance de esta auditoría

El entorno de trabajo tiene bloqueado el acceso directo a `ibericaseguridad.com`, así que
no se ha podido rastrear la web por dentro. Lo afirmado sobre títulos, páginas y contenido
sale de lo que Google muestra públicamente en sus resultados —que es lo que ve el cliente—
más los datos de empresa del propio bot (`index.js:1289`). Los hallazgos 1, 2, 3, 4, 5 y 7
son verificables repitiendo las búsquedas indicadas.

El Problema A ya no es una hipótesis: está leído directamente de la ficha (dirección, horario,
teléfono, categoría y número de reseñas). Lo único que no puedo hacer yo son los cambios, porque
viven dentro del Perfil de Empresa y requieren la cuenta.

Pendiente de revisar, no visible desde aquí: velocidad y experiencia móvil, `robots.txt` y
sitemap, enlazado interno, contenido duplicado dentro del dominio, y datos de Search Console.
Con acceso de lectura a Search Console y al WordPress se cierra esa parte.
