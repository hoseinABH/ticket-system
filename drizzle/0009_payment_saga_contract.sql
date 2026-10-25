ALTER TABLE "bookings"."idempotency_keys" ALTER COLUMN "booking_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings"."idempotency_keys" DROP COLUMN "response";