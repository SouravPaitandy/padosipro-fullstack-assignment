# PadosiPro — Architecture v1

**Status:** v1 baseline, ready to use for small implementation tickets  
**Deadline:** Sunday, October 4, 2026  
**Product rule:** the supplied assignment is authoritative; the reference app informs visual treatment, not a replacement for the required flow.  
**Implementation model:** Sourav owns decisions and understanding; ChatGPT reviews architecture and code; Antigravity implements narrowly scoped tickets against this document.

## 1. Scope and decisions

Build a native Android-first React Native app using Expo and JavaScript, plus a JavaScript Express API backed by PostgreSQL and Prisma. The required journey is:

`Register → Verify email OTP → Log in → Complete profile → Select tasks → Confirm → Home → Log out`

The mobile app must not use a WebView. Do not add booking, payment, chat, provider discovery, push notifications, or other product features outside the assignment.

| Decision | v1 choice | Reason |
|---|---|---|
| Repository | npm-workspaces monorepo | One install and shared scripts, while keeping mobile and API deployable separately. |
| Mobile | Expo + React Native, JavaScript, NativeWind, React Navigation, Zustand | Matches the chosen stack and keeps screens native. |
| API | Node.js + Express, JavaScript, Zod | Small explicit REST API and runtime validation at every boundary. |
| Persistence | PostgreSQL + Prisma | Relational constraints fit accounts, catalog and selections. |
| Passwords | bcrypt, cost factor 12 (configurable) | Assignment-compatible password hashing with a practical default. |
| OTP | 6-digit cryptographically random code; store HMAC-SHA-256 digest using a server secret | Six-digit codes have low entropy; keyed digest prevents a database-only attacker from cheaply enumerating codes. Raw codes exist only long enough to send email. |
| Session | Signed short-lived JWT access token (7 days for this take-home); no refresh token in v1 | Meets persisted-session requirement without an unnecessary second token lifecycle. Store only in Expo SecureStore. |
| Business Name | Optional | The assignment allows optional-or-required; a service marketplace can accommodate independent workers and businesses. Do not block an individual user from onboarding. |
| Task selection | Replace-all selection endpoint, with an empty list allowed | Simple, idempotent confirm action and clear return behavior. |
| Catalog | Seed at least 20 active tasks in at least 4 categories | Repeatable local/demo state and assignment compliance. |

Business Name rationale: make it optional in the UI and nullable in storage. If Sourav later confirms the assignment explicitly requires it, change the Zod schema, UI and database validation together before implementation; do not silently infer that requirement.

## 2. Monorepo layout

```text
padosipro/
├── apps/
│   ├── api/
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   └── seed.js
│   │   ├── src/
│   │   │   ├── app.js                 # Express app, no listen side effect
│   │   │   ├── server.js              # process startup and graceful shutdown
│   │   │   ├── config/                # validated environment
│   │   │   ├── middleware/            # auth, validation, errors, request id
│   │   │   ├── modules/
│   │   │   │   ├── auth/              # routes, schemas, service
│   │   │   │   ├── profile/
│   │   │   │   └── tasks/
│   │   │   ├── mail/                  # SMTP adapter (Mailpit locally)
│   │   │   └── lib/                   # Prisma, crypto, response helpers
│   │   └── test/                      # Vitest + Supertest integration tests
│   └── mobile/
│       ├── app.json
│       ├── babel.config.js
│       ├── tailwind.config.js
│       └── src/
│           ├── App.js
│           ├── navigation/            # auth/onboarding/main route gates
│           ├── screens/               # Register, VerifyOtp, Login, Profile,
│           │                           # TaskSelection, Home
│           ├── components/            # shared inputs, buttons, cards, states
│           ├── api/                   # fetch client, endpoint functions
│           ├── store/                 # Zustand session and onboarding state
│           ├── theme/                 # colors, spacing, typography
│           └── validation/             # client schemas (server remains authority)
├── packages/
│   └── shared/                        # only stable shared constants/catalog types
├── docker-compose.yml                 # PostgreSQL + Mailpit for local dev
├── .env.example
├── package.json                       # npm workspaces and root scripts
├── README.md
└── DESIGN.md
```

Keep API and mobile validation schemas in their respective apps initially; avoid coupling client releases to backend internals. The shared package is for small constants only, not database or server code.

## 3. Data model

All primary keys are UUIDs. Store timestamps in UTC. Prisma owns schema and migrations; `seed.js` is safe to rerun and upserts stable category/task slugs.

### User

`id`, `email` (normalized lowercase, unique), `passwordHash`, `emailVerifiedAt` (nullable), `createdAt`, `updatedAt`.

