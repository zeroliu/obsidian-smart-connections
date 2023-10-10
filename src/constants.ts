// create one object with all the translations

import { SmartConnectionSettings } from 'src/types';

// research : SMART_TRANSLATION[language][key]
export const SMART_TRANSLATION = {
  en: {
    pronous: ['my', 'I', 'me', 'mine', 'our', 'ours', 'us', 'we'],
    prompt: 'Based on your notes',
    initial_message:
      "Hi, I'm ChatGPT with access to your notes via Smart Connections. Ask me a question about your notes and I'll try to answer it.",
  },
  es: {
    pronous: ['mi', 'yo', 'mí', 'tú'],
    prompt: 'Basándose en sus notas',
    initial_message:
      'Hola, soy ChatGPT con acceso a tus apuntes a través de Smart Connections. Hazme una pregunta sobre tus apuntes e intentaré responderte.',
  },
  fr: {
    pronous: [
      'me',
      'mon',
      'ma',
      'mes',
      'moi',
      'nous',
      'notre',
      'nos',
      'je',
      "j'",
      "m'",
    ],
    prompt: "D'après vos notes",
    initial_message:
      "Bonjour, je suis ChatGPT et j'ai accès à vos notes via Smart Connections. Posez-moi une question sur vos notes et j'essaierai d'y répondre.",
  },
  de: {
    pronous: [
      'mein',
      'meine',
      'meinen',
      'meiner',
      'meines',
      'mir',
      'uns',
      'unser',
      'unseren',
      'unserer',
      'unseres',
    ],
    prompt: 'Basierend auf Ihren Notizen',
    initial_message:
      'Hallo, ich bin ChatGPT und habe über Smart Connections Zugang zu Ihren Notizen. Stellen Sie mir eine Frage zu Ihren Notizen und ich werde versuchen, sie zu beantworten.',
  },
  it: {
    pronous: [
      'mio',
      'mia',
      'miei',
      'mie',
      'noi',
      'nostro',
      'nostri',
      'nostra',
      'nostre',
    ],
    prompt: 'Sulla base degli appunti',
    initial_message:
      'Ciao, sono ChatGPT e ho accesso ai tuoi appunti tramite Smart Connections. Fatemi una domanda sui vostri appunti e cercherò di rispondervi.',
  },
};

export const DEFAULT_SETTINGS: SmartConnectionSettings = {
  api_key: '',
  chat_open: true,
  file_exclusions: '',
  folder_exclusions: '',
  header_exclusions: '',
  path_only: '',
  show_full_path: false,
  expanded_view: true,
  group_nearest_by_file: false,
  language: 'en',
  log_render: false,
  log_render_files: false,
  recently_sent_retry_notice: false,
  skip_sections: false,
  smart_chat_model: 'gpt-3.5-turbo-16k',
  view_open: true,
  version: '',
};
export const MAX_EMBED_STRING_LENGTH = 25000;

export const SUPPORTED_FILE_TYPES = ['md', 'canvas'];
