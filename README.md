# PadosiPro — Setup

Native Android-first app built with Expo + React Native, backed by Express + PostgreSQL.

---

## Prerequisites

| Tool                      | Min version | Notes                                                                                                 |
| ------------------------- | ----------- | ----------------------------------------------------------------------------------------------------- |
| Node.js                   | 22.13.x     | Use [nvm](https://github.com/nvm-sh/nvm) or [nvm-windows](https://github.com/coreybutler/nvm-windows) |
| npm                       | 10          | Bundled with Node                                                                                     |
| Docker Desktop            | any recent  | Runs PostgreSQL + Mailpit                                                                             |
| Expo CLI                  | local       | Use `npx expo` (avoid legacy global `expo-cli`)                                                       |
| Android Studio / Emulator | latest      | For Android testing                                                                                   |

---

## First-time setup

### 1. Install dependencies

```bash
# From the repo root
npm install
```

### 2. Create your local env files

**For the API (Server Secrets):**

```bash
cp .env.example apps/api/.env
```

Open `apps/api/.env` and replace the two secret placeholders with strong random values:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Run that twice — use one value for `JWT_SECRET` and a **different** one for `OTP_HMAC_SECRET`.

**For the Mobile App (Public Config):**

```bash
cp apps/mobile/.env.example apps/mobile/.env
```

Open `apps/mobile/.env` and set `EXPO_PUBLIC_API_URL` to your API URL (see instructions below for Android / Physical device).

### 3. Start Docker services (PostgreSQL + Mailpit)

```bash
docker compose up -d
```

Verify: `docker compose ps` — both services should show `running`.

### 4. Apply database migrations and seed

After Docker is running (step 3):

```bash
# Apply the committed migration to create all tables
npm run db:migrate

# Seed 4 categories and 20 tasks
npm run db:seed
```

To verify after seeding:

```bash
# Re-run the seed a second time to confirm idempotency — counts must stay the same
npm run db:seed
```


---

## Running the API

```bash
npm run api
# → Express listens on http://localhost:3000
# → GET http://localhost:3000/health  should return {"status":"ok"}
```

Or from the workspace directly:

```bash
cd apps/api && npm run dev
```

## Running the mobile app

```bash
npm run mobile
# → Expo DevTools / Metro opens; press 'a' for Android emulator
```

Or from the workspace:

```bash
cd apps/mobile && npm start
```

### Physical device (Android)

A reachable `EXPO_PUBLIC_API_URL` is needed for the installed APK (or Expo Go) to communicate with the backend. While a build will succeed with any value, using `localhost` will produce an app that cannot reach the development machine from a phone.

Set `EXPO_PUBLIC_API_URL` in `apps/mobile/.env` to your machine's LAN IP or production URL:

```
EXPO_PUBLIC_API_URL=http://192.168.x.x:3000
```

Scan the QR code with Expo Go on the device (ensure device is on the same Wi-Fi).

### Android emulator host routing

When using Android Studio emulator, the host machine is reachable at `10.0.2.2`. Set this in `apps/mobile/.env`:

```
EXPO_PUBLIC_API_URL=http://10.0.2.2:3000
```

---

## Monorepo Notes

- **Environment Variables**: API secrets must go in `apps/api/.env`. Mobile public variables must go in `apps/mobile/.env` (Expo reads `.env` from its working directory).
- **Metro Bundler**: A custom `metro.config.js` in `apps/mobile` resolves workspace packages correctly. **Always run `npm install` from the repository root.**

---

## Mailpit (OTP email inbox)

Open [http://localhost:8025](http://localhost:8025) in a browser to read OTP emails sent during local development. No external email service required.

---

## Running API tests

```bash
npm run test
```

---

## Root scripts reference

| Script                   | What it does                                                 |
| ------------------------ | ------------------------------------------------------------ |
| `npm run api`            | Start API in dev mode (nodemon)                              |
| `npm run mobile`         | Start Expo bundler                                           |
| `npm run mobile:android` | Start Expo and open Android                                  |
| `npm run db:generate`    | Re-generate Prisma Client after schema changes               |
| `npm run db:migrate`     | Apply committed migrations (`prisma migrate deploy`)         |
| `npm run db:migrate:dev` | Create + apply a new migration in dev (`prisma migrate dev`) |
| `npm run db:seed`        | Upsert categories and tasks (safe to rerun)                  |
| `npm run test`           | Run API test suite                                           |

---

## App Bundling and APK build

**Note on Bundling vs. Building**: Running `npx expo export` creates a compiled JavaScript bundle and static assets for the app. It does **not** create an installable Android APK.

To build a standalone installable Android APK for physical device installation:

1. Use the pre-configured `preview` build profile already located in `apps/mobile/eas.json` which builds an installable APK.
2. A reachable backend URL is needed for the installed APK to communicate with the backend. This API URL is embedded at build time. You can either set `EXPO_PUBLIC_API_URL` in the Expo Cloud Dashboard as a secret, or define it in `apps/mobile/.env` before building. A LAN IP works for physical-device testing only when the device and development machine are on the same network. A production backend URL can be used instead if available.
3. Authenticate with Expo and initialize the project. From the `apps/mobile` directory:
   ```bash
   cd apps/mobile
   npx eas-cli login
   npx eas-cli init
   ```
   _(This links your code to an EAS project ID in `app.json`.)_
4. Run the EAS cloud build command:
   ```bash
   npx eas-cli build --platform android --profile preview
   ```

### APK Testing

The submitted Android APK is configured for local-network API testing.

For the APK to communicate with the backend:
- Start PostgreSQL and Mailpit using Docker Compose.
- Start the Express API locally.
- Ensure the Android device and development machine are on the same Wi-Fi network.
- Configure the mobile API URL to the machine's LAN IP before building the APK.

The backend can also be run independently using the setup instructions above.