### OtpChallenge

`id`, `userId` (FK), `codeDigest`, `expiresAt`, `attempts` (default 0), `resendAvailableAt`, `consumedAt` (nullable), `createdAt`.

Index by `(userId, createdAt)`. Keep prior challenge rows for audit/debugging; only the newest unconsumed, unexpired challenge is eligible. A new successfully issued challenge consumes/supersedes the prior active challenge. Never store plaintext OTP.

### Profile

`id`, `userId` (unique FK), `name`, `mobile` (10 digits without country prefix), `address`, `businessName` (nullable), `createdAt`, `updatedAt`.

The API accepts an Indian phone as exactly ten digits (or a UI-normalized `+91` prefix followed by ten digits); it stores the ten-digit national number. The UI displays `+91` separately. Do not accept other country codes for this assignment.

### Category and Task

`Category`: `id`, `name`, `slug` (unique), `sortOrder`, `isActive`.  
`Task`: `id`, `categoryId` (FK), `name`, `slug` (unique), `description` (nullable), `sortOrder`, `isActive`.

Seed 4 or more categories and at least 20 active tasks. Category and task lists sort by `sortOrder`, then name. Inactive catalog items are not offered for new selections.

### UserTask

Join table: `userId` + `taskId` composite primary key, `selectedAt`. Deleting/replacing a user's selection removes stale join rows in one transaction. Catalog deletion is restricted while referenced; normally deactivate instead.

### Key constraints

- Unique normalized user email, one profile per user, unique task/category slugs.
- OTP attempt count and expiration checks happen in the service and in a transaction to avoid concurrent verification overshooting limits.
- UserTask foreign keys and composite key prevent duplicates and cross-user ownership mistakes.
- Never return `passwordHash` or `codeDigest` from API responses.

## 4. API contract

Base path: `/api/v1`. JSON request and response bodies. Protected routes require `Authorization: Bearer <JWT>`. Use ISO-8601 UTC timestamps. All list endpoints return arrays in `data` (not pagination for this small fixed catalog).

### Success and error envelope

