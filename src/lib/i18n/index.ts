// Homemade i18n: typed message dictionaries, no dependency. EN is the base
// (fr.ts must satisfy its type), FR is the first language. The locale comes
// from users.locale via the subject context; pages resolve messages once and
// pass them (or leaves of them) down to components.
import { en, type Messages } from './messages/en';
import { fr } from './messages/fr';

export type { Messages };
export type Locale = 'en' | 'fr';

const ALL: Record<Locale, Messages> = { en, fr };

export function resolveLocale(raw: string | null | undefined): Locale {
  return raw === 'fr' || raw?.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

export function getMessages(raw: string | null | undefined): Messages {
  return ALL[resolveLocale(raw)];
}
