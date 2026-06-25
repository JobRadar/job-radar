const ROOTS = {
  DASHBOARD: "/",
  AUTH: "/auth",
  SETTINGS: "/settings",
  VACANCIES: "/vacancies",
} as const;

export const paths = {
  dashboard: {
    root: ROOTS.DASHBOARD,
  },
  vacancies: {
    root: ROOTS.VACANCIES,
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
