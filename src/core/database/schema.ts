import { sql } from 'drizzle-orm';
import {
  check,
  pgSchema,
  uuid,
  varchar,
  timestamp,
  integer,
  numeric,
} from 'drizzle-orm/pg-core';
import { BOOKING_STATUSES } from '../../modules/bookings/domain/booking-status';

// 1. Auth Schema
export const authSchema = pgSchema('auth');
export const users = authSchema.table('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// 2. Flights Schema
export const flightsSchema = pgSchema('flights');
export const flights = flightsSchema.table(
  'flights',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    flightNumber: varchar('flight_number', { length: 16 }).notNull().unique(),
    origin: varchar('origin', { length: 3 }).notNull(), // e.g., 'THR'
    destination: varchar('destination', { length: 3 }).notNull(), // e.g., 'IST'
    departureTime: timestamp('departure_time', {
      withTimezone: true,
    }).notNull(),
    availableSeats: integer('available_seats').notNull(),
    basePrice: numeric('base_price', { precision: 10, scale: 2 }).notNull(),
  },
  (table) => [
    // Last line of defense against overselling, whatever the app code does
    check(
      'flights_available_seats_non_negative',
      sql`${table.availableSeats} >= 0`,
    ),
  ],
);

// 3. Bookings Schema
export const bookingsSchema = pgSchema('bookings');
export const bookingStatus = bookingsSchema.enum(
  'booking_status',
  BOOKING_STATUSES,
);
export const bookings = bookingsSchema.table(
  'bookings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull(), // Logical reference to auth.users
    flightId: uuid('flight_id').notNull(), // Logical reference to flights.flights
    pnr: varchar('pnr', { length: 8 }).notNull().unique(),
    seatCount: integer('seat_count').notNull(),
    totalLockedPrice: numeric('total_locked_price', {
      precision: 10,
      scale: 2,
    }).notNull(),
    status: bookingStatus('status').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  },
  (table) => [
    check('bookings_seat_count_positive', sql`${table.seatCount} > 0`),
    // A cancelled booking always records when, and only cancelled ones do
    check(
      'bookings_cancelled_at_matches_status',
      sql`(${table.status} = 'CANCELLED') = (${table.cancelledAt} IS NOT NULL)`,
    ),
  ],
);
