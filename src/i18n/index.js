import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import zhTW from './locales/zh-TW.json';
import enUS from './locales/en-US.json';
import ja from './locales/ja.json';
import ko from './locales/ko.json';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      'zh-TW': { translation: zhTW },
      'zh': { translation: zhTW },
      'en': { translation: enUS },
      'en-US': { translation: enUS },
      'ja': { translation: ja },
      'ja-JP': { translation: ja },
      'ko': { translation: ko },
      'ko-KR': { translation: ko }
    },
    fallbackLng: 'zh-TW',
    interpolation: {
      escapeValue: false
    }
  });

export default i18n;
