# Proyecto Tarraconensis (V2)
Migración de FrontPage a Astro.
Repositorio privado en desarrollo.

-----------------------------------------------------

**CÓMO VER LA WEB EN TU ORDENADOR PASO A PASO**

**1. Instalar los motores necesarios (Solo la primera vez)**
* Descarga e instala **Node.js** (el motor de la web): Ve a [nodejs.org](https://nodejs.org) y descarga la versión que pone "LTS". Instálalo dándole a "Siguiente" a todo.
* Descarga e instala **Git** (el conector con GitHub): Ve a [git-scm.com/download/win](https://git-scm.com/download/win). Instálalo dándole a "Siguiente" a absolutamente todas las pantallas.
* *Opcional:* Si quieres ver el código, descárgate el editor VS Code (code.visualstudio.com).

**2. Descargar el proyecto (Clonar en tu Escritorio)**
* Abre la lupa de Windows, escribe `cmd` y abre el "Símbolo del sistema" (una pantalla negra).
* Primero, vamos a decirle que trabaje en tu escritorio. Escribe esto y pulsa Enter:
  `cd Desktop`
* Ahora copia este comando, pégalo en la pantalla negra y pulsa Enter:
  `git clone https://github.com/TheWaltrex/tarraconensis-astro.git`
* *Nota:* Te saltará una ventana pidiendo que inicies sesión en GitHub para demostrar que tienes acceso. Inicia sesión. Al terminar, verás que ha aparecido una nueva carpeta llamada `tarraconensis-astro` en tu escritorio.

**3. Arrancar la web**
En esa misma pantalla negra, lanza estos tres comandos (pulsando Enter después de cada uno):
1. `cd tarraconensis-astro` *(Para entrar a la carpeta que acabamos de crear)*
2. `npm install` *(Para descargar las piezas de la web, puede tardar un poco)*
3. `npm run dev` *(Para encender el motor de la web)*

**4. Ver la web**
Cuando el texto se detenga, te dirá que la web está lista. Abre tu navegador de internet (Chrome, Edge...) y entra en esta dirección: **`http://localhost:4321`**. ¡Ahí la tienes!