/**
 * migrador.cjs
 * =============
 * Script de migración: convierte los archivos .html del directorio
 * `_legacy_frontpage` en componentes .astro dentro de `src/pages`,
 * envolviéndolos en el Layout existente y limpiando el código heredado.
 *
 * Uso:
 *   node migrador.cjs [--dry-run] [--file nombre.html]
 *
 * Flags:
 *   --dry-run   Simula la migración sin escribir ficheros (útil para revisar).
 *   --file      Migra solo un fichero concreto (ej: --file acueductosromanos.html)
 *
 * Dependencias (instalar antes de ejecutar):
 *   npm install cheerio iconv-lite
 *
 * Características:
 *
 *  1. RECURSIVO: escanea todos los subdirectorios de `_legacy_frontpage` y
 *     recrea la misma estructura de carpetas dentro de `src/pages`.
 *     Ej: `_legacy_frontpage/segovia/foo.html` → `src/pages/segovia/foo.astro`
 *
 *  2. IMAGE MAPS: los tags <map>, <area> y el atributo `usemap` de las
 *     imágenes se preservan intactos. No se eliminan durante la limpieza.
 *
 *  3. ENLACES INTERNOS: los href que apunten a ficheros .html/.htm locales
 *     se reescriben al estilo de rutas Astro (sin extensión).
 *     Ej: href="hispania.html"          → href="/hispania"
 *         href="segovia/foo.html"       → href="/segovia/foo"
 *         href="../rome.html#anfiteatro" → href="/rome#anfiteatro"
 *
 *  4. IMÁGENES: cada <img> local se copia a `public/images/` manteniendo
 *     la estructura de subcarpetas; su src se reescribe como `/images/...`.
 *     Las imágenes ya existentes en destino NO se sobreescriben (se reusan).
 */

const fs = require("fs");
const path = require("path");

// cheerio: parsea y manipula HTML como si fuera jQuery
// iconv-lite: decodifica los ficheros antiguos en windows-1252
let cheerio, iconv;
try {
  cheerio = require("cheerio");
  iconv = require("iconv-lite");
} catch {
  console.error(
    "\n❌  Faltan dependencias. Instálalas con:\n\n" +
    "    npm install cheerio iconv-lite\n"
  );
  process.exit(1);
}

// ─── Configuración de rutas ───────────────────────────────────────────────────

const ROOT = __dirname;                            // raíz del proyecto
const LEGACY_DIR = path.join(ROOT, "_legacy_frontpage"); // HTML de origen
const PAGES_DIR = path.join(ROOT, "src", "pages");      // destino .astro
const LAYOUT_PATH = "@layouts/Layout.astro";              // alias Astro
const PUBLIC_IMAGES_DIR = path.join(ROOT, "public", "images");  // destino de imágenes copiadas

// ─── Flags de línea de comandos ──────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const fileArg = args.indexOf("--file");
const ONLY_FILE = fileArg !== -1 ? args[fileArg + 1] : null;

// ─── Etiquetas y atributos a eliminar / limpiar ───────────────────────────────

/** Etiquetas de presentación cuyo contenido se conserva (solo se quita la etiqueta). */
const UNWRAP_TAGS = [
  "font", "center", "strike", "s", "u", "big", "small",
  "basefont", "blink", "marquee",
];

/** Etiquetas que se eliminan completas (incluyendo su contenido). */
const REMOVE_ENTIRELY = [
  "script", "style", "meta", "link", "head",
  "iframe", "object", "embed", "applet",
  "noscript", "form", "input", "select", "textarea", "button",
];

/** Atributos de presentación a limpiar de CUALQUIER elemento. */
const REMOVE_ATTRS = [
  "color", "bgcolor", "background", "face", "size",      // <font>, <body>
  "align", "valign", "halign",                            // alineaciones
  "border", "cellpadding", "cellspacing",                 // tablas
  "width", "height",                                      // dimensiones fijas
  "style",                                                // estilos en línea
  "vlink", "link", "alink",                              // colores de enlace
  "text",                                                 // color de texto del body
  "hspace", "vspace",                                     // espaciado antiguo
  "nowrap", "noshade",                                    // otros atributos legacy
];

/**
 * Atributos que NUNCA deben eliminarse, independientemente del elemento.
 * Protege la funcionalidad de image maps y otros elementos semánticos.
 */