Success: `{"data": {...}}` (or `{"data": [...]}`). Errors:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Check the submitted fields.",
    "fields": { "email": "Enter a valid email address." },
    "requestId": "..."
  }
}
```

`fields` is omitted when not applicable. Stable codes include `VALIDATION_ERROR`, `EMAIL_ALREADY_REGISTERED`, `EMAIL_NOT_VERIFIED`, `INVALID_CREDENTIALS`, `OTP_INVALID`, `OTP_EXPIRED`, `OTP_ATTEMPTS_EXCEEDED`, `OTP_RESEND_TOO_SOON`, `UNAUTHORIZED`, `PROFILE_INCOMPLETE`, `TASK_NOT_FOUND`, and `INTERNAL_ERROR`. Never return stack traces, SQL details, password/OTP values, or secrets. Include request IDs in logs and error responses.

### Endpoints

| Method and path | Auth | Request | Result |
|---|---|---|---|
| `POST /auth/register` | No | `{ "email", "password" }` | `201 { data: { userId, email, verificationRequired: true, resendAvailableAt } }`; send OTP after persistence. |
| `POST /auth/verify-otp` | No | `{ "email", "code" }` | `200 { data: { verified: true } }`; does not silently log in. |
| `POST /auth/resend-otp` | No | `{ "email" }` | `200 { data: { sent: true, resendAvailableAt } }`; enforce cooldown and do not reveal account existence. |
| `POST /auth/login` | No | `{ "email", "password" }` | `200 { data: { accessToken, expiresAt, user: { id, email, profileComplete, selectedTaskCount } } }`. |
| `GET /auth/me` | Yes | — | Current user summary and onboarding flags. |
| `POST /auth/logout` | Yes | — | `200 { data: { loggedOut: true } }`; JWT is stateless, so client deletes it. |
| `GET /profile` | Yes | — | `200 { data: { profile: null | {...} } }`. |
| `PUT /profile` | Yes | `{ name, mobile, address, businessName? }` | Validate and upsert profile; return saved profile. |
| `GET /tasks` | Yes | optional `?search=` | Active categories with active task arrays, sorted consistently; empty state is valid. |
| `GET /me/tasks` | Yes | — | Current user's selected task IDs and task summaries. |
| `PUT /me/tasks` | Yes | `{ "taskIds": ["uuid", ...] }` | Validate all IDs are active; atomically replace selection; return saved selection. Empty array clears selection. |

Registration response and resend response should avoid confirming whether an email is already registered. Registration of an existing unverified account may request a resend subject to cooldown; a verified account receives the same generic acknowledgement. Login uses a generic `INVALID_CREDENTIALS` for wrong password or unknown email; a correct password on an unverified account receives `EMAIL_NOT_VERIFIED` and cannot receive a JWT.

## 5. Authentication and OTP lifecycle

1. Normalize email by trimming and lowercasing. Zod validates email and password rules before database access. Hash password with bcrypt; never log it.
2. Generate six digits using Node's cryptographic random source, preserving leading zeroes. Save only a keyed digest, expiry (`now + 10 minutes`), attempt count `0`, and resend availability (`now + 30 seconds`). Send plaintext code through SMTP after the challenge is persisted.
3. For delivery failure, mark/expire that challenge and return a generic retryable server error; do not claim delivery succeeded. Avoid rolling back an account registration, so resend can recover.
4. Verification selects the latest eligible challenge. Expired challenges return `OTP_EXPIRED`; consumed/superseded challenges are invalid. For a wrong code, increment attempts atomically. The fifth wrong attempt exhausts and consumes the challenge; further checks return `OTP_ATTEMPTS_EXCEEDED`. A correct code consumes the challenge and sets `emailVerifiedAt` atomically. It is single-use.
5. Resend is available after the stored cooldown timestamp. A successful resend supersedes the prior active challenge and starts a fresh 10-minute expiry and 30-second cooldown. Rate limit by email/account and IP in addition to cooldown; return a generic response for unknown/verified emails.
6. Login checks password, then `emailVerifiedAt`. Only verified accounts receive a signed JWT containing `sub`, `iat`, `exp`; validate signature/expiry on each protected request. Do not put profile or task data in the token.
7. Persist the token with Expo SecureStore. On app startup, read it, call `/auth/me`, and route according to server flags. On 401, clear session and return to login. Logout clears SecureStore and Zustand state; because v1 uses stateless access JWTs, server logout does not revoke a stolen token before expiry.

## 6. Mobile navigation and state

Use React Navigation native stacks with route gates derived from a single session/onboarding bootstrap:

```text
Unauthenticated: Register ↔ Verify OTP ↔ Login
Authenticated, profile missing: Profile
Authenticated, profile complete, no confirmed task selection: Task Selection
Authenticated, onboarding complete: Home
```

Screens: Register, OTP Verification, Login, Profile, Task Selection, Home. Back navigation must not bypass server gates; after verification, direct the user to Login as required. Persist only the JWT in SecureStore. Zustand holds the in-memory user summary, bootstrap/loading state, catalog cache, draft task IDs and network status. Do not persist password, OTP, profile form contents, or redundant auth state. Clear all sensitive/in-memory state at logout or unauthorized response.

Task selection screen groups tasks by category, searches task names, supports multi-select, shows selected count, and confirms once. Fetch saved tasks on entry so returning users see the saved selection. Home shows selected task names grouped by category; if none are selected, show a useful empty state and a button back to selection. All network screens have loading, empty, retryable error and success states; forms disable duplicate submission and show field-level errors.

## 7. Visual system and interaction

Apply the supplied PadosiPro screenshots as the visual reference: warm off-white surface (`#FAFAF7`), deep green primary (`#126A56`), dark navy text, muted blue-grey supporting text, pale mint selected cards and restrained muted-gold accents. Use rounded, lightly bordered cards, minimal shadows, generous spacing and clear heading/supporting-text hierarchy. Avoid gradients and decorative complexity. Ensure contrast, visible focus/pressed states, readable touch targets and keyboard-safe forms. The screenshots themselves are not present in this workspace; these values and patterns come from the prior review notes and should be checked against the originals if they become available.

NativeWind provides utility styling; define colors/spacing centrally and reuse shared native components. Keep layouts responsive for common Android phone widths. Do not reproduce website-only navigation or use a web surface.

## 8. Validation, errors and operational behavior

- Validate environment at API startup with Zod; fail fast with a clear missing-variable message (never print secret values).
- Validate params, query and body at the API boundary. Mobile validation improves feedback but is not trusted by the API.
- Normalize email and phone once in service boundaries. Trim text fields; reject empty required values.
- Password policy: minimum 8 characters, maximum 72 UTF-8 bytes for bcrypt compatibility; do not add arbitrary complexity rules.
- Name required; address required; mobile must be exactly 10 Indian national digits after optional UI `+91` normalization; Business Name optional and length-limited.
- Map known Prisma constraint errors to stable API errors; unexpected errors go through one Express error middleware, are logged with request ID and return generic `INTERNAL_ERROR`.
- Use HTTPS in production. Local development uses HTTP only on the developer machine/emulator network. Configure CORS for the mobile development origin as needed; do not use wildcard credentials.
- Never commit `.env`, generated secrets, OTPs, JWTs or real user data.

