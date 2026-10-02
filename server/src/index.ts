import { formatStartupBanner, lanAddresses } from './banner.js';
import { createApplication, defaultClientDir } from './app.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const PORT = Number(process.env.PORT ?? 3001);

/** The Vite dev server port. This is the URL a phone actually needs to open. */
const CLIENT_PORT = Number(process.env.CLIENT_PORT ?? 5173);

const production = process.env.NODE_ENV === 'production' || import.meta.url.endsWith('/dist/index.js');
if (production && !existsSync(join(defaultClientDir, 'index.html'))) {
  throw new Error('Missing client/dist/index.html. Run npm run build before npm start.');
}
const application = createApplication();
application.http.listen(PORT, '0.0.0.0', () => {
  console.log(formatStartupBanner(lanAddresses(), production ? PORT : CLIENT_PORT, PORT));
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    void application.close().then(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