const PRESERVE_ATTRS = new Set([
  "usemap",   // <img usemap="#nombre"> — vincula la imagen a su <map>
  "name",     // <map name="nombre">   — identificador del mapa (atributo funcional)
  "coords",   // <area coords="...">   — coordenadas del área clicable
  "shape",    // <area shape="...">    — forma del área (rect, circle, poly)
  "href",     // <area href="...">     — destino del área (se reescribirá en paso 10)
  "alt",      // <area alt="...">      — accesibilidad
]);

// ─── Utilidades ──────────────────────────────────────────────────────────────

/**
 * Lee un fichero respetando su codificación.
 * Intenta detectar windows-1252 por el meta Content-Type;
 * si no lo encuentra, asume UTF-8.
 */
function readLegacyFile(filePath) {
  const raw = fs.readFileSync(filePath);
  // Detección rápida: busca charset en los primeros 512 bytes (ASCII seguro)
  const head = raw.slice(0, 512).toString("ascii").toLowerCase();
  if (head.includes("windows-1252") || head.includes("iso-8859-1")) {
    return iconv.decode(raw, "windows-1252");
  }
  return raw.toString("utf-8");
}

/**
 * Convierte un nombre de fichero HTML en el nombre del fichero .astro.
 * Respeta la estructura de subdirectorios.
 * Ejemplos:
 *   "acueductosromanos.html"                  → "acueductosromanos.astro"
 *   "segovia/segoviacueducto.html"            → "segovia/segoviacueducto.astro"
 *   "index.html"                              → "index.astro"  (¡ojo! no sobreescribe el existente)
 */
function toAstroName(relativePath) {
  return relativePath.replace(/\.(html?|htm)$/i, ".astro");
}

/**
 * Devuelve todos los ficheros .html/.htm del directorio legado (recursivo),
 * como rutas relativas a LEGACY_DIR.
 */
function collectHtmlFiles(dir, base = dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(collectHtmlFiles(fullPath, base));
    } else if (/\.(html?|htm)$/i.test(entry.name)) {
      files.push(path.relative(base, fullPath));
    }
  }
  return files;
}

// ─── Gestión de imágenes ─────────────────────────────────────────────────────

/**
 * Copia una imagen desde el directorio legacy a `public/images/`,
 * preservando la estructura de subcarpetas relativa a LEGACY_DIR.
 *
 * @param {string} srcAttr      - Valor del atributo src tal como aparece en el HTML.
 * @param {string} htmlFileDir  - Directorio absoluto del fichero HTML que contiene la imagen.
 * @returns {string|null}       - La nueva URL pública (/images/...) si tuvo éxito, o null.
 */
function copyImage(srcAttr, htmlFileDir) {
  // Ignorar URLs externas, data URIs y hrefs de protocolo especial
  if (
    /^https?:\/\//i.test(srcAttr) ||
    /^data:/i.test(srcAttr) ||
    /^mailto:/i.test(srcAttr)
  ) {
    return null; // imagen externa: no copiar, no reescribir
  }

  // Decodificar entidades de URL antiguas (ej: "Imagen%20001.JPG" → "Imagen 001.JPG")
  let decodedSrc;
  try {
    decodedSrc = decodeURIComponent(srcAttr);
  } catch {
    decodedSrc = srcAttr;
  }

  // Resolver la ruta absoluta del fichero fuente
  // Los src pueden ser: "foto.jpg", "../carpeta/foto.jpg", "/foto.jpg" (relativo a legacy root)
  let absoluteSrc;
  if (path.isAbsolute(decodedSrc)) {
    // Ruta absoluta de servidor → resolver desde la raíz del directorio legacy
    absoluteSrc = path.join(LEGACY_DIR, decodedSrc);
  } else {
    // Ruta relativa → resolver desde el directorio del HTML actual
    absoluteSrc = path.resolve(htmlFileDir, decodedSrc);
  }

  // Verificar que el fichero fuente existe
  if (!fs.existsSync(absoluteSrc)) {
    return null; // imagen no encontrada en el directorio legacy
  }

  // Calcular la ruta relativa del fichero imagen respecto a LEGACY_DIR
  // Ej: "_legacy_frontpage/segovia/foto.jpg" → "segovia/foto.jpg"
  const relativeToLegacy = path.relative(LEGACY_DIR, absoluteSrc);

  // Construir la ruta de destino dentro de public/images/
  const destAbsPath = path.join(PUBLIC_IMAGES_DIR, relativeToLegacy);

  // Copiar solo si el fichero de destino no existe aún
  if (!fs.existsSync(destAbsPath)) {
    fs.mkdirSync(path.dirname(destAbsPath), { recursive: true });
    fs.copyFileSync(absoluteSrc, destAbsPath);
  }

  // Devolver la URL pública con separadores de ruta estilo POSIX
  const publicUrl = "/images/" + relativeToLegacy.replace(/\\/g, "/");
  return publicUrl;
}

