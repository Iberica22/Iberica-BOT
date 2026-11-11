# Banco de ganchos

Cada gancho de un guion sale de una forma de este banco. Los tres de un guion, de tres formas distintas y con tres
`para` distintos; cada uno dice de cuál sale (`forma` en `hablado.json`). `guion.py` lee la columna «Forma» de
estas tablas y avisa si un gancho no trae una, o si dos comparten la misma.

**De dónde sale.** Las primeras frases de los 99 Shorts que más superaron la mediana de su canal: 29 canales de IA,
negocio y en español (de 47 mirados), con al menos 5 veces su mediana y 100.000 vistas, y 4 por canal como mucho.
Más los reels más vistos de un creador de IA en Instagram (en inglés, mediana de 5.700 vistas en 130 reels) y de
una cuenta de IA en español (mediana de 1.970 en 147 reels). Medido el 29-oct-2026.

**35 formas**, en siete familias. **Cómo leer la prueba.** «×» son las veces que ese vídeo supera la mediana de su canal: 958× es que lo vieron 958
veces más que a uno normal suyo. Solo se quedan las formas con prueba fuerte: muchas veces su mediana, o muchísimas
vistas. Las frases de canales en inglés van traducidas. **La forma es la lección, nunca la frase**: no copies la
de nadie.

## 1. Cómo se eligen los tres

1. **Si el guion toma el formato de un reel viral que te han traído**, los tres ganchos mantienen su forma y sus
   palabras fijas; solo cambia la promesa.
2. **Los tuyos que ya funcionaron, primero** (3 veces tu mediana o más): rehaz uno casi con las mismas palabras y
   cambia solo las del tema. «La IA acaba de cambiar el mundo para siempre» → «…el software para siempre».
3. **Después, la forma que encaja con el tema**, de las tablas: tres formas y tres `para` distintos.
4. **Rellénala con los tres movimientos** (§4) y **pásale los cuatro fallos** (§5).

## 2. Las formas

### Noticia (para el molde `noticia`)

| Forma | Plantilla | Por qué para | Prueba | Cómo abre |
|---|---|---|---|---|
| `acaba-de-cambiar` | «[Marca] ha sacado esto hoy.» · «[Marca] acaba de cambiar [cosa] para siempre.» · «Era cuestión de tiempo y [el gigante] ya ha llegado.» | `drama`: alguien que conoce todo el mundo mueve ficha hoy | NetworkChuck, 8,6M (64×) · AI Advantage, 264k (40×) · un reel de IA en español, 60,6k (30×); otro, con 13,4k, en el que solo el 38 % se fue en los 3 primeros segundos | «Raspberry Pi ha sacado esto hoy.» · «¿Has visto la nueva IA de Elon Musk, Grok 2?» · «La IA acaba de cambiar el mundo para siempre.» |
| `antes-ahora` | «Antes, [X] era cosa de [quién / mucho dinero]. Ahora [marca] lo pone en [tu mano].» | `imposible`: el salto entero cabe en una frase | AI Advantage, 286k (44×) | «Hace unas semanas, para tener un superordenador de IA necesitabas decenas de miles de dólares. Ahora te bastan unos Mac mini conectados.» |
| `palabra-nueva` | «Hay una palabra que vas a oír mucho este año: [palabra].» | `secreto`: te lo cuentan antes que a los demás | Matt Wolfe, 1,0M (77×) | «Hay una palabra nueva que vas a oír mucho este año. Se llama agentic commerce.» |
| `parece-falso` | «Esto parece [sacado de una película], pero es real.» | `imposible`: lo que ves no puede ser verdad, y lo es | Varun Mayya, 11M (115×) | «Este vídeo de China parece sacado de una película de ciencia ficción, pero es real.» |
| `imagina` | «Imagina [lo imposible]. [Esta tecnología] ya lo hace posible.» Directo: nunca «imagina que…» | `imposible`: te pone la imagen en la cabeza antes de explicarla | Matt Wolfe, 3,0M (231×) | «Imagina imprimir en 3D sin gravedad.» |
| `todos-hablan-de` | «Todo internet está hablando de [X]. Y tiene motivo.» | `drama`: no quieres ser el único que no lo sabe | AI Advantage, 286k (44×), otro vídeo | «Esto ha sido de lo que más ha dado que hablar en internet: se llama Grok Companions.» |
| `famosa-por` | «La empresa famosa por [lo que todos conocen] acaba de [hacer algo que nadie esperaba].» | `imposible`: una marca que conoces, haciendo lo último que esperabas | Matt Wolfe, 338k (26×) | «La empresa famosa por convertir texto en imágenes con IA acaba de construir esto: una máquina que te escanea el cuerpo entero en 60 segundos.» |

