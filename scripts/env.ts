/**
 * Loads .env files the same way Next.js does (.env, .env.local,
 * .env.development, …), so the npm scripts see the same settings as the app.
 * Import this first in every script.
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());