## 9. Testing strategy

Use Vitest and Supertest against the Express app exported by `app.js`; use a disposable PostgreSQL test database and reset/seed it between suites. Inject a clock, mail sender and OTP randomness provider where needed so edge cases are deterministic without weakening production defaults.

Required API coverage:

- Registration normalizes email, hashes password, and sends a six-digit code while persisting only a digest.
- OTP accepts a valid code once; rejects wrong code; rejects expired, superseded and consumed codes; fifth wrong attempt exhausts it; concurrent attempts cannot exceed the limit.
- Resend enforces 30-second cooldown, invalidates the prior code, restarts expiry, and does not disclose account existence.
- Unverified login is denied; verified login succeeds; wrong password and unknown email use generic credentials error; JWT expiry/invalid signature denies access.
- Profile required fields and Indian mobile rules; optional business name; one profile per user.
- Task catalog contains at least 20 tasks and 4 categories; selection rejects inactive/unknown IDs, is idempotent, replaces prior selections and is scoped to the caller.
- Every protected endpoint rejects missing/invalid token; errors use the consistent envelope and do not leak secrets.

Mobile manual verification covers the complete required journey, SecureStore session restoration, back behavior, keyboard layouts, offline/retry states, empty selection, search and logout. Do not claim a mobile automated test suite unless one is actually added and run.

## 10. Local development and delivery

Docker Compose starts PostgreSQL and Mailpit only. API and Expo app run as normal local processes. Mailpit exposes its SMTP listener to the API and a browser inbox for reading OTP messages; no external email service is required locally.

`.env.example` documents at least `DATABASE_URL`, `JWT_SECRET`, `OTP_HMAC_SECRET`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, `API_PORT`, and `EXPO_PUBLIC_API_URL`, with placeholder values only. Require strong local secrets generated by the developer; production SMTP and HTTPS values are deployment-specific.

Root scripts should cover install, API dev, mobile dev, Prisma migrate, seed, API test, and Android build. README must give clean setup steps: install prerequisites, copy env example, start containers, migrate, seed, start API, open Mailpit, start Expo, test on device/emulator, and build APK. Document Android emulator host routing and physical-device LAN URL separately. Build a release APK with EAS or the documented Expo Android build path and provide the artifact; state any signing/build limitations honestly.

## 11. Seven-day execution plan

| Day | Date | Goal and review gate |
|---|---|---|
| 1 | Mon, Sep 28 | Lock Architecture v1, inspect reference screenshots/assignment, create monorepo skeleton and local Docker services. Gate: clean local services and documented contract. |
| 2 | Tue, Sep 29 | Prisma schema/migrations/seed; Express app foundation, env validation, error envelope. Gate: schema and seed satisfy catalog minimum. |
| 3 | Wed, Sep 30 | Register, OTP issue/verify/resend, Mailpit, login/JWT, auth tests. Gate: OTP lifecycle and verified-login rules covered. |
| 4 | Thu, Oct 1 | Profile API, task catalog and selection APIs, integration tests. Gate: server validation and caller-scoped persistence. |
| 5 | Fri, Oct 2 | Expo theme/navigation, register/verify/login/profile screens and API wiring. Gate: native onboarding reaches task selection. |
| 6 | Sat, Oct 3 | Task selection/home/logout, loading/empty/error states, end-to-end manual pass, targeted fixes. Gate: complete happy path and core failure paths. |
| 7 | Sun, Oct 4 | Documentation, security/code review, clean setup verification, APK build and final delivery. Gate: README, `.env.example`, `DESIGN.md`, APK and known limitations ready. |

Keep tickets small and reviewable. For each ticket: agree acceptance criteria, let Antigravity implement only that slice, inspect the diff and explain the important decisions, then run the relevant checks before starting the next slice. Protect the final day for build and setup issues; cut polish before cutting OTP/security correctness or required flow.

## 12. Open checks before implementation

These are verification items, not blockers to the v1 baseline:

1. Compare the palette/layout notes against the original ten screenshots if the user reattaches them to this workspace.
2. Check the exact assignment text for whether Business Name is optional or required; current v1 chooses optional with the rationale above.
3. Choose the final task names from the assignment/reference material; seed data must not invent unsupported services if a supplied catalog exists.
4. Confirm available Android build route and emulator/device networking on the development machine during setup.
