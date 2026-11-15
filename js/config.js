/*
 * Purpose: App settings that are not data: where it stores, defaults for the window, the ticket and the device code.
 * Responsibilities: Hold constants only. Business data (name, phone) is a document (settings/business); per-device choices are preferences.
 */
window.NT = window.NT || {};

NT.config = {
  storageKey: "notas:v1",
  windowDays: 30,
  ticketWidth: 80,
  defaultDeviceCode: "A",
  fallbackLang: "es",
  defaultLang: "es",
  logBufferSize: 500,
  supabaseSqlEditor: "https://supabase.com/dashboard/project/{ref}/sql/new",
};