### Resultado y prueba

| Forma | Plantilla | Por qué para | Prueba | Cómo abre |
|---|---|---|---|---|
| `prueba-en-pantalla` | «Este vídeo que estás viendo lo ha [hecho] [la IA]. Te enseño cómo.» | `imposible`: la prueba es el propio vídeo | Wes Roth, 5,3M (408×) · un creador de IA en Instagram, 218k (38×) | «Soy el gemelo digital de Wes, y ya me arrepiento de que me hayas creado.» · «Claude ya edita vídeos enteros, y es el que está editando este ahora mismo.» |
| `ya-puede` | «[Herramienta] ya puede [cosa que no sabías].» | `imposible`: una capacidad nueva de un nombre que conoces | un creador de IA en Instagram, 310k (54×) | «Claude ya puede seguir en tiempo real cada operación en bolsa de los congresistas.» |
| `resultado-exacto` | «Uso [herramienta] para [algo concreto], y me ha [resultado con su cifra] en [tiempo].» · «Así es exactamente como [resultado con su cifra].» | `dinero`: una cifra concreta, con un método a tu alcance | un creador de IA en Instagram, 275k (48×) | «Uso Claude para tener a Alex Hormozi de coach personal, y me ha generado más de 10.000 $ en un par de días.» |
| `caso-de-otro` | «Seguro que has visto [el clip viral]. Así lo hicieron.» · «Así es como [alguien] ha [logro con su cifra].» | `secreto`: el truco detrás de algo que ya viste | Varun Mayya, 7,7M (80×), 5,1M (53×) y 2,4M (25×) | «Seguro que has visto el clip de Speed retransmitiendo desde un helicóptero en mitad del océano, sin un corte.» · «Esta persona de Bengaluru acaba de convertir su casco en un aparato de la policía de tráfico, con agentes de IA.» |
| `mi-favorita` | «Esta es una de mis [herramientas] favoritas. Se llama [nombre].» | `secreto`: un nombre concreto, de alguien que lo usa | Ali Abdaal, 1,6M (50×) | «Esta es una de mis herramientas de productividad nuevas favoritas. Se llama Remarkable Paper Pro Move.» |
| `regalan` | «[Marca] está regalando [cosa que cuesta].» | `gratis`: algo que cuesta, gratis y por poco tiempo | un creador de IA en Instagram, 93,6k (16×) | «Anthropic está regalando seis meses del plan Max de Claude.» |

### Error y pérdida

| Forma | Plantilla | Por qué para | Prueba | Cómo abre |
|---|---|---|---|---|
| `lo-usas-mal` | «¿Para qué pagas [herramienta] si usas el 10 % de lo que hace?» (12 palabras como mucho) · «Todo el mundo usa [herramienta] como [lo que no es].» · «Si usas [herramienta] así, la estás usando mal.» | `perdida`: lo pagas y lo desaprovechas | Greg Isenberg, 840k (958×) y 467k (532×) | «¿Para qué te suscribes a Claude si solo usas el 10 % de su cerebro?» · «Todo el mundo usa Claude Code como si fuera una varita mágica.» |
| `si-eres` | «Si [haces algo concreto], [herramienta] acaba de convertirse en tu [mejor aliado].» · «Si [tienes algo concreto], esto es para ti.» | `perdida`: te nombra; si no lo miras, te lo pierdes | Greg Isenberg, 652k (743×) | «Si tomas notas, Claude se acaba de convertir en tu mejor compañero para pensar.» |
| `deja-de` | «Deja de [lo que hace todo el mundo].» · «[N] cosas que no debes [hacer] nunca si quieres [resultado].» | `perdida`: algo que haces cada día te está costando | NetworkChuck, 4,9M (37×) · Codie Sanchez, 572k (16×) | «Deja de pinchar en enlaces acortados.» · «Siete cosas que no debes decir nunca si quieres vender más.» |
| `te-esta-costando` | «Hay [cosas] en [tu móvil / tu cocina] que te están [costando X], y no lo sabes.» | `perdida`: el problema ya está en tu casa | The Diary of a CEO, 4,6M (18×) | «Vamos a mirar cosas de tu cocina que te están dando problemas sin que lo sepas.» |
| `nadie-habla` | «Nadie está hablando de [cosa], y [lo que te cambia].» · «Todos miran [lo obvio], pero hay [algo] de lo que nadie habla.» | `secreto`: lo que se les escapa a todos | Codie Sanchez, 870k (25×) | «Coachella ingresa 120 millones de dólares cada fin de semana. Los cabezas de cartel se llevan el mérito, pero hay un negocio entre bastidores del que nadie habla.» |

