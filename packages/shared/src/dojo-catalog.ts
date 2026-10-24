/**
 * Catálogo del Dojo, v1: las tres primeras unidades (fundamentos de Python,
 * complejidad y hash map). Problemas PROPIOS, escritos a mano: los enunciados
 * de LeetCode tienen copyright; las ideas clásicas (dos que suman, anagramas,
 * comprar y vender) son de dominio común y aquí se cuentan con palabras y
 * ejemplos nuestros.
 *
 * Un test del agente (dojo/dojo.test.ts) corre cada solución de referencia
 * contra sus casos con el MISMO harness que usa el navegador, ejecuta el código
 * de cada lección y revisa que la escalera de pistas tenga sus cuatro escalones.
 * Un problema nuevo que no pase eso no entra.
 *
 * Los casos grandes llevan `timeLimitMs`: son los que separan una solución
 * O(n²) de una O(n). Los límites están pensados para Pyodide (más lento que
 * CPython) con holgura de sobra para la solución buena.
 */
import type { DojoItem, DojoUnit } from "./dojo.js";

// ── Unidad 1 · Fundamentos ─────────────────────────────────────────────

const FUNDAMENTOS: DojoItem[] = [
  {
    id: "f-funciones",
    unit: "fundamentos",
    kind: "concepto",
    title: "Funciones: lo que entra y lo que sale",
    summary: "Variables, tipos, cuentas y tu primera función con return.",
    blocks: [
      {
        kind: "text",
        text: "Un programa es una lista de instrucciones que Python lee de arriba hacia abajo. Para guardar un valor y usarlo después usas una **variable**: un nombre que apunta a un valor. Con `=` le das valor; si la vuelves a asignar, apunta al nuevo.",
      },
      {
        kind: "code",
        code: `edad = 31
nombre = "Rulo"
print(nombre, "tiene", edad, "años")
edad = edad + 1
print("El año que viene:", edad)`,
        note: "Dale a Correr. Después cambia los valores y vuelve a correrlo: aprender es romper cosas aquí.",
      },
      {
        kind: "text",
        text: "Cada valor tiene un **tipo**: `31` es un entero (`int`), `3.5` un decimal (`float`), `\"hola\"` un texto (`str`), y `True`/`False` son booleanos (`bool`). Con `+ - * /` haces cuentas; `//` divide sin decimales y `%` da el residuo de la división.",
      },
      {
        kind: "code",
        code: `print(7 / 2)
print(7 // 2)
print(7 % 2)
print("ja" * 3)`,
      },
      {
        kind: "check",
        question: "¿Qué imprime `print(10 % 3)`?",
        answer: "1",
        why: "`%` es el residuo: 10 = 3 × 3 + 1, sobra 1.",
      },
      {
        kind: "text",
        text: "Una **función** es una receta con nombre: recibe valores (parámetros), hace algo con ellos y **devuelve** un resultado con `return`. Todos los ejercicios del Dojo son funciones: tú escribes el cuerpo y los tests la llaman con distintos valores para ver si responde bien.",
      },
      {
        kind: "code",
        code: `def area_rectangulo(base, altura):
    resultado = base * altura
    return resultado

print(area_rectangulo(3, 4))
print(area_rectangulo(10, 2))`,
      },
      {
        kind: "text",
        text: "Dos cosas que muerden al principio. La **sangría**: lo que va dentro de la función lleva 4 espacios a la derecha; así sabe Python qué es parte de ella. Y `print` no es `return`: `print` muestra algo en pantalla, `return` le entrega el valor a quien llamó la función. Los tests miran lo que devuelves, no lo que imprimes.",
      },
      {
        kind: "check",
        question: "¿Qué imprime la última línea?",
        code: `def f(x):
    print(x * 2)

r = f(5)
print(r)`,
        answer: "None",
        why: "La función imprime 10, pero no tiene `return`, así que devuelve `None` (nada). Por eso `r` vale `None`.",
      },
    ],
  },
  {
    id: "f-doble",
    unit: "fundamentos",
    kind: "guiado",
    title: "El doble",
    summary: "Tu primera función: recibe un número y devuelve otro.",
    problem: {
      fn: "doble",
      signature: "def doble(n):",
      statement: [
        "Escribe una función que reciba un número `n` y **devuelva** el doble.",
        "Recuerda: devolver es `return`, no `print`.",
      ],
      cases: [
        { args: [4], expected: 8 },
        { args: [0], expected: 0 },
        { args: [-3], expected: -6 },
        { args: [2.5], expected: 5.0, hidden: true },
        { args: [1000000], expected: 2000000, hidden: true },
      ],
      hints: [
        "Te dan un número y devuelves ese mismo número multiplicado por dos.",
        "Con n = 4 la función devuelve 8; con n = -3 devuelve -6. No hay que preguntar nada: siempre es la misma cuenta.",
        "No hay patrón aquí: es una operación y un return. El error típico es usar print en vez de return (el test ve None).",
        "Devolver n por 2.",
      ],
      solution: `def doble(n):
    return n * 2`,
      complexity: { time: "O(1)", space: "O(1)", why: "Una sola operación, sin importar qué número llegue." },
    },
  },
  {
    id: "f-saludo",
    unit: "fundamentos",
    kind: "guiado",
    title: "Saludo",
    summary: "Armar un texto con lo que te llega.",
    problem: {
      fn: "saludo",
      signature: "def saludo(nombre):",
      statement: [
        "Escribe una función que reciba un `nombre` y devuelva el texto `Hola, <nombre>!`.",
        "Por ejemplo, con `\"Ana\"` devuelve `\"Hola, Ana!\"`: con coma, un espacio y el signo de exclamación pegado al final. Los tests comparan letra por letra.",
      ],
      cases: [
        { args: ["Ana"], expected: "Hola, Ana!" },
        { args: ["Rulo"], expected: "Hola, Rulo!" },
        { args: [""], expected: "Hola, !", hidden: true },
        { args: ["María José"], expected: "Hola, María José!", hidden: true },
      ],
      hints: [
        "Recibes un texto y devuelves otro texto: «Hola, », luego el nombre, luego «!».",
        "Con «Ana» el resultado es exactamente Hola, Ana! — fíjate en el espacio después de la coma y en que no hay espacio antes del signo.",
        "Hay dos formas de unir textos: con + (\"a\" + \"b\" da \"ab\") o con un f-string, que mete variables entre llaves dentro de un texto que empieza con f.",
        "Devolver «Hola, » + nombre + «!».",
      ],
      solution: `def saludo(nombre):
    return f"Hola, {nombre}!"`,
      complexity: {
        time: "O(n)",
        space: "O(n)",
        why: "Armar el texto copia las letras del nombre: crece con su largo (n = letras del nombre).",
      },
    },
  },
  {
    id: "f-decidir",
    unit: "fundamentos",
    kind: "concepto",
    title: "Decidir: if, elif, else",
    summary: "Comparaciones, booleanos y elegir un camino.",
    blocks: [
      {
        kind: "text",
        text: "Una **comparación** responde sí o no: `==` (igual), `!=` (distinto), `<`, `>`, `<=`, `>=`. El resultado es un booleano. Puedes combinarlas con `and` (las dos), `or` (al menos una) y `not` (lo contrario).",
      },
      {
        kind: "code",
        code: `edad = 17
print(edad >= 18)
print(edad >= 13 and edad < 18)
print(not edad == 17)`,
      },
      {
        kind: "text",
        text: "Con `if` eliges qué hacer. Python prueba las condiciones en orden y corre SOLO la primera que sea verdadera; `elif` es «si no, prueba esto»; `else` es «en cualquier otro caso».",
      },
      {
        kind: "code",
        code: `def signo(n):
    if n > 0:
        return "positivo"
    elif n < 0:
        return "negativo"
    else:
        return "cero"

print(signo(5), signo(-2), signo(0))`,
      },
      {
        kind: "text",
        text: "`return` termina la función en ese instante: lo que viene después ya no corre. Por eso, en `signo`, cuando `n > 0` ni siquiera se mira el `elif`.",
      },
      {
        kind: "check",
        question: "¿Qué imprime?",
        code: `x = 15
if x > 10:
    print("A")
elif x > 5:
    print("B")
else:
    print("C")`,
        answer: "A",
        why: "Solo corre la primera rama verdadera. 15 > 10, así que imprime A y salta el resto, aunque 15 > 5 también sea cierto.",
      },
      {
        kind: "check",
        question: "¿Cómo sabes si un número `n` es múltiplo de 3?",
        answer: "n % 3 == 0",
        accept: ["n%3==0", "n % 3 == 0:", "if n % 3 == 0:"],
        why: "Si el residuo de dividir entre 3 es 0, la división es exacta: es múltiplo.",
      },
    ],
  },
  {
    id: "f-es-par",
    unit: "fundamentos",
    kind: "guiado",
    title: "¿Es par?",
    summary: "Devolver un booleano a partir de una cuenta.",
    problem: {
      fn: "es_par",
      signature: "def es_par(n):",
      statement: [
        "Escribe una función que reciba un entero `n` y devuelva `True` si es par y `False` si es impar.",
        "Ojo: se devuelven los booleanos `True`/`False`, no los textos `\"True\"` ni los números 1 y 0.",
      ],
      cases: [
        { args: [4], expected: true },
        { args: [7], expected: false },
        { args: [0], expected: true },
        { args: [-2], expected: true, hidden: true },
        { args: [-7], expected: false, hidden: true },
        { args: [1000001], expected: false, hidden: true },
      ],
      hints: [
        "Te preguntan si el número se puede dividir entre 2 sin que sobre nada. La respuesta es True o False.",
        "4 entre 2 da 2 y sobra 0 → par. 7 entre 2 da 3 y sobra 1 → impar.",
        "El operador % te da lo que sobra de una división. Y una comparación con == ya ES un booleano: no hace falta un if para devolver True o False.",
        "Devolver (lo que sobra de n entre 2) es igual a 0.",
      ],
      solution: `def es_par(n):
    return n % 2 == 0`,
      complexity: { time: "O(1)", space: "O(1)", why: "Una división y una comparación." },
    },
  },
  {
    id: "f-etapa",
    unit: "fundamentos",
    kind: "guiado",
    title: "Etapa de la vida",
    summary: "Varias ramas y los bordes que siempre se olvidan.",
    problem: {
      fn: "etapa",
      signature: "def etapa(edad):",
      statement: [
        "Según la `edad`, devuelve una de estas palabras:",
        "menos de 13 → `\"niño\"` · de 13 a 17 → `\"adolescente\"` · de 18 a 64 → `\"adulto\"` · 65 o más → `\"mayor\"`.",
      ],
      cases: [
        { args: [8], expected: "niño" },
        { args: [15], expected: "adolescente" },
        { args: [30], expected: "adulto" },
        { args: [0], expected: "niño", hidden: true },
        { args: [12], expected: "niño", hidden: true },
        { args: [13], expected: "adolescente", hidden: true },
        { args: [17], expected: "adolescente", hidden: true },
        { args: [18], expected: "adulto", hidden: true },
        { args: [64], expected: "adulto", hidden: true },
        { args: [65], expected: "mayor", hidden: true },
        { args: [90], expected: "mayor", hidden: true },
      ],
      hints: [
        "Según la edad devuelves una de cuatro palabras. Los límites importan: 13 ya es adolescente y 18 ya es adulto.",
        "Prueba los bordes a mano antes de escribir: 12 → niño, 13 → adolescente, 17 → adolescente, 18 → adulto, 65 → mayor.",
        "Una cadena de if/elif/else ordenada de menor a mayor: como gana la primera condición verdadera, cada una solo tiene que mirar su tope.",
        "Si edad < 13 → niño; si no, si < 18 → adolescente; si no, si < 65 → adulto; si no → mayor.",
      ],
      solution: `def etapa(edad):
    if edad < 13:
        return "niño"
    elif edad < 18:
        return "adolescente"
    elif edad < 65:
        return "adulto"
    else:
        return "mayor"`,
      complexity: { time: "O(1)", space: "O(1)", why: "Como mucho tres comparaciones, sea cual sea la edad." },
    },
  },
  {
    id: "f-repetir",
    unit: "fundamentos",
    kind: "concepto",
    title: "Repetir: for, range y while",
    summary: "Bucles y el patrón acumulador.",
    blocks: [
      {
        kind: "text",
        text: "`for` repite un bloque una vez por cada elemento de algo. `range(n)` da los números de 0 a n-1 (el último NO se incluye); `range(a, b)` va de a hasta b-1.",
      },
      {
        kind: "code",
        code: `for i in range(5):
    print(i)

for i in range(2, 6):
    print("vuelta", i)`,
      },
      {
        kind: "text",
        text: "El patrón más útil del principio es el **acumulador**: una variable que empieza en 0 (o vacía) y que en cada vuelta va sumando algo. `total += i` es lo mismo que `total = total + i`.",
      },
      {
        kind: "code",
        code: `total = 0
for i in range(1, 5):
    total += i
    print("sumé", i, "-> total =", total)
print("final:", total)`,
        note: "Lee la salida línea por línea: así se ve un acumulador por dentro.",
      },
      {
        kind: "text",
        text: "`while` repite MIENTRAS una condición sea verdadera. Si la condición nunca se vuelve falsa, el programa no termina (bucle infinito): el Dojo lo corta a los pocos segundos y te avisa.",
      },
      {
        kind: "code",
        code: `n = 1
while n < 100:
    n = n * 2
print(n)`,
      },
      {
        kind: "check",
        question: "¿Cuántas líneas imprime?",
        code: `for i in range(3, 8):
    print(i)`,
        answer: "5",
        why: "range(3, 8) da 3, 4, 5, 6 y 7: el 8 no entra. Son 5.",
      },
      {
        kind: "check",
        question: "¿Qué imprime?",
        code: `total = 0
for x in [2, 4, 6]:
    total += x
print(total)`,
        answer: "12",
        why: "El acumulador hace 0 + 2 + 4 + 6 = 12.",
      },
    ],
  },
  {
    id: "f-suma-hasta",
    unit: "fundamentos",
    kind: "guiado",
    title: "Suma hasta n",
    summary: "Tu primer acumulador.",
    problem: {
      fn: "suma_hasta",
      signature: "def suma_hasta(n):",
      statement: [
        "Devuelve la suma de todos los enteros desde 1 hasta `n`, incluido `n`.",
        "Por ejemplo, `suma_hasta(4)` es 1 + 2 + 3 + 4 = 10. Si `n` es 0, la suma es 0.",
      ],
      cases: [
        { args: [3], expected: 6 },
        { args: [5], expected: 15 },
        { args: [0], expected: 0 },
        { args: [1], expected: 1, hidden: true },
        { args: [10], expected: 55, hidden: true },
        { args: [100], expected: 5050, hidden: true },
      ],
      hints: [
        "Sumas todos los enteros desde 1 hasta n, con n incluido. Con n = 0 no hay nada que sumar.",
        "n = 4: lleva la cuenta en voz alta — 1, luego 1+2 = 3, luego 3+3 = 6, luego 6+4 = 10.",
        "Patrón acumulador: una variable que empieza en 0 y en cada vuelta suma el número de esa vuelta. Cuidado con el borde de range: no incluye el último.",
        "total = 0; para cada i de 1 a n (incluido): total += i; devolver total.",
      ],
      solution: `def suma_hasta(n):
    total = 0
    for i in range(1, n + 1):
        total += i
    return total`,
      complexity: { time: "O(n)", space: "O(1)", why: "Una vuelta por cada número de 1 a n; solo guarda el total." },
    },
  },
  {
    id: "f-listas",
    unit: "fundamentos",
    kind: "concepto",
    title: "Listas",
    summary: "Posiciones, len, append y recorrerlas.",
    blocks: [
      {
        kind: "text",
        text: "Una **lista** guarda varios valores en orden. Cada uno tiene una posición (índice) que empieza en **0**. Con índices negativos cuentas desde el final: `lista[-1]` es el último.",
      },
      {
        kind: "code",
        code: `frutas = ["mango", "lulo", "uva"]
print(frutas[0])
print(frutas[-1])
print(len(frutas))
frutas.append("feijoa")
print(frutas)
print("lulo" in frutas)`,
      },
      {
        kind: "text",
        text: "Hay tres formas de recorrer una lista: por elemento (`for x in lista`), por posición (`for i in range(len(lista))`) o con las dos cosas a la vez (`for i, x in enumerate(lista)`).",
      },
      {
        kind: "code",
        code: `numeros = [5, 8, 2]
for x in numeros:
    print("elemento", x)
for i in range(len(numeros)):
    print("posición", i, "tiene", numeros[i])
for i, x in enumerate(numeros):
    print(i, x)`,
      },
      {
        kind: "text",
        text: "Pedir una posición que no existe (`numeros[3]` en una lista de 3) da `IndexError`. Es EL error de las listas: la última posición es `len(lista) - 1`.",
      },
      {
        kind: "check",
        question: "¿Qué imprime?",
        code: `a = [10, 20, 30, 40]
print(a[1] + a[-1])`,
        answer: "60",
        why: "a[1] es 20 (la segunda) y a[-1] es la última, 40: 20 + 40 = 60.",
      },
      {
        kind: "check",
        question: "Con una lista vacía `[]`, ¿cuántas veces corre el cuerpo de `for x in lista:`? Escribe el número.",
        answer: "0",
        accept: ["ninguna", "Ninguna", "cero", "0 veces", "ninguna vez"],
        why: "No hay elementos, así que el for no entra ni una vez. Por eso un acumulador empieza con el valor que tiene sentido para la lista vacía.",
      },
    ],
  },
  {
    id: "f-contar-pares",
    unit: "fundamentos",
    kind: "guiado",
    title: "Contar pares",
    summary: "Un acumulador con condición.",
    problem: {
      fn: "contar_pares",
      signature: "def contar_pares(numeros):",
      statement: [
        "Recibes una lista de enteros. Devuelve **cuántos** de ellos son pares.",
        "Devuelves un número, no la lista.",
      ],
      cases: [
        { args: [[1, 2, 3, 4]], expected: 2 },
        { args: [[7, 9]], expected: 0 },
        { args: [[]], expected: 0 },
        { args: [[0, -2, 5]], expected: 2, hidden: true },
        { args: [[2, 2, 2]], expected: 3, hidden: true },
      ],
      hints: [
        "Recorres la lista y cuentas cuántos números son pares. Lo que devuelves es esa cuenta.",
        "[1, 2, 3, 4]: el 1 no; el 2 sí (van 1); el 3 no; el 4 sí (van 2). Respuesta: 2.",
        "Es un acumulador que solo suma cuando se cumple algo: un if dentro del for. Ya sabes decidir si un número es par.",
        "cuenta = 0; para cada x en numeros: si x es par, cuenta += 1; devolver cuenta.",
      ],
      solution: `def contar_pares(numeros):
    cuenta = 0
    for x in numeros:
        if x % 2 == 0:
            cuenta += 1
    return cuenta`,
      complexity: { time: "O(n)", space: "O(1)", why: "Mira cada número una vez; solo guarda la cuenta." },
    },
  },
  {
    id: "f-mayor",
    unit: "fundamentos",
    kind: "guiado",
    title: "El mayor (sin max)",
    summary: "El patrón «el mejor hasta ahora».",
    problem: {
      fn: "mayor",
      signature: "def mayor(numeros):",
      statement: [
        "Recibes una lista con al menos un número. Devuelve el más grande.",
        "Este ejercicio es para entender cómo funciona por dentro: no se vale usar `max`, `sorted` ni `sort`.",
      ],
      banned: ["max", "sorted", "sort"],
      cases: [
        { args: [[3, 9, 2]], expected: 9 },
        { args: [[-5, -1, -8]], expected: -1 },
        { args: [[7]], expected: 7 },
        { args: [[1, 2, 3, 4, 5]], expected: 5, hidden: true },
        { args: [[5, 4, 3]], expected: 5, hidden: true },
        { args: [[-3, -3]], expected: -3, hidden: true },
        { args: [[0, -1, 100, 99]], expected: 100, hidden: true },
      ],
      hints: [
        "Te dan una lista con al menos un número y devuelves el más grande, sin max ni ordenar.",
        "[3, 9, 2]: «el mayor hasta ahora» es 3; llega el 9, es más grande, ahora el mayor es 9; llega el 2, no cambia. Respuesta: 9.",
        "Guarda «el mejor hasta ahora» y compáralo con cada número. Cuidado con el valor inicial: si empiezas en 0, una lista de puros negativos te devuelve 0, que ni siquiera está en la lista.",
        "mejor = el primer elemento; para cada x en la lista: si x > mejor, mejor = x; devolver mejor.",
      ],
      solution: `def mayor(numeros):
    mejor = numeros[0]
    for x in numeros:
        if x > mejor:
            mejor = x
    return mejor`,
      complexity: { time: "O(n)", space: "O(1)", why: "Una pasada por la lista guardando un solo valor." },
    },
  },
  {
    id: "f-textos",
    unit: "fundamentos",
    kind: "concepto",
    title: "Textos (strings)",
    summary: "Letras, métodos y rebanadas.",
    blocks: [
      {
        kind: "text",
        text: "Un texto se comporta como una lista de letras: tiene posiciones, `len` y se puede recorrer con `for`. Además trae métodos útiles: `lower()`/`upper()` cambian mayúsculas, `split()` lo parte en palabras, `replace(a, b)` cambia una cosa por otra. Los textos no se modifican: cada método devuelve uno nuevo.",
      },
      {
        kind: "code",
        code: `palabra = "Hermes"
print(palabra[0], palabra[-1], len(palabra))
print(palabra.lower(), palabra.upper())
for letra in palabra:
    print(letra)`,
      },
      {
        kind: "code",
        code: `frase = "el código no se escribe solo"
print("código" in frase)
print(frase.split())
print(frase.replace(" ", ""))`,
      },
      {
        kind: "text",
        text: "Las **rebanadas** (slices) sacan un pedazo: `texto[a:b]` va de la posición a hasta b-1, y `texto[::-1]` lo devuelve al revés. Funcionan igual con listas.",
      },
      {
        kind: "code",
        code: `t = "teclado"
print(t[0:3])
print(t[3:])
print(t[::-1])`,
      },
      {
        kind: "check",
        question: "¿Qué imprime `print(\"Bogotá\".lower()[0])`?",
        answer: "b",
        why: "Primero lower() da \"bogotá\" y luego [0] toma la primera letra: b.",
      },
      {
        kind: "check",
        question: "`\"a\" in \"Hola\"` es…",
        answer: "True",
        why: "in busca dentro del texto: «Hola» termina en a minúscula.",
      },
    ],
  },
  {
    id: "f-vocales",
    unit: "fundamentos",
    kind: "guiado",
    title: "Contar vocales",
    summary: "Recorrer un texto letra por letra.",
    problem: {
      fn: "contar_vocales",
      signature: "def contar_vocales(texto):",
      statement: [
        "Devuelve cuántas vocales tiene `texto`.",
        "Las mayúsculas cuentan y las vocales con tilde (á, é, í, ó, ú) también.",
      ],
      cases: [
        { args: ["hola"], expected: 2 },
        { args: ["Murciélago"], expected: 5 },
        { args: [""], expected: 0 },
        { args: ["xyz"], expected: 0, hidden: true },
        { args: ["AEIOU"], expected: 5, hidden: true },
        { args: ["Bogotá"], expected: 3, hidden: true },
      ],
      hints: [
        "Cuentas cuántas letras del texto son vocales. Mayúsculas y vocales con tilde también valen.",
        "«Murciélago»: u, i, é, a, o → 5. La é lleva tilde y la M mayúscula no es vocal.",
        "Recorre letra por letra con un acumulador. Para no escribir diez comparaciones, guarda todas las vocales en un solo texto y pregunta con in si la letra está ahí; pásala a minúscula antes de preguntar.",
        "vocales = «aeiouáéíóú»; cuenta = 0; para cada letra: si la letra en minúscula está en vocales, cuenta += 1; devolver cuenta.",
      ],
      solution: `def contar_vocales(texto):
    vocales = "aeiouáéíóú"
    cuenta = 0
    for letra in texto:
        if letra.lower() in vocales:
            cuenta += 1
    return cuenta`,
      complexity: {
        time: "O(n)",
        space: "O(1)",
        why: "Una vuelta por letra; buscar en un texto fijo de 10 vocales no crece con la entrada.",
      },
    },
  },
  {
    id: "f-palindromo",
    unit: "fundamentos",
    kind: "guiado",
    title: "¿Palíndromo?",
    summary: "Limpiar antes de comparar.",
    problem: {
      fn: "es_palindromo",
      signature: "def es_palindromo(texto):",
      statement: [
        "Un palíndromo se lee igual al derecho y al revés. Devuelve `True` si `texto` lo es.",
        "Ignora los espacios y no distingas mayúsculas de minúsculas: `\"Anita lava la tina\"` es palíndromo.",
      ],
      cases: [
        { args: ["oso"], expected: true },
        { args: ["Anita lava la tina"], expected: true },
        { args: ["teclado"], expected: false },
        { args: [""], expected: true, hidden: true },
        { args: ["a"], expected: true, hidden: true },
        { args: ["ab"], expected: false, hidden: true },
        { args: ["Ana"], expected: true, hidden: true },
        { args: ["La ruta natural"], expected: true, hidden: true },
      ],
      hints: [
        "Se lee igual al derecho y al revés. Antes de comparar, quita los espacios y no distingas mayúsculas.",
        "«Anita lava la tina» → limpio: «anitalavalatina» → al revés: «anitalavalatina». Iguales → True.",
        "Dos pasos: limpiar el texto (minúsculas y sin espacios) y comparar el texto limpio con su versión al revés. Las dos cosas tienen métodos o rebanadas que viste en la lección de textos.",
        "limpio = texto en minúsculas sin espacios; devolver limpio == limpio al revés.",
      ],
      solution: `def es_palindromo(texto):
    limpio = texto.lower().replace(" ", "")
    return limpio == limpio[::-1]`,
      complexity: { time: "O(n)", space: "O(n)", why: "Limpiar e invertir recorren el texto y crean copias del mismo largo." },
    },
  },
  {
    id: "f-fizzbuzz",
    unit: "fundamentos",
    kind: "prueba",
    title: "FizzBuzz",
    summary: "La prueba de la unidad: for, if y listas a la vez.",
    problem: {
      fn: "fizzbuzz",
      signature: "def fizzbuzz(n):",
      statement: [
        "Devuelve una **lista de textos** con un elemento por cada número del 1 al `n`:",
        "múltiplo de 3 y de 5 → `\"FizzBuzz\"` · solo de 3 → `\"Fizz\"` · solo de 5 → `\"Buzz\"` · cualquier otro → el número como texto (`str(7)` da `\"7\"`).",
      ],
      cases: [
        { args: [5], expected: ["1", "2", "Fizz", "4", "Buzz"] },
        {
          args: [15],
          expected: ["1", "2", "Fizz", "4", "Buzz", "Fizz", "7", "8", "Fizz", "Buzz", "11", "Fizz", "13", "14", "FizzBuzz"],
        },
        { args: [0], expected: [], hidden: true },
        { args: [1], expected: ["1"], hidden: true },
        { args: [3], expected: ["1", "2", "Fizz"], hidden: true },
        {
          argsExpr: "[45]",
          expectedExpr:
            '["FizzBuzz" if i % 15 == 0 else "Fizz" if i % 3 == 0 else "Buzz" if i % 5 == 0 else str(i) for i in range(1, 46)]',
          label: "fizzbuzz(45)",
          hidden: true,
        },
      ],
      hints: [
        "Devuelves una LISTA de n textos, uno por cada número del 1 al n.",
        "Para 15 la lista termina en …, «13», «14», «FizzBuzz»: el 15 es múltiplo de 3 y de 5 a la vez.",
        "for + if/elif/else + append. El orden de las condiciones importa: si preguntas primero por el 3, el 15 nunca llega a «FizzBuzz».",
        "res = []; para i de 1 a n: si es múltiplo de 15 → «FizzBuzz»; si no, de 3 → «Fizz»; si no, de 5 → «Buzz»; si no → str(i); agregarlo a res. Devolver res.",
      ],
      solution: `def fizzbuzz(n):
    res = []
    for i in range(1, n + 1):
        if i % 15 == 0:
            res.append("FizzBuzz")
        elif i % 3 == 0:
            res.append("Fizz")
        elif i % 5 == 0:
            res.append("Buzz")
        else:
            res.append(str(i))
    return res`,
      complexity: { time: "O(n)", space: "O(n)", why: "Una vuelta por número y una lista de n textos." },
    },
  },
];

