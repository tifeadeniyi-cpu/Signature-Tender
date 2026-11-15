CREATE TABLE "document_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"request_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_claims" ADD CONSTRAINT "document_claims_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_claims" ADD CONSTRAINT "document_claims_request_id_signing_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."signing_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_claims" ADD CONSTRAINT "document_claims_recipient_id_request_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."request_recipients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_claims" ADD CONSTRAINT "document_claims_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_claims_user_request_uq" ON "document_claims" USING btree ("user_id","request_id");--> statement-breakpoint
CREATE INDEX "document_claims_request_idx" ON "document_claims" USING btree ("request_id");