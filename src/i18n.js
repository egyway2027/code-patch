import en from './locales/en';
import ar from './locales/ar';

export const LANGUAGES = [
  ['en', 'English', 'LTR'],
  ['ar', 'العربية', 'RTL'],
  ['zh', '中文', 'LTR'],
  ['hi', 'हिन्दी', 'LTR'],
  ['es', 'Español', 'LTR'],
  ['fr', 'Français', 'LTR'],
  ['bn', 'বাংলা', 'LTR'],
  ['pt', 'Português', 'LTR'],
  ['ru', 'Русский', 'LTR'],
  ['ur', 'اردو', 'RTL'],
  ['id', 'Bahasa Indonesia', 'LTR'],
  ['de', 'Deutsch', 'LTR'],
  ['ja', '日本語', 'LTR'],
  ['mr', 'मराठी', 'LTR'],
  ['te', 'తెలుగు', 'LTR'],
  ['tr', 'Türkçe', 'LTR'],
  ['ta', 'தமிழ்', 'LTR'],
  ['vi', 'Tiếng Việt', 'LTR'],
  ['ko', '한국어', 'LTR'],
  ['it', 'Italiano', 'LTR']
];

export const DEFAULT_LANGUAGE = 'en';

const dictionaries = { en, ar };

export function getLanguage() {
  try {
    return localStorage.getItem('code-patcher-language') || DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

export function setLanguage(code) {
  try {
    localStorage.setItem('code-patcher-language', code);
  } catch {}
}

export function getStrings(code) {
  const current = dictionaries[code] || dictionaries[DEFAULT_LANGUAGE] || en;
  return new Proxy(current, {
    get(target, prop) {
      if (prop in target && target[prop]) return target[prop];
      if (prop in en && en[prop]) return en[prop];
      return ''; // لا تُرجع اسم المفتاح البرمجي أبداً
    }
  });
}

export function isRTL(code) {
  return ['ar', 'ur'].includes(code);
}
