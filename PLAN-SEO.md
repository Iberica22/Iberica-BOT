# Auditoría y plan SEO — Ibérica Seguridad

**Ibérica Servi & Security S.L.** · Almería · 29 de agosto de 2026

> Versión con formato: https://claude.ai/code/artifact/77ad99d1-1f2f-4242-a880-4213d65c2d6b

## Veredicto

Las reseñas de Google alimentan el **mapa** (las tres fichas con estrellas), no los
resultados azules. Y dentro del mapa Google pondera mucho más la **cantidad** de
reseñas, la cercanía del que busca y las categorías de la ficha que la nota media:
un 4,8 con 60 reseñas pierde contra un 4,2 con 300.

En los resultados azules la web parte con una desventaja ajena a la calidad del
trabajo: la portada no compite por ninguna búsqueda, el vocabulario de las páginas
no coincide con el que teclea la gente, y hay dos dominios propios peleándose.

Seis de los ocho problemas se arreglan sin tocar código, y el hueco más rentable
del mercado local —*puertas acorazadas en Almería*— está vacío.

## Hallazgos (por impacto)

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

### 6. Volumen de reseñas
60 reseñas con 4,9 es una reputación excelente y un gran activo de conversión, pero como
señal de posicionamiento en el mapa se queda corta frente a competidores con cientos.
El mecanismo ya existe: Marta pide nota 0–10 al cerrarse el parte y manda el enlace.

Detalle a corregir: `index.js:429` usa un `RESENA_URL` único
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

### Semana 1 — arreglos de coste cero
1. Reescribir título y meta descripción de cada página. Fórmula `Servicio + en Almería + marca`, máx. 60 caracteres. Empezar por la portada.
2. Elegir dominio y redirigir el otro con 301 hacia la página equivalente (no apagarlo sin más).
3. Unificar NAP: escribir nombre, dirección y teléfono de cada exposición en un documento y copiarlos literalmente en Google, Bing Places, Apple Maps y todos los directorios.
4. Revisar categorías de Google Business: principal «Cerrajero»; secundarias «Tienda de puertas», «Servicio de instalación de puertas», «Empresa de sistemas de seguridad».
5. Dar de alta Google Search Console y enviar el sitemap.

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

Pendiente de revisar, no visible desde aquí: velocidad y experiencia móvil, `robots.txt` y
sitemap, enlazado interno, contenido duplicado dentro del dominio, y datos de Search Console.
Con acceso de lectura a Search Console y al WordPress se cierra esa parte.
