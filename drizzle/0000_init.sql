CREATE SCHEMA "auth";
--> statement-breakpoint
CREATE SCHEMA "bookings";
--> statement-breakpoint
CREATE SCHEMA "flights";
--> statement-breakpoint
CREATE TABLE "bookings"."bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"flight_id" uuid NOT NULL,
	"pnr" varchar(8) NOT NULL,
	"seat_count" integer NOT NULL,
	"total_locked_price" numeric(10, 2) NOT NULL,
	"status" varchar(20) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_pnr_unique" UNIQUE("pnr")
);
--> statement-breakpoint
CREATE TABLE "flights"."flights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flight_number" varchar(16) NOT NULL,
	"origin" varchar(3) NOT NULL,
	"destination" varchar(3) NOT NULL,
	"departure_time" timestamp NOT NULL,
	"available_seats" integer NOT NULL,
	"base_price" numeric(10, 2) NOT NULL,
	CONSTRAINT "flights_flight_number_unique" UNIQUE("flight_number")
);
--> statement-breakpoint
CREATE TABLE "auth"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
