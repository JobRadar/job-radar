/** Зарплатная вилка с hh.ru */
export interface HhSalary {
  from: number | null;
  to: number | null;
  /** ISO 4217: RUR, USD, EUR и т.д. */
  currency: string;
  /** true — зарплата до вычета налогов */
  gross: boolean;
}

/** Допустимые значения фильтра work_format на hh.ru */
export type WorkFormat = "REMOTE" | "OFFICE" | "HYBRID" | "FIELD_WORK";

/** Параметры поискового запроса к hh.ru */
export interface HhSearchOptions {
  /** Текстовый запрос. Можно опустить, если задан professionalRoles */
  keyword?: string;
  /**
   * ID специализаций hh.ru (professional_role) — см. IT_PROFESSIONAL_ROLE_IDS.
   * Позволяет искать по всей IT-сфере без текстового запроса.
   */
  professionalRoles?: string[];
  /** Код региона hh.ru. 113 = вся Россия, 1 = Москва, 2 = СПб */
  area?: number;
  salaryFrom?: number;
  salaryTo?: number;
  /** noExperience | between1And3 | between3And6 | moreThan6 */
  experience?: string;
  /** full | part | project | volunteer | probation */
  employment?: string;
  /**
   * Формат работы: REMOTE, OFFICE, HYBRID, FIELD_WORK.
   * Можно передать несколько значений — они объединятся через запятую
   * в параметре `work_format`. Если не указано — фильтр не применяется.
   */
  workFormat?: WorkFormat[];
  /** Максимальное число страниц выдачи (20 вакансий / стр). По умолчанию 5. */
  maxPages?: number;
  /**
   * Коллбек, вызываемый сразу после успешного парсинга каждой вакансии.
   * Позволяет сохранять вакансию в БД по одной, не накапливая весь массив.
   */
  onVacancy?: (vacancy: ScrapedVacancyDetails) => Promise<void>;
  /**
   * Проверка «уже видели эту вакансию раньше» (например, есть в БД).
   * Если возвращает true — страница вакансии повторно НЕ открывается
   * (экономим время и снижаем риск блокировки), вместо onVacancy вызывается
   * onDuplicateVacancy с данными из карточки выдачи.
   */
  isKnownVacancy?: (hhId: string) => Promise<boolean>;
  /**
   * Коллбек для уже известных вакансий (см. isKnownVacancy) — вызывается
   * вместо повторного скрапинга страницы вакансии. Обычно используется,
   * чтобы обновить lastSeenAt/isArchived без повторного парсинга.
   */
  onDuplicateVacancy?: (summary: ScrapedVacancySummary) => Promise<void>;
}

/** Краткая карточка вакансии — парсится со страницы поисковой выдачи */
export interface ScrapedVacancySummary {
  hhId: string;
  title: string;
  employerName: string | null;
  salary: HhSalary | null;
  area: string | null;
  url: string;
  publishedAt: Date | null;
}

/** Полные данные вакансии — дополняются после захода на страницу вакансии */
export interface ScrapedVacancyDetails extends ScrapedVacancySummary {
  /** Текстовое описание вакансии (без HTML, с сохранением структуры) */
  description: string | null;
  skills: string[];
  experience: string | null;
  employment: string | null;
  schedule: string | null;
  /** Форматы работы: офис / удалённо / гибрид и т.д. */
  hiringFormats: string[];
  employerLogoUrl: string | null;
  employerUrl: string | null;
}

/** Опции авторизации на hh.ru */
export interface HhAuthOptions {
  /** Путь к файлу хранения cookies. По умолчанию из конфига. */
  cookiesPath?: string;
  /** Учётные данные для первичной авторизации */
  credentials?: {
    email: string;
    password: string;
  };
}

/** Итог прогона скрапера */
export interface ScrapeResult {
  keyword: string;
  vacancies: ScrapedVacancyDetails[];
  pagesScraped: number;
  errors: string[];
  /**
   * Сколько вакансий из выдачи уже были известны (isKnownVacancy → true) —
   * их detail-страница повторно не открывалась.
   */
  duplicatesTouched: number;
}
