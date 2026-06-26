const ROOTS = {
  DASHBOARD: "/",
  AUTH: "/auth",
  SETTINGS: "/settings",
  VACANCIES: "/vacancies",
  RESUMES: "/resumes",
  TRENDS: "/trends",
  KEYWORDS: "/keywords",
} as const;

export const paths = {
  dashboard: {
    root: ROOTS.DASHBOARD,
  },
  vacancies: {
    root: ROOTS.VACANCIES,
  },
  trends: {
    root: ROOTS.TRENDS,
  },
  keywords: {
    root: ROOTS.KEYWORDS,
  },
  resumes: {
    root: ROOTS.RESUMES,
    new: `${ROOTS.RESUMES}/new`,
    generate: `${ROOTS.RESUMES}/generate`,
    byId: (id: string) => `${ROOTS.RESUMES}/${id}`,
    matches: (id: string) => `${ROOTS.RESUMES}/${id}/matches`,
  },
  auth: {
    root: ROOTS.AUTH,
    login: `${ROOTS.AUTH}/login`,
    signup: `${ROOTS.AUTH}/signup`,
    otp: `${ROOTS.AUTH}/otp`,
    forgotPassword: `${ROOTS.AUTH}/forgot-password`,
    resetPassword: `${ROOTS.AUTH}/reset-password`,
  },
  settings: {
    root: ROOTS.SETTINGS,
    profile: `${ROOTS.SETTINGS}/profile`,
    appearance: `${ROOTS.SETTINGS}/appearance`,
    notifications: `${ROOTS.SETTINGS}/notifications`,
    display: `${ROOTS.SETTINGS}/display`,
  },
} as const;