// ── Unidad 2 · Complejidad ─────────────────────────────────────────────

const COMPLEJIDAD: DojoItem[] = [
  {
    id: "c-pasos",
    unit: "complejidad",
    kind: "concepto",
    title: "Contar pasos",
    summary: "Big O contado con tus propios bucles.",
    blocks: [
      {
        kind: "text",
        text: "Dos soluciones pueden dar la misma respuesta y tardar muy distinto. Para compararlas no se miden segundos (cambian según el computador): se cuentan los **pasos** que da el programa según el tamaño de la entrada, que se llama **n**.",
      },
      {
        kind: "code",
        code: `n = 1000

pasos = 0
for i in range(n):
    pasos += 1
print("un for:", pasos)

pasos = 0
for i in range(n):
    for j in range(n):
        pasos += 1
print("un for dentro de otro:", pasos)`,
        note: "Cambia n a 2000 y fíjate cuánto crece cada uno.",
      },
      {
        kind: "text",
        text: "Un `for` sobre n elementos da n pasos: es **O(n)**, lineal. Un `for` dentro de otro da n × n: **O(n²)**, cuadrático. Algo que no depende de n (sumar dos números, leer `lista[0]`) es **O(1)**, constante. La O ignora las constantes: dos `for` seguidos (no uno dentro del otro) siguen siendo O(n).",
      },
      {
        kind: "check",
        question: "¿Qué complejidad tiene?",
        code: `def f(lista):
    total = 0
    for x in lista:
        total += x
    for x in lista:
        total -= 1
    return total`,
        answer: "O(n)",
        why: "Son dos for seguidos, no anidados: 2n pasos. La O ignora el 2 → O(n).",
      },
      {
        kind: "check",
        question: "¿Y esta?",
        code: `def g(lista):
    for a in lista:
        for b in lista:
            if a + b == 10:
                return True
    return False`,
        answer: "O(n²)",
        accept: ["O(n*n)", "O(n2)"],
        why: "Por cada elemento recorre la lista entera: n × n en el peor caso (cuando no encuentra nada y no sale antes).",
      },
      {
        kind: "text",
        text: "Ojo con lo que esconde una sola línea: `x in lista` recorre la lista por dentro (O(n)), y ordenar con `sorted` cuesta O(n log n). Una línea no es un paso.",
      },
      {
        kind: "check",
        question: "Si `a` y `b` son listas de n elementos, ¿qué complejidad tiene?",
        code: `def comunes(a, b):
    c = 0
    for x in a:
        if x in b:
            c += 1
    return c`,
        answer: "O(n²)",
        accept: ["O(n*n)", "O(n2)"],
        why: "El for da n vueltas y cada `x in b` recorre b: n × n. En la unidad de hash map vas a bajarlo a O(n).",
      },
    ],
  },
  {
    id: "c-crece",
    unit: "complejidad",
    kind: "concepto",
    title: "Cuando n crece",
    summary: "Por qué O(n²) explota y cómo se nota en los tests.",
    blocks: [
      {
        kind: "text",
        text: "Con n pequeño todo es rápido. La diferencia aparece cuando n crece: con n = 10, O(n²) son 100 pasos; con n = 1.000, un millón; con n = 100.000, **diez mil millones**. Python en el navegador da del orden de diez millones de pasos simples por segundo (depende del equipo), así que eso ya son minutos.",
      },
      {
        kind: "code",
        code: `import time

def suma_lenta(n):
    total = 0
    for i in range(n):
        total += i
    return total

for n in [10_000, 100_000, 1_000_000]:
    t0 = time.perf_counter()
    suma_lenta(n)
    ms = (time.perf_counter() - t0) * 1000
    print(f"n = {n:>9,}  ->  {ms:7.1f} ms")`,
        note: "Lineal: cada vez que n se multiplica por 10, el tiempo también.",
      },
      {
        kind: "code",
        code: `import time

def todos_los_pares(n):
    c = 0
    for i in range(n):
        for j in range(n):
            c += 1
    return c

for n in [100, 300, 1000]:
    t0 = time.perf_counter()
    todos_los_pares(n)
    ms = (time.perf_counter() - t0) * 1000
    print(f"n = {n:>5}  ->  {ms:7.1f} ms")`,
        note: "Cuadrático: n × 3 hace el tiempo × 9.",
      },
      {
        kind: "text",
        text: "Algunos problemas del Dojo traen casos ocultos con entradas grandes (100.000 elementos) y un límite de tiempo. Una solución O(n²) pasa los ejemplos pequeños y se pasa del tiempo en esos. Cuando te pase, la señal no es «optimiza un poquito»: es que hace falta otra idea.",
      },
      {
        kind: "check",
        question: "Una solución O(n²) tarda 1 segundo con n = 1.000. ¿Cuántos segundos tarda con n = 10.000?",
        answer: "100",
        accept: ["100 s", "100s", "100 segundos"],
        why: "n se multiplicó por 10, así que n² se multiplica por 100.",
      },
      {
        kind: "check",
        question: "Con n = 100.000, ¿cuántos pasos da una solución O(n²)? Escríbelo con todos sus ceros.",
        answer: "10000000000",
        accept: ["10.000.000.000", "10,000,000,000", "10_000_000_000", "10**10", "10^10", "1e10"],
        why: "100.000 × 100.000 = 10.000.000.000. Una O(n) da 100.000 pasos: cien mil veces menos. Para n grande manda la forma de la curva, no lo rápido que sea cada paso.",
      },
    ],
  },
  {
    id: "c-suma-gigante",
    unit: "complejidad",
    kind: "guiado",
    title: "Suma gigante",
    summary: "Cuando ni el for más simple alcanza: O(1).",
    problem: {
      fn: "suma_gigante",
      signature: "def suma_gigante(n):",
      statement: [
        "Igual que «Suma hasta n»: devuelve 1 + 2 + … + `n`.",
        "Pero ahora `n` puede ser un billón (10¹²) y cada caso tiene **un segundo**. Un for de un billón de vueltas no termina ni en horas.",
      ],
      timeLimitMs: 1000,
      cases: [
        { args: [3], expected: 6 },
        { args: [100], expected: 5050 },
        { args: [0], expected: 0 },
        { args: [1000000], expected: 500000500000, hidden: true },
        { argsExpr: "[10**12]", expectedExpr: "500000000000500000000000", label: "suma_gigante(10**12)", hidden: true },
        { argsExpr: "[10**15 + 7]", expectedExpr: "(10**15 + 7) * (10**15 + 8) // 2", label: "suma_gigante(10**15 + 7)", hidden: true },
      ],
      hints: [
        "La misma pregunta de antes —sumar de 1 a n— con un límite de tiempo que ningún for alcanza.",
        "Escribe 1 + 2 + … + 10 y debajo 10 + 9 + … + 1. Suma por columnas: cada columna da 11 y hay 10 columnas. Eso es el DOBLE de lo que buscas.",
        "Hay una fórmula que no depende de cuántos números haya: O(1). Para no salirte de los enteros, divide con //, no con / (con / los números enormes se vuelven decimales y pierden precisión).",
        "Devolver n × (n + 1) // 2.",
      ],
      solution: `def suma_gigante(n):
    return n * (n + 1) // 2`,
      complexity: { time: "O(1)", space: "O(1)", why: "Tres operaciones, sea n 3 o un billón." },
    },
  },
  {
    id: "c-ganancia",
    unit: "complejidad",
    kind: "guiado",
    title: "Comprar y vender una vez",
    summary: "De probar todos los pares a una sola pasada.",
    problem: {
      fn: "mejor_ganancia",
      signature: "def mejor_ganancia(precios):",
      statement: [
        "`precios[i]` es el precio de una acción el día `i`. Puedes comprar UN día y vender un día POSTERIOR.",
        "Devuelve la mayor ganancia posible. Si no hay forma de ganar (el precio solo baja), devuelve 0.",
        "Hay casos con 100.000 días y 1,5 segundos.",
      ],
      timeLimitMs: 1500,
      cases: [
        { args: [[7, 1, 5, 3, 6, 4]], expected: 5 },
        { args: [[7, 6, 4, 3, 1]], expected: 0 },
        { args: [[2, 4]], expected: 2 },
        { args: [[]], expected: 0, hidden: true },
        { args: [[5]], expected: 0, hidden: true },
        { args: [[3, 3, 3]], expected: 0, hidden: true },
        { args: [[1, 2, 3, 4, 5]], expected: 4, hidden: true },
        { args: [[2, 1, 2, 1, 0, 1, 2]], expected: 2, hidden: true },
        { argsExpr: "[list(range(100000, 0, -1))]", expected: 0, label: "100.000 días en que solo baja", hidden: true },
        {
          argsExpr: "[[(i * 7919) % 100003 for i in range(100000)]]",
          expected: 100002,
          label: "100.000 días de precios revueltos",
          hidden: true,
        },
      ],
      hints: [
        "Eliges un día para comprar y un día POSTERIOR para vender. Devuelves la mayor ganancia; si siempre baja, 0.",
        "[7, 1, 5, 3, 6, 4]: lo mejor es comprar a 1 (día 1) y vender a 6 (día 4) → 5. No sirve vender a 7: ese día va antes de comprar.",
        "Probar todos los pares es O(n²) y no pasa los casos grandes. Recorre UNA vez llevando dos cosas: el precio más bajo visto hasta hoy y la mejor ganancia hasta hoy. Es el «mejor hasta ahora» de «El mayor», con dos variables.",
        "mas_bajo = infinito; mejor = 0; para cada precio: mas_bajo = el menor entre mas_bajo y precio; mejor = el mayor entre mejor y (precio − mas_bajo); devolver mejor.",
      ],
      solution: `def mejor_ganancia(precios):
    mas_bajo = float("inf")
    mejor = 0
    for p in precios:
        mas_bajo = min(mas_bajo, p)
        mejor = max(mejor, p - mas_bajo)
    return mejor`,
      complexity: { time: "O(n)", space: "O(1)", why: "Una pasada, dos variables." },
    },
  },
  {
    id: "c-ventana",
    unit: "complejidad",
    kind: "prueba",
    title: "Los k días seguidos",
    summary: "La prueba de la unidad: reusar la cuenta anterior.",
    problem: {
      fn: "mejor_suma_k",
      signature: "def mejor_suma_k(numeros, k):",
      statement: [
        "Devuelve la mayor suma de `k` números **seguidos** de la lista. Siempre se cumple 1 ≤ k ≤ len(numeros).",
        "Ejemplo: en `[1, 4, 2, 10, 2, 3, 1, 0, 20]` con `k = 4`, el mejor bloque es `3, 1, 0, 20` y suma 24.",
        "Hay casos con 100.000 números y k de miles.",
      ],
      timeLimitMs: 1500,
      cases: [
        { args: [[1, 4, 2, 10, 2, 3, 1, 0, 20], 4], expected: 24 },
        { args: [[5], 1], expected: 5 },
        { args: [[-1, -2, -3], 2], expected: -3 },
        { args: [[2, 1, 5, 1, 3, 2], 3], expected: 9, hidden: true },
        { args: [[1, 1, 1, 1], 4], expected: 4, hidden: true },
        { args: [[-5, 4, -1, 7], 1], expected: 7, hidden: true },
        { argsExpr: "[list(range(100000)), 50000]", expected: 3749975000, label: "100.000 números, k = 50.000", hidden: true },
        {
          argsExpr: "[[(i * 37) % 1001 - 500 for i in range(100000)], 1000]",
          expected: 500,
          label: "100.000 números con negativos, k = 1.000",
          hidden: true,
        },
      ],
      hints: [
        "Buscas el bloque de k números SEGUIDOS cuya suma es la más grande, y devuelves esa suma.",
        "k = 4 en [1, 4, 2, 10, 2, 3, 1, 0, 20]: 1+4+2+10 = 17, 4+2+10+2 = 18, … hasta 3+1+0+20 = 24. Mira dos bloques vecinos: comparten casi todo.",
        "Ventana deslizante: al mover el bloque un paso a la derecha, la suma nueva es la vieja MENOS el número que sale por la izquierda MÁS el que entra por la derecha. Volver a sumar los k números cada vez es O(n·k).",
        "suma = suma de los primeros k; mejor = suma; para i de k a n−1: suma += numeros[i] − numeros[i−k]; mejor = el mayor entre mejor y suma; devolver mejor.",
      ],
      solution: `def mejor_suma_k(numeros, k):
    suma = sum(numeros[:k])
    mejor = suma
    for i in range(k, len(numeros)):
        suma += numeros[i] - numeros[i - k]
        mejor = max(mejor, suma)
    return mejor`,
      complexity: { time: "O(n)", space: "O(1)", why: "Cada número entra y sale de la ventana una sola vez." },
    },
  },
];