### Opinión y pregunta

| Forma | Plantilla | Por qué para | Prueba | Cómo abre |
|---|---|---|---|---|
| `sabias-que` | «¿Sabías que [dato que nadie conoce de algo que todos usan]?» | `secreto`: una pregunta que contestas en tu cabeza, y fallas | Emprende Aprendiendo, 7,7M (321×) y 5,8M (242×) · NetworkChuck, 16M (119×) | «¿Sabías que esto que estás viendo ahora es una marca de agua?» · «¿Sabías que en Windows no puedes llamar "con" a una carpeta?» |
| `dame-un-minuto` | «Dame un minuto y te cambio cómo [ves / usas X].» | `imposible`: una promesa cerrada, poco tiempo y mucho cambio | Dan Martell, 7,3M (246×) | «Dame menos de un minuto y te cambio la forma de ver tu vida.» |
| `pregunta-de-seguidor` | El problema de alguien, con sus palabras y sus cifras: «Me escribe [alguien]: "Tengo [negocio], facturamos [cifra] y [problema]".» | `secreto`: un caso real con números, y te ves en él | Alex Hormozi, 2,6M (108×), 1,1M (46×) y 1,0M (42×): tres de sus cuatro mejores abren así | «Tengo un salón de extensiones de pelo en Los Ángeles. Facturamos unos 1,2 millones.» |
| `pregunta-cifra` | «¿Cuánto [tarda / cuesta / hace falta] [X]? [La cifra que no esperas].» | `secreto`: la contestas en tu cabeza, y la de verdad te sorprende | The Diary of a CEO, 5,2M (21×) · Noah Kagan, 11M (17×) · MKBHD, 43M (8×) | «¿Cuánto tarda alguien en detectar a un psicópata? Unos cinco segundos.» · «¿Cuánto crees que hay que ganar para vivir en Nueva York?» |
| `pregunta-al-invitado` | Con alguien delante, la pregunta que todos le harían: «Fuiste de los primeros en [logro] solo con IA. ¿Cuánto sabías de [X] al empezar?» | `secreto`: la respuesta de alguien que ya lo ha hecho | David Ondrej, 428k (62×) · Charlie Chang, 325k (62×) · Leila Hormozi, 391k (33×) | «Fuiste de los primeros en crear este producto solo con herramientas de IA. Cuando empezaste, ¿cuánto sabías de programar?» · «¿Cómo empezaste a emprender?» |
| `por-que-pasa` | «¿Por qué [te pasa algo que le pasa a casi todo el mundo]?» · «¿[Va a pasar algo que da miedo]? Va a pasar.» | `secreto`: algo que te ha pasado, por fin explicado | Uri Sabat, 951k (54×) y 535k (31×) | «¿Va a caer un meteorito gigante en la Tierra? Va a caer.» · «¿Qué puede significar levantarte todas las noches a la misma hora?» |
| `opinion` | «[Lo de siempre] ya es el pasado. El futuro es [lo nuevo].» · «No me creo que [lo que repite todo el mundo].» | `drama`: va contra lo que todos dan por hecho | Greg Isenberg, 337k (384×) · Matt Wolfe, 208k (16×) | «El futuro de montar startups no es montar una startup, es montar una microstartup.» · «No me creo que la gente esté perdiendo su trabajo por la IA.» |

