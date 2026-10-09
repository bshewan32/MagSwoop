import en from '../i18n/en.json'
import type { Locale } from './save'

export type Dictionary = Record<string, string>

/** The game ships in one language. Keep every visible string in `src/i18n/en.json`. */
const DICTIONARY: Dictionary = en

export function resolveLocale(): Locale {
  return 'en'
}

export class I18n {
  readonly locale: Locale = 'en'

  constructor() {
    document.documentElement.lang = this.locale
  }

  /** Look up `key`, replacing `{name}` placeholders. Missing keys render the key so gaps are visible. */
  t(key: string, vars: Record<string, string | number> = {}): string {
    const text = DICTIONARY[key] ?? key
    return text.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`))
  }

  has(key: string): boolean {
    return key in DICTIONARY
  }
}

export const DICTIONARY_KEYS = Object.keys(en)
