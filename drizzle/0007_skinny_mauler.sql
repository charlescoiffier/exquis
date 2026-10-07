CREATE TABLE "friendship" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requester_id" text NOT NULL,
	"addressee_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "friendship_pair" UNIQUE("requester_id","addressee_id")
);
--> statement-breakpoint
CREATE TABLE "game_invitation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"invited_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "game_invitation_once" UNIQUE("game_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "notification" ALTER COLUMN "game_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "comment" ADD COLUMN "hidden_at" timestamp;--> statement-breakpoint
ALTER TABLE "game" ADD COLUMN "hidden_at" timestamp;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "actor_id" text;--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN "friend_code" text;--> statement-breakpoint
ALTER TABLE "report" ADD COLUMN "details" text;--> statement-breakpoint
ALTER TABLE "report" ADD COLUMN "resolved_by" text;--> statement-breakpoint
ALTER TABLE "report" ADD COLUMN "resolved_at" timestamp;--> statement-breakpoint
ALTER TABLE "friendship" ADD CONSTRAINT "friendship_requester_id_user_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendship" ADD CONSTRAINT "friendship_addressee_id_user_id_fk" FOREIGN KEY ("addressee_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_invitation" ADD CONSTRAINT "game_invitation_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_invitation" ADD CONSTRAINT "game_invitation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_invitation" ADD CONSTRAINT "game_invitation_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "friendship_addressee_idx" ON "friendship" USING btree ("addressee_id","status");--> statement-breakpoint
CREATE INDEX "game_invitation_user_idx" ON "game_invitation" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_status_idx" ON "report" USING btree ("status","created_at");--> statement-breakpoint
ALTER TABLE "profile" ADD CONSTRAINT "profile_friend_code_unique" UNIQUE("friend_code");--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_once" UNIQUE("reporter_id","target_type","target_id");