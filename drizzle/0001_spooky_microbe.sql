CREATE TABLE "save_rate_limit" (
	"user_id" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"window_start" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "save_rate_limit" ADD CONSTRAINT "save_rate_limit_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;