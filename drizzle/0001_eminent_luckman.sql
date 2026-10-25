ALTER TABLE "bookings"."bookings" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings"."bookings" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "flights"."flights" ALTER COLUMN "departure_time" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth"."users" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth"."users" ALTER COLUMN "created_at" SET DEFAULT now();