// ── Unidad 3 · Hash map ────────────────────────────────────────────────

const HASHMAP: DojoItem[] = [
  {
    id: "h-dicts",
    unit: "hashmap",
    kind: "concepto",
    title: "Diccionarios",
    summary: "Clave → valor, y el patrón de contar.",
    blocks: [
      {
        kind: "text",
        text: "Un **diccionario** guarda pares **clave → valor**. No buscas por posición sino por la clave, como en un directorio.",
      },
      {
        kind: "code",
        code: `precios = {"café": 4500, "arepa": 3000}
print(precios["café"])
precios["empanada"] = 2500
print(precios)
print("arepa" in precios)
print(precios.get("buñuelo", 0))`,
      },
      {
        kind: "text",
        text: "`dic[clave]` con una clave que no existe da `KeyError`; `dic.get(clave, defecto)` devuelve el defecto en vez de romperse. Para recorrer: `for clave in dic`, o las dos cosas con `for clave, valor in dic.items()`.",
      },
      {
        kind: "code",
        code: `precios = {"café": 4500, "arepa": 3000}
for comida, precio in precios.items():
    print(comida, "cuesta", precio)`,
      },
      {
        kind: "text",
        text: "El uso estrella: **contar**. Recorres algo y por cada elemento sumas 1 en su clave, empezando en 0 si no estaba.",
      },
      {
        kind: "code",
        code: `conteo = {}
for letra in "banana":
    conteo[letra] = conteo.get(letra, 0) + 1
print(conteo)`,
      },
      {
        kind: "check",
        question: "¿Qué imprime?",
        code: `d = {"a": 1}
d["a"] = d["a"] + 5
d["b"] = 2
print(len(d), d["a"])`,
        answer: "2 6",
        why: "Hay dos claves (a y b) y a pasó de 1 a 6.",
      },
      {
        kind: "check",
        question: "Con `d = {}`, ¿qué pasa al hacer `d[\"x\"] += 1`?",
        answer: "KeyError",
        why: "+= primero LEE d[\"x\"], y esa clave no existe. Por eso se escribe d[\"x\"] = d.get(\"x\", 0) + 1.",
      },
    ],
  },
  {
    id: "h-sets",
    unit: "hashmap",
    kind: "concepto",
    title: "Sets y por qué buscar es O(1)",
    summary: "Cambiar memoria por tiempo.",
    blocks: [
      {
        kind: "text",
        text: "Un **set** es una colección sin repetidos y sin orden. Su súper poder: preguntar `x in conjunto` cuesta O(1) en promedio, tenga 10 o un millón de elementos. En una lista, la misma pregunta la recorre: O(n). Las claves de un diccionario usan el mismo mecanismo (una tabla hash), así que `clave in dic` también es O(1).",
      },
      {
        kind: "code",
        code: `vistos = set()
for x in [3, 1, 3, 2, 1]:
    vistos.add(x)
print(vistos)
print(2 in vistos, 9 in vistos)
print(len(set("mississippi")))`,
      },
      {
        kind: "code",
        code: `import time

n = 5_000
lista = list(range(n))
conjunto = set(lista)

t0 = time.perf_counter()
for x in range(n):
    x in lista
print(f"buscando en la lista: {(time.perf_counter() - t0) * 1000:.0f} ms")

t0 = time.perf_counter()
for x in range(n):
    x in conjunto
print(f"buscando en el set:   {(time.perf_counter() - t0) * 1000:.0f} ms")`,
        note: "Las mismas 5.000 preguntas. Prueba con n = 10_000: la lista tarda cuatro veces más, el set casi igual.",
      },
      {
        kind: "text",
        text: "La idea que vas a usar en todos los problemas de esta unidad: cambiar una búsqueda O(n) que se repite por una búsqueda O(1) en un set o un dict. Pagas memoria extra (O(n)) para ganar tiempo.",
      },
      {
        kind: "check",
        question: "Tienes que preguntar 100.000 veces si un número está en una colección de 100.000. ¿Qué usas?",
        answer: "set",
        accept: ["un set", "Un set", "conjunto", "un conjunto", "set()"],
        why: "Con lista son 100.000 × 100.000 pasos en el peor caso; con set, 100.000.",
      },
      {
        kind: "check",
        question: "¿Qué imprime?",
        code: `s = {1, 2, 2, 3}
s.add(3)
print(len(s))`,
        answer: "3",
        why: "Un set no guarda repetidos: queda {1, 2, 3}.",
      },
    ],
  },
  {
    id: "h-contar-palabras",
    unit: "hashmap",
    kind: "guiado",
    title: "Contar palabras",
    summary: "El patrón de contar con un dict.",
    problem: {
      fn: "contar_palabras",
      signature: "def contar_palabras(texto):",
      statement: [
        "Devuelve un diccionario donde cada palabra de `texto` apunta a cuántas veces aparece.",
        "Las palabras van separadas por espacios (puede haber varios seguidos) y se cuentan en minúsculas: `\"Café\"` y `\"café\"` son la misma.",
      ],
      cases: [
        { args: ["hola mundo hola"], expected: { hola: 2, mundo: 1 } },
        { args: [""], expected: {} },
        { args: ["Café café CAFÉ"], expected: { café: 3 } },
        { args: ["a b c"], expected: { a: 1, b: 1, c: 1 }, hidden: true },
        { args: ["  espacios   de   más  "], expected: { espacios: 1, de: 1, más: 1 }, hidden: true },
      ],
      hints: [
        "Devuelves un diccionario: cada palabra (en minúsculas) apunta a cuántas veces aparece.",
        "«hola mundo hola» → palabras: hola, mundo, hola → {\"hola\": 2, \"mundo\": 1}.",
        "Es el patrón de contar de la lección de diccionarios: un dict vacío y get(clave, 0) + 1. Para partir en palabras, split() sin argumentos ya ignora los espacios de más.",
        "conteo = {}; para cada palabra del texto en minúsculas partido en palabras: conteo[palabra] = conteo.get(palabra, 0) + 1; devolver conteo.",
      ],
      solution: `def contar_palabras(texto):
    conteo = {}
    for palabra in texto.lower().split():
        conteo[palabra] = conteo.get(palabra, 0) + 1
    return conteo`,
      complexity: { time: "O(n)", space: "O(n)", why: "Una pasada por el texto; el dict guarda a lo sumo una entrada por palabra." },
    },
  },
  {
    id: "h-repetidos",
    unit: "hashmap",
    kind: "guiado",
    title: "¿Hay repetidos?",
    summary: "Un set para recordar lo que ya viste.",
    problem: {
      fn: "hay_repetidos",
      signature: "def hay_repetidos(numeros):",
      statement: [
        "Devuelve `True` si algún número aparece dos o más veces en la lista, y `False` si todos son distintos.",
        "Hay casos con 100.000 números y 1,5 segundos.",
      ],
      timeLimitMs: 1500,
      cases: [
        { args: [[1, 2, 3, 1]], expected: true },
        { args: [[1, 2, 3, 4]], expected: false },
        { args: [[]], expected: false },
        { args: [[5, 5]], expected: true, hidden: true },
        { args: [[1]], expected: false, hidden: true },
        { argsExpr: "[list(range(100000))]", expected: false, label: "100.000 números distintos", hidden: true },
        { argsExpr: "[list(range(100000)) + [99999]]", expected: true, label: "100.000 números y el último repetido", hidden: true },
      ],
      hints: [
        "True si algún número aparece dos o más veces; False si todos son distintos.",
        "[1, 2, 3, 1]: vas anotando lo que ves — 1, 2, 3 — y cuando llega otro 1 ya lo tenías anotado → True.",
        "Lo que «anotas» es un set: preguntar si algo ya está ahí es O(1). Comparar cada número con todos los demás es O(n²) y no pasa el caso de 100.000.",
        "vistos = set vacío; para cada x: si x está en vistos → devolver True; agregar x a vistos. Al terminar el for, devolver False.",
      ],
      solution: `def hay_repetidos(numeros):
    vistos = set()
    for x in numeros:
        if x in vistos:
            return True
        vistos.add(x)
    return False`,
      complexity: { time: "O(n)", space: "O(n)", why: "Cada número se busca y se guarda una vez en el set." },
    },
  },
  {
    id: "h-anagramas",
    unit: "hashmap",
    kind: "guiado",
    title: "¿Son anagramas?",
    summary: "Comparar conteos en vez de palabras.",
    problem: {
      fn: "son_anagramas",
      signature: "def son_anagramas(a, b):",
      statement: [
        "Dos palabras son anagramas si usan exactamente las mismas letras, la misma cantidad de veces, en cualquier orden: `\"roma\"` y `\"amor\"`.",
        "Devuelve `True` si `a` y `b` lo son. Llegan en minúsculas y sin espacios.",
      ],
      timeLimitMs: 1500,
      cases: [
        { args: ["roma", "amor"], expected: true },
        { args: ["hola", "halo"], expected: true },
        { args: ["perro", "pero"], expected: false },
        { args: ["", ""], expected: true, hidden: true },
        { args: ["a", "b"], expected: false, hidden: true },
        { args: ["aab", "abb"], expected: false, hidden: true },
        { args: ["listen", "silent"], expected: true, hidden: true },
        { argsExpr: '["ab" * 50000, "ba" * 50000]', expected: true, label: "dos palabras de 100.000 letras", hidden: true },
      ],
      hints: [
        "anagramas = mismas letras, misma cantidad de veces, en cualquier orden.",
        "«roma» y «amor»: r1 o1 m1 a1 en las dos → True. «perro» y «pero»: la primera tiene dos r → False.",
        "Cuenta las letras de cada palabra con un dict (como en Contar palabras) y compara los dos dicts: Python compara diccionarios con ==. Si los largos son distintos, ya sabes la respuesta sin contar.",
        "Si los largos son distintos → False; contar las letras de a; contar las letras de b; devolver conteo_a == conteo_b.",
      ],
      solution: `def son_anagramas(a, b):
    if len(a) != len(b):
        return False
    conteo_a = {}
    conteo_b = {}
    for letra in a:
        conteo_a[letra] = conteo_a.get(letra, 0) + 1
    for letra in b:
        conteo_b[letra] = conteo_b.get(letra, 0) + 1
    return conteo_a == conteo_b`,
      complexity: {
        time: "O(n)",
        space: "O(1)",
        why: "Una pasada por cada palabra. El dict tiene a lo sumo una entrada por letra del alfabeto, que no crece con n.",
      },
    },
  },
  {
    id: "h-primera-unica",
    unit: "hashmap",
    kind: "guiado",
    title: "Primera letra que no se repite",
    summary: "Dos pasadas: contar y después buscar.",
    problem: {
      fn: "primera_unica",
      signature: "def primera_unica(texto):",
      statement: [
        "Devuelve la **posición** de la primera letra (de izquierda a derecha) que aparece una sola vez en todo `texto`. Si no hay ninguna, devuelve `-1`.",
        "En `\"lulo\"` la l sale dos veces y la u una: la respuesta es 1.",
      ],
      timeLimitMs: 1500,
      cases: [
        { args: ["lulo"], expected: 1 },
        { args: ["aabb"], expected: -1 },
        { args: ["hermes"], expected: 0 },
        { args: [""], expected: -1, hidden: true },
        { args: ["z"], expected: 0, hidden: true },
        { args: ["abcabcd"], expected: 6, hidden: true },
        { args: ["mississippi"], expected: 0, hidden: true },
        { argsExpr: '["ab" * 50000 + "c"]', expected: 100000, label: "100.001 letras, la única al final", hidden: true },
      ],
      hints: [
        "Buscas la PRIMERA letra que aparece una sola vez en todo el texto y devuelves su posición; si no hay, -1.",
        "«lulo»: la l sale 2 veces, la u 1 vez → posición 1. La o también sale una vez, pero la u va primero.",
        "Dos pasadas: la primera cuenta cuántas veces sale cada letra (dict); la segunda recorre el texto en orden y devuelve la primera posición cuya cuenta es 1. Usar texto.count(letra) dentro del for es O(n²).",
        "conteo = contar las letras; para i de 0 a len−1: si conteo[texto[i]] == 1 → devolver i. Al terminar, devolver −1.",
      ],
      solution: `def primera_unica(texto):
    conteo = {}
    for letra in texto:
        conteo[letra] = conteo.get(letra, 0) + 1
    for i, letra in enumerate(texto):
        if conteo[letra] == 1:
            return i
    return -1`,
      complexity: { time: "O(n)", space: "O(1)", why: "Dos pasadas por el texto; el dict tiene como mucho una entrada por letra distinta." },
    },
  },
  {
    id: "h-dos-suma",
    unit: "hashmap",
    kind: "solo",
    title: "Dos que suman",
    summary: "Sin pistas: lo que falta, ¿ya lo viste?",
    problem: {
      fn: "dos_suma",
      signature: "def dos_suma(numeros, objetivo):",
      statement: [
        "Devuelve las posiciones `[i, j]` de los dos números de la lista que suman `objetivo`.",
        "Siempre hay exactamente una respuesta y no puedes usar el mismo elemento dos veces. El orden de las dos posiciones no importa.",
        "Hay casos con 100.000 números y 1,5 segundos.",
      ],
      compare: "unordered",
      timeLimitMs: 1500,
      cases: [
        { args: [[2, 7, 11, 15], 9], expected: [0, 1] },
        { args: [[3, 2, 4], 6], expected: [1, 2] },
        { args: [[3, 3], 6], expected: [0, 1] },
        { args: [[1, 5, 9, -2], 7], expected: [2, 3], hidden: true },
        { args: [[0, 4, 3, 0], 0], expected: [0, 3], hidden: true },
        { argsExpr: "[list(range(100000)), 199997]", expected: [99998, 99999], label: "100.000 números", hidden: true },
      ],
      hints: [
        "Encuentra las posiciones de los DOS números que suman el objetivo. Hay una sola respuesta y no vale usar el mismo elemento dos veces.",
        "[2, 7, 11, 15] y 9: al llegar al 7 te preguntas «¿ya vi un 2?» (porque 9 − 7 = 2). Sí, en la posición 0 → [0, 1].",
        "Un dict de valor → posición. Para cada número calculas lo que le falta (objetivo − número) y preguntas si ya lo viste. Pregunta ANTES de guardar el número actual: así [3, 3] con 6 no usa el mismo 3 dos veces.",
        "posiciones = {}; para i, x en enumerate(numeros): falta = objetivo − x; si falta está en posiciones → devolver [posiciones[falta], i]; posiciones[x] = i.",
      ],
      solution: `def dos_suma(numeros, objetivo):
    posiciones = {}
    for i, x in enumerate(numeros):
        falta = objetivo - x
        if falta in posiciones:
            return [posiciones[falta], i]
        posiciones[x] = i`,
      complexity: { time: "O(n)", space: "O(n)", why: "Una pasada; cada búsqueda en el dict es O(1) y se guardan hasta n posiciones." },
    },
  },
  {
    id: "h-agrupar",
    unit: "hashmap",
    kind: "prueba",
    title: "Agrupar anagramas",
    summary: "La prueba de la unidad: inventar la clave correcta.",
    problem: {
      fn: "agrupar_anagramas",
      signature: "def agrupar_anagramas(palabras):",
      statement: [
        "Junta en un mismo grupo las palabras que son anagramas entre sí y devuelve la lista de grupos.",
        "El orden de los grupos no importa, ni el orden dentro de cada grupo.",
        "Ejemplo: `[\"amor\", \"roma\", \"sol\", \"mora\", \"los\", \"luz\"]` → `[[\"amor\", \"roma\", \"mora\"], [\"sol\", \"los\"], [\"luz\"]]`.",
        "Hay un caso con 20.000 palabras y 3 segundos.",
      ],
      compare: "groups",
      timeLimitMs: 3000,
      cases: [
        {
          args: [["amor", "roma", "sol", "mora", "los", "luz"]],
          expected: [["amor", "roma", "mora"], ["sol", "los"], ["luz"]],
        },
        { args: [[]], expected: [] },
        { args: [["a"]], expected: [["a"]] },
        { args: [["", ""]], expected: [["", ""]], hidden: true },
        { args: [["abc", "bca", "cab", "xyz"]], expected: [["abc", "bca", "cab"], ["xyz"]], hidden: true },
        {
          argsExpr:
            '[[("abcdefghij"[i % 10:] + "abcdefghij"[:i % 10]) + "z" * (i // 10 // 100) + "y" * (i // 10 % 100) for i in range(20000)]]',
          expectedExpr:
            '[[("abcdefghij"[r:] + "abcdefghij"[:r]) + "z" * (g // 100) + "y" * (g % 100) for r in range(10)] for g in range(2000)]',
          label: "20.000 palabras en 2.000 grupos",
          hidden: true,
        },
      ],
      hints: [
        "Agrupa las palabras que son anagramas entre sí. Ni el orden de los grupos ni el de adentro importan.",
        "«amor», «roma» y «mora» tienen las mismas letras: si ordenas las letras de cada una, las tres dan «amor». «sol» y «los» dan «los».",
        "Hace falta una «firma» igual para todas las palabras de un grupo y distinta entre grupos: sus letras ordenadas. Un dict de firma → lista de palabras. \"\".join(sorted(palabra)) arma esa firma.",
        "grupos = {}; para cada palabra: firma = sus letras ordenadas; agregar la palabra a grupos[firma] (creando la lista si no existe); devolver la lista de valores de grupos.",
      ],
      solution: `def agrupar_anagramas(palabras):
    grupos = {}
    for palabra in palabras:
        firma = "".join(sorted(palabra))
        grupos.setdefault(firma, []).append(palabra)
    return list(grupos.values())`,
      complexity: {
        time: "O(n log n)",
        space: "O(n)",
        why: "Ordenar las letras de cada palabra cuesta k log k (k = largo de la palabra), una vez por palabra: con palabras cortas, crece casi lineal con el número de palabras.",
      },
    },
  },
];

