// Paste your deployed Web App URL here (must end in /exec, not /dev).
// Deploy → New deployment → Web app → Execute as: Me → Who has access: Anyone
export const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz2CjFTuoVZn4P4Y2BVZBUeMrA30RR7dFqfMlZkHVvgSU4L3liSJbvEUgk3T6CCviOI/exec';

export const SHEET_ID = '1hP3GiaeaMfaokbmm9nJDy8T9ZtF_y7oaljRZgxuX-48';

export function isAppsScriptConfigured() {
  return (
    APPS_SCRIPT_URL &&
    !APPS_SCRIPT_URL.includes('YOUR_ID') &&
    APPS_SCRIPT_URL.includes('script.google.com/macros/s/') &&
    APPS_SCRIPT_URL.endsWith('/exec')
  );
}
