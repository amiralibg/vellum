/** A small uploaded HTML document. MARKER only appears if its own content is served. */
export const PITCH = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Weft — Seed round</title>
    <meta name="description" content="We're raising $2M to make invoicing boring." />
    <link rel="stylesheet" href="style.css" />
  </head>
  <body><h1>Weft</h1><script>window.MARKER = "uploaded-script-ran";</script></body>
</html>`;

export const MARKER = "uploaded-script-ran";
