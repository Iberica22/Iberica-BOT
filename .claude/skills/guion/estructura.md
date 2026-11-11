# La estructura: una base y la variante de noticias

**Todo guion es la base.** La única excepción es una noticia de IA de los últimos días: lleva las mismas piezas,
pero dos dicen otra cosa (`noticia`). Elige el molde por el tema, sin preguntar, y dilo en una línea al dar el
guion: «Estructura: `noticia`, porque acaba de salir».

La base sale del guion hablado de un reel viral de Sky Tan (el del «ultimate storytelling caption»): el reel enseña
a escribir un pie, pero lo que él dice va en este orden.

## 1. `base`

De 30 a 60 s. Los ejemplos son de `ejemplo/lista.json`.

| s | `parte` | Qué hace | Ejemplo |
|---|---|---|---|
| 0 a 3 | gancho | Lo que hay y una razón para pararse. Siempre de una forma del banco (`ganchos.md`) | «Si tu IA se inventa cosas, la estás usando mal.» |
| 3 a 6 | `dolor` | El problema de quien mira, el que abre el gancho. Cada gancho trae el suyo | «Le pides algo largo y al rato ya no se acuerda de lo que le dijiste.» |
| 6 a 9 | `autoridad` | Una frase con una cifra que prueba que funciona: la tuya o la de la herramienta. Nunca tu historia | «La uso 8 horas al día y no se inventa nada.» |
| 9 a 11 | `rehook` | Una línea corta que reengancha y promete el cuerpo: una cuenta, o lo que espera al final | «Son tres reglas, y la tercera es la que más cambia.» |
| 11 a 50 | `cuerpo` | El valor, una toma por idea (las tres formas, abajo) | «Uno: lo importante, por escrito y una sola vez.» |
| últimos 8 | `conclusion`, `iman`, `cta` | La idea se cierra con las palabras del gancho; lo que mandas, si mandas algo; «comenta X» o «sígueme» | «Menos chat y más reglas: así tu IA deja de inventarse cosas.» · «Sígueme, comenta REGLAS y te las envío por privado.» |

- **El cuerpo empieza antes del segundo 12.** Dolor y autoridad, una o dos frases cada uno: `guion.py` avisa si
  con alguno de los tres ganchos llega más tarde.
- **La autoridad es una frase con una cifra**, antes del cuerpo. Fuera «es una locura», «no ha sido suerte» y tu
  historia antes del cómo. Tu historia va después del cómo, en dos frases como mucho, o fuera.
- **Lo que dices al principio no se repite** más adelante.
- **Con el clip de otro al principio**: el clip va primero y luego la base, con tu opinión en el cuerpo y en el
  orden en que la cuentas. Pregunta qué opinas antes de escribir.

### El cuerpo: tres formas, el mismo esqueleto

| Forma | Cuándo | Cómo |
|---|---|---|
| Pasos | Cómo hacer una cosa | «Primero… Ahora que… Y por último…», cada paso sobre el anterior, con las palabras exactas que hay que pegar. `ejemplo/pasos.json` |
| Lista | Varias cosas sueltas | De 3 a 5 puntos, de menos a más («cada vez más de nicho»), o el segundo mejor primero. Cada punto: su nombre, qué hace, un ejemplo y qué te da. «10/10» es una nota, no una cuenta. `ejemplo/lista.json` |
| Historia | Algo que te pasó | «Pero… así que…», nunca «Primero… Segundo…»: la escena, lo que la rompió, el momento de cinco segundos en que se decidió, lo nuevo con una cifra y la moraleja |

Una historia, por dentro: «Tenía el plan de siempre: una empresa de las de toda la vida y crecer poco a poco. **Pero**
cada día veía a gente de mi edad construyendo cosas con IA. **Así que** me pregunté qué era lo peor que podía pasar.
Lo peor era volver a una empresa, y con todo lo aprendido. **Así que** lo dejé.» Tus razones van dentro del «pero…
así que…», nunca numeradas.

## 2. `noticia`

De 25 a 50 s, solo para noticias de IA de los últimos días. Las mismas partes; dos dicen otra cosa. Los ejemplos
son de `ejemplo/noticia.json`.

| `parte` | En una noticia | Ejemplo |
|---|---|---|
| gancho | El antes y el ahora, o un gigante que llega, con un nombre que conoce todo el mundo | «Dos científicos de Google acaban de ganar el Nobel con una IA.» |
| `dolor` | **Por qué te toca**, aunque no sepas nada del tema | «Y aunque no seas científico, te toca: de esto salen tus medicinas.» |
| `autoridad` | **El dato**: quién, qué, desde cuándo, con su cifra si la hay. No tus credenciales | «Comparten el Nobel de Química Demis Hassabis y John Jumper, de Google DeepMind, por AlphaFold.» |
| `rehook` | La pregunta que se hace quien mira | «¿Y qué tiene que ver contigo?» |
| `cuerpo` | Un caso del día a día de quien mira, y luego lo nuevo en pantalla | «Casi todas las medicinas funcionan encajando en una proteína, como una llave en su cerradura.» |
| `conclusion`, `cta` | Tu veredicto en una frase; «sígueme» si no hay nada que mandar | «Lo que costaba un doctorado entero, ahora lo hace una IA en minutos.» · «Sígueme para estar al día de la IA.» |

Si quien mira lo puede usar hoy y lo enseñas funcionando, es `base`, no `noticia`.

## 3. Dentro de cada guion

1. **Los datos, primero** (Kallaway). Antes de escribir, de 5 a 10 datos del tema, el más sorprendente arriba. El
   mejor va al gancho o el primero del cuerpo. En un tema que cuenta todo el mundo, el ángulo que nadie coge.
2. **«Pero» y «así que» entre tomas, nunca «y entonces»** (Parker y Stone, vía Jenny Hoyos). Cada toma cambia algo
   de la anterior. Una toma que solo suma («y además») se junta con otra o se quita.
3. **Sin pausas**: nunca «empecemos», «vamos allá», «sin más». La toma de después del rehook ya es contenido.
4. **Cada punto: qué es, cómo (con un ejemplo) y qué te da** (Kallaway).
5. **Nunca lo mejor primero y luego cuesta abajo**: de menos a más, o el segundo mejor primero y el mejor después.
6. **Un solo hilo**: cada línea es contexto que necesita la siguiente o un paso adelante. Un dato de lado se quita,
   por cierto que sea.
7. **Una palabra difícil, dos veces, la segunda en llano**: «el contexto, lo que Claude se acuerda de la
   conversación».
8. **La última frase se escribe la primera, y nada va detrás** (Jenny Hoyos: quitar el último segundo le subió la
   retención del 83 al 88 %). Repite las palabras del gancho, para que al volver a empezar enganche (Kallaway).
9. **Una cifra exacta gana a una redonda**: «de 1.200 a 4.700», no «de casi mil a casi cinco mil». Solo reales.
10. **Frases cortas, medianas y de vez en cuando una más larga** (20 palabras como mucho), nunca varias del mismo
    largo seguidas: suena a rezo (Gary Provost, vía Kallaway).
