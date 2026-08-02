// Auth.js endpoints (signin, callback, session, signout, csrf...). The magic
// link itself never points here: it goes to /login/verify, which POSTs to
// /api/auth/callback/nodemailer to consume the token.
import { handlers } from '@/auth';

export const { GET, POST } = handlers;
