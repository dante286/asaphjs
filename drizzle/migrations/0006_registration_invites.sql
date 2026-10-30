CREATE TABLE "registration_invites" (
	"email" text PRIMARY KEY NOT NULL,
	"token" text,
	"invited_by" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "registration_invites_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "registration_invites" ADD CONSTRAINT "registration_invites_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;