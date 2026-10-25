ALTER TYPE "bookings"."booking_status" ADD VALUE 'PENDING_PAYMENT' BEFORE 'CONFIRMED';--> statement-breakpoint
ALTER TYPE "bookings"."booking_status" ADD VALUE 'PAYMENT_FAILED' BEFORE 'CANCELLED';--> statement-breakpoint
ALTER TABLE "bookings"."bookings" ADD COLUMN "payment_id" varchar(64);--> statement-breakpoint
ALTER TABLE "bookings"."idempotency_keys" ADD COLUMN "booking_id" uuid;--> statement-breakpoint
-- Expand step, hand-written: copy the booking ID out of the stored response.
-- The next migration (contract) drops the response column.
UPDATE "bookings"."idempotency_keys" SET "booking_id" = ("response"->>'id')::uuid;--> statement-breakpoint
CREATE INDEX "bookings_status_created_at_idx" ON "bookings"."bookings" USING btree ("status","created_at");--> statement-breakpoint
ALTER TABLE "bookings"."bookings" ADD CONSTRAINT "bookings_confirmed_has_payment" CHECK ("bookings"."bookings"."status" <> 'CONFIRMED' OR "bookings"."bookings"."payment_id" IS NOT NULL) NOT VALID;
-- NOT VALID (hand-added): bookings confirmed before payments existed have no
-- payment_id. The rule is enforced for every new or updated row from now on
-- without failing on that history.