// ── Jefes nuevos (uno por capítulo que no tenía prueba) ────────────────

const JEFES: DojoItem[] = [
  {
    id: "f-segundos",
    unit: "taller",
    kind: "prueba",
    title: "El cronómetro del taller",
    summary: "El jefe del taller: una función con dos entradas.",
    problem: {
      fn: "segundos",
      signature: "def segundos(horas, minutos):",
      statement: [
        "El cronómetro del taller solo entiende segundos. Recibes `horas` y `minutos` y **devuelves** cuántos segundos son en total.",
        "Una hora tiene 3600 segundos y un minuto, 60.",
      ],
      cases: [
        { args: [1, 0], expected: 3600 },
        { args: [0, 1], expected: 60 },
        { args: [2, 30], expected: 9000 },
        { args: [0, 0], expected: 0, hidden: true },
        { args: [10, 5], expected: 36300, hidden: true },
        { args: [24, 0], expected: 86400, hidden: true },
      ],
      hints: [
        "Te dan dos números: horas y minutos. Devuelves un solo número: el total en segundos.",
        "2 horas y 30 minutos: 2 × 3600 = 7200, más 30 × 60 = 1800, total 9000.",
        "Una función puede recibir varios parámetros separados por coma y combinarlos en una sola cuenta antes del return.",
        "Pseudocódigo: devolver horas × 3600 + minutos × 60.",
      ],
      solution: `def segundos(horas, minutos):
    return horas * 3600 + minutos * 60`,
      complexity: { time: "O(1)", space: "O(1)", why: "Dos multiplicaciones y una suma, sin importar los números." },
    },
  },
  {
    id: "f-bisiesto",
    unit: "clasificadora",
    kind: "prueba",
    title: "¿Año bisiesto?",
    summary: "El jefe de la clasificadora: condiciones que se combinan.",
    problem: {
      fn: "es_bisiesto",
      signature: "def es_bisiesto(año):",
      statement: [
        "Devuelve `True` si `año` es bisiesto y `False` si no.",
        "La regla: es bisiesto si es múltiplo de 4, **salvo** los años de siglo (múltiplos de 100), que solo lo son si además son múltiplos de 400. Por eso 2000 fue bisiesto y 1900 no.",
      ],
      cases: [
        { args: [2024], expected: true },
        { args: [2023], expected: false },
        { args: [1900], expected: false },
        { args: [2000], expected: true },
        { args: [2100], expected: false, hidden: true },
        { args: [2400], expected: true, hidden: true },
        { args: [4], expected: true, hidden: true },
        { args: [1], expected: false, hidden: true },
      ],
      hints: [
        "Devuelves True o False según tres reglas: múltiplo de 4, de 100 y de 400.",
        "2024: múltiplo de 4 y no de 100 → True. 1900: de 4 y de 100, pero no de 400 → False. 2000: de 400 → True.",
        "Combina condiciones con and / or, o usa if/elif/else empezando por la regla más específica (400), luego 100, luego 4.",
        "Pseudocódigo: si es múltiplo de 400 → True; si no, si es múltiplo de 100 → False; si no, devolver si es múltiplo de 4.",
      ],
      solution: `def es_bisiesto(año):
    if año % 400 == 0:
        return True
    elif año % 100 == 0:
        return False
    else:
        return año % 4 == 0`,
      complexity: { time: "O(1)", space: "O(1)", why: "Como mucho tres divisiones." },
    },
  },
  {
    id: "f-invertir-palabras",
    unit: "imprenta",
    kind: "prueba",
    title: "Palabras al revés",
    summary: "El jefe de la imprenta: partir, dar vuelta y volver a unir.",
    problem: {
      fn: "invertir_palabras",
      signature: "def invertir_palabras(frase):",
      statement: [
        "Devuelve la frase con las palabras en orden inverso: `\"hola mundo\"` → `\"mundo hola\"`. Las letras de cada palabra no cambian.",
        "Las palabras quedan separadas por un solo espacio, aunque la frase traiga varios. Para unir una lista de textos con espacios: `\" \".join(lista)`.",
      ],
      cases: [
        { args: ["hola mundo"], expected: "mundo hola" },
        { args: ["uno dos tres"], expected: "tres dos uno" },
        { args: ["Python"], expected: "Python" },
        { args: [""], expected: "", hidden: true },
        { args: ["  mucho   espacio  "], expected: "espacio mucho", hidden: true },
        { args: ["a b c d"], expected: "d c b a", hidden: true },
      ],
      hints: [
        "Las palabras cambian de orden, no las letras: la última palabra pasa a ser la primera.",
        "«uno dos tres» → palabras [uno, dos, tres] → al revés [tres, dos, uno] → «tres dos uno».",
        "Tres pasos que ya conoces: partir en palabras (split), dar vuelta la lista (una rebanada) y unir con espacios.",
        "Pseudocódigo: palabras = frase partida; devolver las palabras al revés unidas con un espacio.",
      ],
      solution: `def invertir_palabras(frase):
    palabras = frase.split()
    return " ".join(palabras[::-1])`,
      complexity: { time: "O(n)", space: "O(n)", why: "Partir, invertir y unir recorren la frase una vez cada uno." },
    },
  },
];