// ─── Núcleo de limpieza HTML ──────────────────────────────────────────────────

/**
 * Toma el HTML en bruto de un fichero legacy y devuelve:
 *   { title: string, cleanHtml: string }
 *
 * Proceso de limpieza:
 *  1. Parsear con cheerio
 *  2. Extraer el <title>
 *  3. Eliminar por completo etiquetas de cabecera/script/estilo
 *  4. "Desenvolver" (unwrap) etiquetas de presentación conservando su contenido
 *  5. Eliminar atributos de presentación
 *  6. Convertir tablas de maquetación en <div>s semánticos
 *  7. Limpiar espacios en blanco múltiples y &nbsp; superfluos
 *  8. Devolver solo el <body> limpio
 */
/**
 * @param {string} rawHtml          - Contenido HTML en bruto del fichero legacy.
 * @param {string} relativeFilePath - Ruta relativa del .html respecto a LEGACY_DIR.
 * @param {string} htmlFileDir      - Directorio absoluto del .html (para resolver imágenes).
 * @param {boolean} dryRun          - Si true, las imágenes no se copian físicamente.
 * @returns {{ title: string, cleanHtml: string, imgStats: {copied:number, skipped:number, missing:number} }}
 */
function cleanLegacyHtml(rawHtml, relativeFilePath, htmlFileDir, dryRun = false) {
  const $ = cheerio.load(rawHtml, {
    decodeEntities: false,
    xml: false,
  });

  // Contadores de imágenes para el resumen de log
  const imgStats = { copied: 0, skipped: 0, missing: 0 };

  // 1. Extraer título
  let title = $("title").text().trim();
  if (!title) {
    // Fallback: usar el nombre del fichero capitalizado
    const base = path.basename(relativeFilePath, path.extname(relativeFilePath));
    title = base.replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  }

  // 2. Eliminar etiquetas completas (incluyendo su contenido)
  REMOVE_ENTIRELY.forEach(tag => $(tag).remove());

  // 3. Eliminar comentarios HTML
  $("*").contents().each(function () {
    if (this.type === "comment") $(this).remove();
  });

  // 4. Eliminar atributos de presentación de todos los elementos
  //    Se respetan los atributos de PRESERVE_ATTRS (usemap, coords, shape, etc.)
  //    para no romper los image maps del sitio legacy.
  $("*").each(function () {
    const el = $(this);
    REMOVE_ATTRS.forEach(attr => {
      if (!PRESERVE_ATTRS.has(attr)) el.removeAttr(attr);
    });
  });

  // 5. "Desenvolver" etiquetas de presentación (conservar contenido, quitar tag)
  //    Se procesa desde los más internos hacia afuera (reverse DFS implícito de cheerio)
  UNWRAP_TAGS.forEach(tag => {
    $(tag).each(function () {
      $(this).replaceWith($(this).contents());
    });
  });

  // 6. Convertir tablas de maquetación en divs semánticos
  //    Heurística: una tabla de maquetación es aquella que NO tiene <th>
  //    (las tablas de datos suelen tener cabeceras).
  $("table").each(function () {
    const table = $(this);
    const hasHeaders = table.find("th").length > 0;
    if (!hasHeaders) {
      // Tabla de maquetación → extraer los contenidos de las celdas
      const wrapper = $("<div>").addClass("migrated-layout");
      table.find("td").each(function () {
        const cell = $(this);
        const cellDiv = $("<div>").addClass("migrated-cell");
        cellDiv.append(cell.contents());
        wrapper.append(cellDiv);
      });
      table.replaceWith(wrapper);
    }
  });

  // 7. Eliminar atributos "align" que pudiera haber quedado tras el unwrap
  $("[align]").removeAttr("align");

  // 8. Limpiar <p> y <div> completamente vacíos o que solo tienen &nbsp;
  $("p, div").each(function () {
    const text = $(this).text().replace(/\u00a0/g, "").trim();
    const hasChildren = $(this).children().length > 0;
    if (!text && !hasChildren) $(this).remove();
  });

  // 9. Copiar imágenes a public/images/ y reescribir src con la URL pública
  $("img").each(function () {
    const rawSrc = $(this).attr("src") || "";
    if (!rawSrc) return;

    // Normalizar primero las URLs absolutas del dominio antiguo a rutas relativas
    const normalizedSrc = rawSrc.replace(
      /^https?:\/\/(?:www\.)?tarraconensis\.com\//i,
      ""
    );

    if (dryRun) {
      // En dry-run solo verificamos si el fichero existiría, sin copiar nada
      let decodedSrc;
      try { decodedSrc = decodeURIComponent(normalizedSrc); } catch { decodedSrc = normalizedSrc; }
      const absoluteSrc = path.isAbsolute(decodedSrc)
        ? path.join(LEGACY_DIR, decodedSrc)
        : path.resolve(htmlFileDir, decodedSrc);
      if (fs.existsSync(absoluteSrc)) {
        imgStats.skipped++; // existiría, no se copia en dry-run
      } else if (!/^https?:\/\//i.test(normalizedSrc) && !/^data:/i.test(normalizedSrc)) {
        imgStats.missing++;
      }
    } else {
      const newUrl = copyImage(normalizedSrc, htmlFileDir);
      if (newUrl) {
        $(this).attr("src", newUrl);
        imgStats.copied++;
      } else if (!/^https?:\/\//i.test(normalizedSrc) && !/^data:/i.test(normalizedSrc)) {
        // Imagen local no encontrada: dejar el src original para no romper nada silenciosamente
        imgStats.missing++;
      }
    }

    // Garantizar atributo alt por accesibilidad
    if (!$(this).attr("alt")) $(this).attr("alt", "");
  });

  // 10. Reescribir enlaces internos .html → rutas Astro sin extensión
  //     Solo afecta a <a href> con rutas locales (no externas, no mailto, no #anchor puro).
  //     Los <area href> del image map se procesan con la misma lógica.
  $("a, area").each(function () {
    const el = $(this);
    const href = el.attr("href") || "";

    // Ignorar: vacíos, externos, mailto, tel, javascript, anclas puras
    if (
      !href ||
      /^https?:\/\//i.test(href) ||
      /^(mailto:|tel:|javascript:)/i.test(href) ||
      href.startsWith("#")
    ) return;

    // Separar el fragmento de ancla (#section) si lo hubiera
    const hashIndex = href.indexOf("#");
    const fragment = hashIndex !== -1 ? href.slice(hashIndex) : "";
    const hrefPath = hashIndex !== -1 ? href.slice(0, hashIndex) : href;

    // Solo actuar si la ruta apunta a un .html / .htm
    if (!/\.(html?|htm)$/i.test(hrefPath)) return;

    // Quitar la extensión
    const withoutExt = hrefPath.replace(/\.(html?|htm)$/i, "");

    let newHref;
    if (path.isAbsolute(withoutExt) || withoutExt.startsWith("/")) {
      // Ya era absoluta (raro en el legacy, pero por si acaso)
      newHref = withoutExt + fragment;
    } else {
      // Ruta relativa: convertir a absoluta desde la raíz del sitio.
      // Usamos la posición del HTML de origen (relativeFilePath) para resolver.
      const htmlDir = path.dirname(relativeFilePath).replace(/\\/g, "/");
      const resolvedRaw = htmlDir === "." ? withoutExt : htmlDir + "/" + withoutExt;

      // Normalizar segmentos "../" y "./" sin usar path.resolve (que añadiría la ruta del SO)
      const segments = resolvedRaw.split("/");
      const normalized = [];
      for (const seg of segments) {
        if (seg === ".") continue;
        if (seg === "..") { normalized.pop(); continue; }
        normalized.push(seg);
      }

      newHref = "/" + normalized.join("/") + fragment;
    }

    el.attr("href", newHref);
  });

  // 11. Limpiar atributos de presentación residuales de los <a> (pero no href)
  $("a").removeAttr("target").removeAttr("tabindex");
  // Quitar name solo en <a>, no en <map> (donde name es funcional)
  $("a").removeAttr("name");

  // 12. Extraer el contenido del <body>
  let bodyHtml = $("body").html() || $.html();

  // 13. Limpiar whitespace excesivo manteniendo saltos de línea legibles
  bodyHtml = bodyHtml
    .replace(/\n{3,}/g, "\n\n")     // máximo 2 líneas en blanco seguidas
    .replace(/[ \t]{2,}/g, " ")     // espacios múltiples → uno solo
    .trim();

  return { title, cleanHtml: bodyHtml, imgStats };
}

