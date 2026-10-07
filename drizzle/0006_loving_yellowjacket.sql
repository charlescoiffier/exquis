ALTER TABLE "profile" ADD COLUMN "reminder_stage" integer DEFAULT 25 NOT NULL;--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN "avatar_shape" text;--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN "avatar_color" text;--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN "avatar_bg" text;