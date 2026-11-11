export const OWNER_URL =
  process.env.TEST_DATABASE_URL_OWNER ??
  'postgres://st_owner:st_owner@localhost:5432/signature_tender_test';
export const APP_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://st_app:st_app@localhost:5432/signature_tender_test';