// ─── Generador de fichero .astro ──────────────────────────────────────────────

/**
 * Genera el texto completo de un fichero .astro a partir del título
 * y el HTML limpio.
 */
function generateAstroFile(title, cleanHtml) {
  return `---
import Layout from "${LAYOUT_PATH}";
---

<Layout title="${title.replace(/"/g, "&quot;")}">
${cleanHtml
      .split("\n")
      .map(line => "  " + line)        // indentar 2 espacios dentro del Layout
      .join("\n")}
</Layout>
`;
}

// ─── Orquestador principal ────────────────────────────────────────────────────

async function main() {
  console.log("\n🏛️  Migrador Tarraconensis — Legacy HTML → Astro");
  console.log("═".repeat(55));
  if (DRY_RUN) console.log("⚠️  MODO DRY-RUN: no se escribirá ningún fichero.\n");

  // Recoger ficheros a migrar
  let htmlFiles = collectHtmlFiles(LEGACY_DIR);
  if (ONLY_FILE) {
    const target = ONLY_FILE.replace(/\\/g, "/");
    htmlFiles = htmlFiles.filter(
      f => path.basename(f).toLowerCase() === target.toLowerCase() ||
        f.replace(/\\/g, "/").toLowerCase() === target.toLowerCase()
    );
    if (htmlFiles.length === 0) {
      console.error(`❌  No se encontró el fichero: ${ONLY_FILE}`);
      process.exit(1);
    }
  }

  console.log(`📂  Ficheros encontrados: ${htmlFiles.length}\n`);

  let ok = 0, skipped = 0, errors = 0;

  for (const relPath of htmlFiles) {
    const srcPath = path.join(LEGACY_DIR, relPath);
    const destRel = toAstroName(relPath);
    const destPath = path.join(PAGES_DIR, destRel);

    // Evitar sobreescribir ficheros ya migrados (ej: index.astro ya existe)
    if (fs.existsSync(destPath) && !DRY_RUN) {
      console.log(`⏭️  SALTADO   ${destRel}  (ya existe)`);
      skipped++;
      continue;
    }

    try {
      const raw = readLegacyFile(srcPath);
      // Directorio absoluto del HTML origen (necesario para resolver imágenes relativas)
      const htmlFileDir = path.dirname(srcPath);
      const { title, cleanHtml, imgStats } = cleanLegacyHtml(raw, relPath, htmlFileDir, DRY_RUN);
      const astroContent = generateAstroFile(title, cleanHtml);

      if (DRY_RUN) {
        console.log(`✅  [DRY-RUN] ${destRel}`);
        console.log(`    Título: "${title}"`);
        console.log(`    Imágenes — encontradas: ${imgStats.skipped} | no encontradas: ${imgStats.missing}`);
        console.log(`    Bytes generados: ${astroContent.length}\n`);
      } else {
        // Crear directorios intermedios si hacen falta
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.writeFileSync(destPath, astroContent, "utf-8");
        const imgLog = imgStats.copied > 0 || imgStats.missing > 0
          ? `  [🖼  copiadas: ${imgStats.copied} | no encontradas: ${imgStats.missing}]`
          : "";
        console.log(`✅  MIGRADO   ${destRel}${imgLog}`);
      }
      ok++;
    } catch (err) {
      console.error(`❌  ERROR     ${relPath}`);
      console.error(`    ${err.message}`);
      errors++;
    }
  }

  console.log("\n" + "═".repeat(55));
  console.log(`✅  Migrados:  ${ok}`);
  console.log(`⏭️  Saltados:  ${skipped}`);
  console.log(`❌  Errores:   ${errors}`);
  console.log("");

  if (errors > 0) {
    console.log(
      "💡  Consejo: Los errores suelen deberse a HTML muy malformado.\n" +
      "    Puedes migrar ese fichero manualmente o ajustar el script.\n"
    );
  }
}

main().catch(err => {
  console.error("Error fatal:", err);
  process.exit(1);
});
