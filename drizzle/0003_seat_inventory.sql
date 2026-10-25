CREATE TABLE "flights"."seats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flight_id" uuid NOT NULL,
	"seat_number" varchar(3) NOT NULL,
	"booking_id" uuid,
	CONSTRAINT "seats_flight_id_seat_number_unique" UNIQUE("flight_id","seat_number")
);
--> statement-breakpoint
ALTER TABLE "flights"."seats" ADD CONSTRAINT "seats_flight_id_flights_id_fk" FOREIGN KEY ("flight_id") REFERENCES "flights"."flights"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "seats_booking_id_idx" ON "flights"."seats" USING btree ("booking_id");--> statement-breakpoint
-- Hand-written backfill (drizzle-kit only generates schema changes).
-- 1. Give every existing flight one seat per unit of capacity, where
--    capacity = seats still available + seats held by confirmed bookings.
--    Seat i (0-based) is row i/6+1, letter A-F, matching generateSeatNumbers().
INSERT INTO "flights"."seats" ("flight_id", "seat_number")
SELECT f."id", (s.i / 6 + 1)::text || chr(65 + s.i % 6)
FROM "flights"."flights" f
CROSS JOIN LATERAL generate_series(
	0,
	f."available_seats" + COALESCE((
		SELECT sum(b."seat_count")
		FROM "bookings"."bookings" b
		WHERE b."flight_id" = f."id" AND b."status" = 'CONFIRMED'
	), 0)::int - 1 -- sum() returns bigint, and chr() only accepts int
) AS s(i);--> statement-breakpoint
-- 2. Hand the front seats to existing confirmed bookings, oldest booking
--    first: number each booking's seat slots and each flight's seats per
--    flight, then match slot n to seat n.
WITH booking_slots AS (
	SELECT b."id" AS booking_id, b."flight_id",
		row_number() OVER (PARTITION BY b."flight_id" ORDER BY b."created_at", b."id", g.n) AS slot
	FROM "bookings"."bookings" b
	CROSS JOIN LATERAL generate_series(1, b."seat_count") AS g(n)
	WHERE b."status" = 'CONFIRMED'
), numbered_seats AS (
	SELECT s."id", s."flight_id",
		row_number() OVER (PARTITION BY s."flight_id" ORDER BY length(s."seat_number"), s."seat_number") AS slot
	FROM "flights"."seats" s
)
UPDATE "flights"."seats" AS seat
SET "booking_id" = bs.booking_id
FROM numbered_seats ns
JOIN booking_slots bs ON bs."flight_id" = ns."flight_id" AND bs.slot = ns.slot
WHERE seat."id" = ns."id";--> statement-breakpoint
-- 3. Only now drop the counter the backfill read from
ALTER TABLE "flights"."flights" DROP CONSTRAINT "flights_available_seats_non_negative";--> statement-breakpoint
ALTER TABLE "flights"."flights" DROP COLUMN "available_seats";