Una opinión tuya va en primera persona y con lo que la respalda («Uso la IA ocho horas al día y nunca la pongo en
modo rápido»), no como eslogan.

### Listas

| Forma | Plantilla | Por qué para | Prueba | Cómo abre |
|---|---|---|---|---|
| `lista-que-escala` | «[N] [cosas] 10/10 para [X], pero cada vez más de nicho.» · «¿Qué [cosas] te hacen [resultado]? Empecemos por la peor.» | `secreto`: quieres llegar a la última | Codie Sanchez, 1,0M (29×) · un reel de IA en español, 11,7k (6×) y 639 guardados, cinco veces más que cualquier otro de su cuenta | «¿Qué ideas de negocio tienen más papeletas para hacerte millonario? Empecemos por el dropshipping, abajo del todo.» |
| `novato-pro` | «[Hábito]: de rico. [Hábito]: de pobre.» · «[Cosa]: de pro. [Cosa]: de novato.» | `perdida`: quieres saber en qué lado estás | Dan Martell, 1,2M (41×) y 690k (23×) | «"El millonario de al lado": a los 20, sáltatelo.» · «Mirar tu cuenta del banco cada mañana: hábito de rico.» |
| `n-trucos` | «[Herramienta]. Tres trucos para sacarle todo el partido.» · «Estas son las [N] herramientas de IA que uso cada día.» | `secreto`: lo concreto, con nombre, para guardarlo | Xavier Mitjana, 350k (35×) · Ali Abdaal, 694k (22×) | «ChatGPT. Tres trucos para sacarle todo el partido.» · «Estas son cinco herramientas de IA que uso prácticamente cada día.» |

### Historia e identidad

| Forma | Plantilla | Por qué para | Prueba | Cómo abre |
|---|---|---|---|---|
| `cuando-empece` | «Cuando empecé, lo más difícil no era [lo que crees]. Era [lo de verdad].» · «Siempre pensé que [lo que cree todo el mundo]. Hasta que [lo que pasó].» | `secreto`: lo que nadie te cuenta hasta que te pasa | Charlie Chang, 1,4M (269×) · Fireship, 8,7M (7×, en un canal con 1,3M de mediana) | «Cuando empecé, lo más estresante de emprender no era conseguir clientes, era cobrar.» · «Siempre pensé que los ordenadores sumaban mejor que la gente, hasta que sumé 0,1 y 0,2.» |
| `soy-el-unico` | «Soy el único [humano / empleado] de [mi empresa].» | `identidad`: una frase sobre ti que no se espera | un creador de IA en Instagram, 120k (21×) | «Soy el único humano de mi empresa.» |
| `en-mitad-de-la-escena` | «Estaba [en un sitio] cuando [pasó algo], y tuve que decidir [qué hacer].» Sin contexto antes: la escena primero | `identidad`: entras en mitad de algo y quieres saber cómo acaba | The Diary of a CEO, 5,4M (22×) | «En un vuelo hubo una urgencia médica y preguntaron si había algún médico a bordo. Y tuve que decidir: ¿me ofrezco o me callo?» |
| `me-enseno` | «Te cuento una que me enseñó [mi primer jefe / un mentor].» Y la escena, con su cifra | `secreto`: una lección de alguien que sabe, dentro de una historia | Alex Hormozi, 1,0M (42×), su cuarto mejor | «Te cuento otra que me enseñó uno de mis primeros mentores. Acabábamos de poner el vestíbulo de mi segundo local y nos habíamos gastado 3.000 $.» |
| `confesion` | «Si me sigues, ya lo habrás notado: [lo que ha cambiado]. Y hay algo que te quiero contar.» | `identidad`: quien te sigue ha notado algo y quiere saber por qué | Uri Sabat, 646k (37×) | «Si has visto los últimos episodios, ya lo habrás notado. Algunos los grabamos directamente en inglés. Y hay algo que te quiero contar.» |

