import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import vi from './vi.js';
import en from './en.js';

let lng = 'vi';
try {
  lng = localStorage.getItem('tw.lang') || 'vi';
} catch {
  /* ignore */
}

i18n.use(initReactI18next).init({
  resources: { vi: { translation: vi }, en: { translation: en } },
  lng,
  fallbackLng: 'vi',
  interpolation: { escapeValue: false },
});

document.documentElement.lang = lng;

export const LANGUAGES = [
  { code: 'vi', label: 'Tiếng Việt', flag: '🇻🇳' },
  { code: 'en', label: 'English', flag: '🇬🇧' },
];

export default i18n;