// ── El mundo: seis lugares, uno por idea ───────────────────────────────
//
// La ruta es un mapa estilo Duolingo: cada capítulo es un LUGAR con su máquina
// (la de components/dojo/figures), su historia de dos frases, un cofre a mitad
// de camino y un jefe al final (la prueba). Los ids de las lecciones no
// cambian al reordenar, así los intentos guardados siguen valiendo.

const BY_ID = new Map([...FUNDAMENTOS, ...COMPLEJIDAD, ...HASHMAP, ...JEFES].map((i) => [i.id, i]));

function chapter(meta: Omit<DojoUnit, "items">, ids: string[]): DojoUnit {
  return {
    ...meta,
    items: ids.map((id) => {
      const item = BY_ID.get(id);
      if (!item) throw new Error(`dojo-catalog: no existe la lección ${id}`);
      return { ...item, unit: meta.key };
    }),
  };
}

export const DOJO_UNITS: DojoUnit[] = [
  chapter(
    {
      key: "taller",
      title: "El taller",
      subtitle: "Funciones: lo que entra y lo que sale",
      story: [
        "Aquí empieza todo: un banco de trabajo con una prensa vieja que convierte lo que le das en otra cosa.",
        "Vas a construir tus propias funciones: lo que entra, lo que sale y el return que entrega el resultado.",
      ],
      chestAfter: 2,
    },
    ["f-funciones", "f-doble", "f-saludo", "f-segundos"],
  ),
  chapter(
    {
      key: "clasificadora",
      title: "La clasificadora",
      subtitle: "Decidir con if, elif y else",
      story: [
        "Por un canal ruedan fichas y cada una tiene que caer en su cajón.",
        "Tú pones las compuertas: la primera condición que se cumple gana y las demás ni se miran.",
      ],
      chestAfter: 2,
    },
    ["f-decidir", "f-es-par", "f-etapa", "f-bisiesto"],
  ),
  chapter(
    {
      key: "fabrica",
      title: "La fábrica",
      subtitle: "Bucles y el acumulador",
      story: [
        "Las cintas no paran: cada ficha pasa una vez por el lector y algo se cuenta, se suma o se guarda.",
        "Aquí nace el bucle, y con él su mejor amigo: la variable que va acumulando.",
      ],
      chestAfter: 3,
    },
    ["f-repetir", "f-suma-hasta", "f-contar-pares", "f-mayor", "f-fizzbuzz"],
  ),
  chapter(
    {
      key: "imprenta",
      title: "La imprenta",
      subtitle: "Listas y textos",
      story: [
        "Letras de plomo en un componedor, cada una en su casilla numerada desde el 0.",
        "Aprende a leerlas, cortarlas, contarlas y darles la vuelta sin perder ninguna.",
      ],
      chestAfter: 3,
    },
    ["f-listas", "f-textos", "f-vocales", "f-palindromo", "f-invertir-palabras"],
  ),
  chapter(
    {
      key: "pista",
      title: "La pista de carreras",
      subtitle: "Complejidad: contar pasos",
      story: [
        "Dos soluciones correctas pueden llegar a la meta con horas de diferencia.",
        "Aquí cuentas pasos, ves crecer a n y aprendes a recorrer el camino una sola vez.",
      ],
      chestAfter: 3,
    },
    ["c-pasos", "c-crece", "c-suma-gigante", "c-ganancia", "c-ventana"],
  ),
  chapter(
    {
      key: "bodega",
      title: "La bodega",
      subtitle: "Hash map: diccionarios y sets",
      story: [
        "Una pared de casilleros donde cada cosa tiene su lugar y se encuentra al instante, sin buscar.",
        "Diccionarios y sets: pagar un poco de memoria para no recorrer nada dos veces.",
      ],
      chestAfter: 4,
    },
    ["h-dicts", "h-sets", "h-contar-palabras", "h-repetidos", "h-anagramas", "h-primera-unica", "h-dos-suma", "h-agrupar"],
  ),
];

export const DOJO_ITEMS: DojoItem[] = DOJO_UNITS.flatMap((u) => u.items);

export function dojoItem(id: string): DojoItem | undefined {
  return DOJO_ITEMS.find((i) => i.id === id);
}

export function dojoUnit(key: string): DojoUnit | undefined {
  return DOJO_UNITS.find((u) => u.key === key);
}