### Reto y demo

| Forma | Plantilla | Por qué para | Prueba | Cómo abre |
|---|---|---|---|---|
| `mira-esto` | «Mira esto», con la cosa ya en pantalla y el contexto en la misma frase · «Acabo de construir [esto] con [herramienta], sin saber programar.» Solo con lo visual: dicho a secas, llega tarde | `imposible`: lo ves antes de entenderlo | David Ondrej, 760k (111×) · Riley Brown, 558k (56×) · Nate Herk, 1,4M (50×) | «¿Qué puedo hacer con agentes de IA? Mira, te enseño un ejemplo.» · «Acabo de montar el asistente personal definitivo en n8n, sin una línea de código.» |
| `reto` | «Le he dado a [la IA] [tiempo] para [cosa]. Al final te enseño si funciona.» · «Es el primer [X] del mundo, y tenía que probarlo.» | `imposible`: te quedas a ver si sale | NetworkChuck, 10M (75×) · MKBHD, 47M (9×) | «Creo que he hecho un navegador a prueba de virus. Para comprobarlo, voy a pinchar en todos los enlaces sospechosos que encuentre.» · «Este es el primer cuchillo de chef ultrasónico del mundo, y tenía que probarlo.» |

## 3. Lo que se repite en los 99

- **Un nombre que conoce todo el mundo en las tres primeras palabras**: Claude, Windows, Elon Musk.
- **Una pregunta que quien mira contesta en su cabeza**: «¿Sabías que…?».
- **La prueba en el plano**: el avatar que habla, la marca de agua que estás viendo.
- Fuera del banco: entrevistas por la calle y bromas (Simon Squibb, Noah Kagan, MrBeast, Jenny Hoyos). Aguantan por
  la reacción del desconocido, no por la frase, así que no se pueden copiar en un reel hablado.

## 4. Cómo se rellena una forma

**Tres movimientos** (Kallaway: contexto, frenazo y giro):
1. El tema y por qué te importa, en la frase 1: «La tecnología de la Sphere de Las Vegas es una locura…».
2. Un «pero» que te para: «…pero la pantalla es lo menos impresionante».
3. El giro hacia el otro lado: «…porque lo mejor es el sonido».

Los tres pueden repartirse entre el gancho y su frase 2. «Si quieres X, no hagas Y, haz Z»: y Z tiene que valer la
pena, o es un truco.

**Las seis palabras** (Kallaway): quién (yo, tú, una marca), la acción, el resultado, el contraste (de dónde a
dónde) y, si caben, la prueba («otra vez») y el tiempo («en 90 días»). «Si tuviera que pasar de 0 a 100.000 en
YouTube» tiene las cuatro primeras.

**Quien sale tiene que parecerse a quien mira** (Kallaway): un resultado de sueño con un método simple y sin
condiciones. Con una ventaja injusta («con mi equipo de diez») o una condición que no puede cumplir (una herramienta
de 1.200 €), pasa de largo.

**La etiqueta, cuanto más estrecha, más fuerte** (Hormozi): «Si tienes una clínica con tres fisios» gana a «Si
tienes un negocio».

## 5. Los cuatro fallos

Repasa cada gancho, uno a uno (los «cuatro jinetes» de Kallaway):

- **Llega tarde**: palabras antes de lo que importa. «Chicos, esto es lo más loco que he visto» no dice nada.
- **Se enreda**: hay que oírlo dos veces. Dos ideas, o una palabra abstracta («ver una app por dentro»).
- **No va de ti**: quien mira no se ve dentro. Apunta a lo que quiere: no pagar, que se lo hagan, no quedarse atrás.
- **Sin intriga**: se entiende y aun así se pasa. Abre con un nombre que conoce todo el mundo, una cifra o un
  resultado.

Y además:
- Una palabra que no conoce todo el mundo (MCP, RAG) va en la frase 2, no en el gancho.
- En primera persona, la frase 2 ya le habla a quien mira.
- Concreto: una cosa con nombre, una cifra o algo que se ve. «Una app» no engancha; «Photoshop», sí.
- «No es X, es Y» suena a IA: dilo en dos frases. El comprobador lo marca.
