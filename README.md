# AZAR — Sorteos online (app full-stack)

Landing + herramienta de sorteos con **cuentas reales, sorteos guardados y
certificados verificables**, lista para desplegar en **Vercel** con base de
datos **Postgres (Neon)**.

## Qué incluye

- **Frontend** (`index.html`): la landing y la herramienta de sorteo (lista de
  nombres, ruleta giratoria con sonido, confeti y certificado PNG). Funciona
  también abriéndola sola (modo demo) cuando no hay backend.
- **Backend serverless** (`/api`): funciones Node en Vercel.
  - `POST /api/auth/signup` · `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/me`
  - `GET/POST /api/sorteos` — listar y crear sorteos (requiere sesión)
  - `GET /api/sorteos/:code` — consulta pública (JSON) de un sorteo
  - `GET /s/:code` — página pública del certificado (verificación)
- **Base de datos** (`lib/db.js`): Postgres vía `@neondatabase/serverless`.
- **Auth propia** (`lib/auth.js`): contraseñas con `scrypt` y sesión firmada
  (HMAC) en cookie `httpOnly`. Sin servicios de terceros.

## Estructura

```
index.html            Frontend (landing + app)
vercel.json           Reescritura /s/:code -> /api/s/:code
package.json          Dependencias
api/
  auth/{signup,login,logout,me}.js
  sorteos/{index,[code]}.js
  s/[code].js         Página pública del certificado
lib/
  db.js  auth.js  util.js
```

## Puesta en marcha (deploy en Vercel)

1. **Sube el proyecto a GitHub** (o usa la CLI de Vercel — ver más abajo).
2. En **https://vercel.com** crea un proyecto e impórtalo. No necesita
   configuración de build: Vercel detecta las funciones de `/api` y sirve
   `index.html` como estático.
3. **Base de datos:** en la pestaña **Storage** del proyecto, añade **Neon**
   (Postgres). Al conectarla, Vercel inyecta la variable `DATABASE_URL`
   automáticamente en tu proyecto.
4. **Variable de entorno:** en **Settings → Environment Variables** añade:
   - `AUTH_SECRET` = una cadena larga y aleatoria. Genérala con:
     ```bash
     node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
     ```
5. **Vuelve a desplegar** (Deployments → Redeploy) para que tome las variables.
6. Listo: abre tu dominio `*.vercel.app`, crea una cuenta y haz un sorteo. El
   enlace del certificado (`tu-dominio.vercel.app/s/CODIGO`) será real y
   verificable.

### Alternativa con la CLI

```bash
npm i -g vercel
vercel            # primer deploy (sigue el asistente)
# añade Neon desde el dashboard (Storage) y AUTH_SECRET (Settings)
vercel --prod     # deploy a producción
```

## Desarrollo local

Necesitas Node 18+ y una cadena de conexión de Postgres (crea una gratis en
**https://neon.tech** y copia el connection string).

```bash
npm install
cp .env.example .env      # y rellena DATABASE_URL y AUTH_SECRET
npm run dev               # ejecuta "vercel dev" (requiere la CLI de Vercel)
```

> El modo demo (abrir `index.html` con doble clic) no usa el backend: el sorteo
> funciona, pero registro/login y guardado quedan simulados.

## Login con Google y Facebook (OAuth)

El flujo OAuth ya está implementado (`/api/oauth/:provider/start` y
`/api/oauth/:provider/callback`). Solo tienes que crear las credenciales y
ponerlas como variables de entorno en Vercel. Las cuentas se **unifican por
email**: si el correo ya existe, entra a esa cuenta; si no, se crea.

**Google** — https://console.cloud.google.com → *APIs y servicios* →
*Credenciales* → *Crear credenciales* → *ID de cliente de OAuth* →
*Aplicación web*:
- **Authorized redirect URI:** `https://TU-DOMINIO.vercel.app/api/oauth/google/callback`
- Copia el *Client ID* y *Client secret* → variables `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` en Vercel.

**Facebook** — https://developers.facebook.com → *Crear app* → añade
*Inicio de sesión con Facebook* → *Configuración*:
- **Valid OAuth Redirect URI:** `https://TU-DOMINIO.vercel.app/api/oauth/facebook/callback`
- Copia el *App ID* y *App secret* → variables `FACEBOOK_CLIENT_ID` y `FACEBOOK_CLIENT_SECRET` en Vercel.

Tras añadir las variables, **vuelve a desplegar**. Los botones "Continuar con…"
del sitio ya están conectados a este flujo.

## Notas

- El login con **email + contraseña** ya es real. Los botones de Google/Facebook
  quedan activos en cuanto configures las credenciales de arriba.
- **Redes sociales (Instagram, TikTok, etc.):** aún no conectadas. Requieren
  apps de desarrollador aprobadas por cada plataforma (siguiente etapa).
- La base de datos crea sus tablas sola la primera vez (`ensureSchema`).
