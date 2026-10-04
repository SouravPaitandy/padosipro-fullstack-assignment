# PadosiPro — Design & Architecture

## 1. Architecture

### Mobile Application
The mobile app is built using **React Native** (managed via **Expo**), allowing a native experience for Android while keeping the development lifecycle fast. 
- **UI & Styling:** I used **NativeWind** (Tailwind CSS for React Native) to ensure consistent, utility-based styling across screens without massive stylesheets.
- **Routing:** Handled via **React Navigation** (Native Stack), utilizing route gates to lock users out of protected screens if they lack a valid session or haven't completed onboarding.
- **State Management:** **Zustand** is used for global state management (holding the session token, user profile summary, and catalog selections) due to its minimal boilerplate.
- **Network:** Communication with the backend is done via standard `fetch`, wrapped in a custom client that automatically injects the session JWT into the `Authorization` header.

### Backend Application
The backend is a **Node.js** API using **Express**. The backend follows a modular structure around the main domains (auth, profile, and tasks), keeping responsibilities separated and the codebase easy to extend.
- **Data Validation:** All incoming requests are strictly validated at the boundary using **Zod**.
- **Database & Persistence:** **PostgreSQL** is the relational database, managed via **Prisma ORM**. Prisma handles schema migrations, type-safe queries, and database seeding.

### Authentication & OTP Verification
Authentication is completely stateless. 
- **OTP Generation:** Six-digit OTPs are generated securely using the Node `crypto` module. 
- **OTP Storage:** To protect against database breaches, OTPs are **never stored in plaintext**. They are hashed via HMAC-SHA-256 before being saved to the database alongside an expiration timestamp and attempt counter.
- **Email Delivery:** Emails are simulated locally using **Nodemailer** routed to a local **Mailpit** Docker container.
- **Session Management:** Once verified, the user logs in and receives a signed **JWT (JSON Web Token)**. This token is stored securely on the device using `expo-secure-store`.

## 2. Key Design Decisions & Trade-offs

**Stateless JWT vs. Redis Session Store**
- **Decision:** I chose to use stateless JWTs for sessions rather than stateful sessions backed by Redis.
- **Why:** For a take-home assignment, requiring a Redis container just for sessions adds unnecessary infrastructure complexity. JWTs allow the API to remain completely stateless.
- **Trade-off:** Instant session revocation is impossible without maintaining a token blacklist.

**HMAC vs. Bcrypt for OTP Hashing**
- **Decision:** I used HMAC-SHA-256 for hashing the 6-digit OTP codes, but kept `bcrypt` for user passwords.
- **Why:** Bcrypt is intentionally slow (to prevent brute-forcing passwords). However, OTPs are short-lived, highly entropic codes that are only valid for 10 minutes. Using bcrypt for OTPs introduces unnecessary latency during the login flow. HMAC provides deterministic server-side verification without storing the OTP itself in plaintext, while the expiry and attempt limits constrain online guessing.
- **Trade-off:** HMAC requires a securely managed secret key on the server.

**Zustand over Redux**
- **Decision:** I used Zustand for mobile state management.
- **Why:** The app's state requirements are relatively simple (auth state, form drafts, and fetched task lists). Redux would introduce massive boilerplate, while React Context often leads to unnecessary re-renders. Zustand hits the perfect middle ground.
- **Trade-off:** Zustand lacks the extensive middleware ecosystem of Redux.

**JavaScript over TypeScript**
- **Decision:** I used JavaScript for both the backend and frontend.
- **Why:** To maximize execution speed and avoid the overhead of type configuration and compilation steps during this time-boxed assignment.
- **Trade-off:** Loss of compile-time guarantees, requiring heavier reliance on runtime validation (Zod) and automated tests to catch errors.

## 3. What Was Intentionally Left Out

To respect the scope of the assignment, the following features were intentionally excluded:
- **Provider Discovery & Booking:** The app focuses purely on user registration and profile completion. Marketplace features (searching for a provider, booking a task) are absent.
- **Production Email Infrastructure:** The app uses Mailpit for local testing rather than integrating with a paid ESP (like SendGrid or AWS SES).
- **Refresh Tokens:** The authentication flow uses a single JWT rather than a more complex short-lived access token + long-lived refresh token architecture.
- **Password Reset Flow:** Since the core assignment focused on the initial OTP email verification, a dedicated "Forgot Password" recovery flow was omitted.
- **Payments & Chat:** Completely out of scope for the required onboarding journey.

## 4. What I Would Do With Another Week

If I had another week to prepare this application for a production release, I would prioritize:

- **Production Backend Deployment:** I would deploy the Express API and PostgreSQL database to a managed cloud provider (e.g., Render, Railway, or AWS) and configure a public HTTPS URL. This would eliminate the need to hardcode a local IP address in the mobile app before building.
- **Migrate to TypeScript:** I would introduce strict static typing across both the mobile app and backend to improve maintainability and catch edge-case bugs early.
- **Mobile End-to-End (E2E) Testing:** While the backend has integration tests via Vitest, I would add automated E2E tests for the mobile app using Maestro or Detox to guarantee the onboarding flow never breaks on real devices.
- **Strengthen Security & Rate Limiting:** The current IP rate limiter for OTP requests uses in-memory storage (`express-rate-limit`). In a clustered production deployment, I would back this with a Redis store to prevent distributed brute-force attacks.
- **CI/CD Pipelines:** Set up GitHub Actions to automatically run tests, linting, and trigger EAS preview builds for Android and iOS on every pull request.
- **Accessibility & UI Polish:** Add more comprehensive loading skeletons, better offline-mode network handling, and ensure all React Native components fully comply with accessibility standards (screen readers, contrast ratios, and touch targets).
