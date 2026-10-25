CREATE SCHEMA "notifications";
--> statement-breakpoint
CREATE SCHEMA "outbox";
--> statement-breakpoint
CREATE TABLE "notifications"."notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"type" varchar(100) NOT NULL,
	"user_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_message_id_unique" UNIQUE("message_id")
);
--> statement-breakpoint
CREATE TABLE "outbox"."messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" varchar(100) NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "outbox_messages_unpublished_idx" ON "outbox"."messages" USING btree ("created_at") WHERE "outbox"."messages"."published_at" IS NULL;