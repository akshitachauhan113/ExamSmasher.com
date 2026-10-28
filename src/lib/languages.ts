export interface LanguageOption {
  /** BCP-47 code used in the UI and for transcript lookup. */
  code: string;
  label: string;
  /** Value sent to YouTube's `relevanceLanguage` parameter. */
  yt: string;
  /** Extra hint appended to the search query (rarely needed). */
  queryHint?: string;
  /** Extra instruction given to the AI when ranking videos. */
  rankingHint?: string;
}

export const LANGUAGES: LanguageOption[] = [
  {
    code: "en",
    label: "English",
    yt: "en",
    rankingHint: "Prefer clearly spoken, well-structured English narration.",
  },
  {
    code: "hi",
    label: "Hindi",
    yt: "hi",
    rankingHint: "Prefer videos explained in Hindi (भाषा: हिन्दी).",
  },
  {
    code: "hinglish",
    label: "Hinglish (Hindi + English)",
    yt: "hi",
    rankingHint:
      "Prefer Hinglish videos - the speaker mixes Hindi and English, which is common in Indian edu channels.",
  },
  {
    code: "ur",
    label: "Urdu",
    yt: "ur",
    rankingHint: "Prefer videos explained in Urdu.",
  },
  {
    code: "bn",
    label: "Bengali",
    yt: "bn",
    rankingHint: "Prefer videos explained in Bengali.",
  },
  {
    code: "ta",
    label: "Tamil",
    yt: "ta",
    rankingHint: "Prefer videos explained in Tamil.",
  },
  {
    code: "te",
    label: "Telugu",
    yt: "te",
    rankingHint: "Prefer videos explained in Telugu.",
  },
  {
    code: "es",
    label: "Spanish",
    yt: "es",
    rankingHint: "Prefer videos explained in Spanish (Español).",
  },
  {
    code: "fr",
    label: "French",
    yt: "fr",
    rankingHint: "Prefer videos explained in French (Français).",
  },
  {
    code: "de",
    label: "German",
    yt: "de",
    rankingHint: "Prefer videos explained in German (Deutsch).",
  },
  {
    code: "pt",
    label: "Portuguese",
    yt: "pt",
    rankingHint: "Prefer videos explained in Portuguese.",
  },
  {
    code: "ar",
    label: "Arabic",
    yt: "ar",
    rankingHint: "Prefer videos explained in Arabic.",
  },
  {
    code: "ja",
    label: "Japanese",
    yt: "ja",
    rankingHint: "Prefer videos explained in Japanese.",
  },
  {
    code: "zh",
    label: "Chinese (Mandarin)",
    yt: "zh-CN",
    rankingHint: "Prefer videos explained in Mandarin Chinese.",
  },
  {
    code: "ru",
    label: "Russian",
    yt: "ru",
    rankingHint: "Prefer videos explained in Russian.",
  },
  {
    code: "tr",
    label: "Turkish",
    yt: "tr",
    rankingHint: "Prefer videos explained in Turkish.",
  },
];

export function findLanguage(code: string): LanguageOption {
  return LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0];
}
