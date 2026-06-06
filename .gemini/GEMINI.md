# REGLAS ESTRICTAS DEL PROYECTO TARRACONENSIS
1. NUNCA modifiques, borres o sobreescribas los archivos originales de la carpeta `_legacy_frontpage`. Son intocables, son solo de lectura.
2. Todas las páginas nuevas generadas en Astro deben usar el componente `<Layout>` ubicado en `src/layouts/Layout.astro`.
3. Nunca alteres las rutas relativas de las imágenes (`<img>`) ni los enlaces (`href`) al extraer el contenido.
4. Si se te pide procesar archivos masivamente, NO lo hagas manualmente. Debes crear un script en Node.js para que el usuario lo revise y lo ejecute por su cuenta.