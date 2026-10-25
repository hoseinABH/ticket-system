CREATE TYPE "bookings"."booking_status" AS ENUM('CONFIRMED', 'CANCELLED');--> statement-breakpoint
ALTER TABLE "bookings"."bookings" ALTER COLUMN "status" SET DATA TYPE "bookings"."booking_status" USING "status"::"bookings"."booking_status";--> statement-breakpoint
ALTER TABLE "bookings"."bookings" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings"."bookings" ADD CONSTRAINT "bookings_seat_count_positive" CHECK ("bookings"."bookings"."seat_count" > 0);--> statement-breakpoint
ALTER TABLE "bookings"."bookings" ADD CONSTRAINT "bookings_cancelled_at_matches_status" CHECK (("bookings"."bookings"."status" = 'CANCELLED') = ("bookings"."bookings"."cancelled_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "flights"."flights" ADD CONSTRAINT "flights_available_seats_non_negative" CHECK ("flights"."flights"."available_seats" >= 0);