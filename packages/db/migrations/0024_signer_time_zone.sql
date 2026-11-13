-- Each signer's own time zone, recorded when they sign: their device's setting, or the zone of
-- their IP address when the device does not say. Signature stamps and the certificate show that
-- person's signing time in it. Older rows stay null and keep the request's zone.
ALTER TABLE "request_recipients" ADD COLUMN "time_zone" text;
ALTER TABLE "request_recipients" ADD COLUMN "time_zone_source" text;
ALTER TABLE "request_recipients" ADD CONSTRAINT "request_recipients_time_zone_source_chk"
  CHECK ("time_zone_source" IS NULL OR "time_zone_source" IN ('device', 'ip'));
