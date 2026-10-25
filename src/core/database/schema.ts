import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgSchema,
  uuid,
  varchar,
  timestamp,
  integer,
  numeric,
  unique,
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
export const flights = flightsSchema.table('flights', {
  id: uuid('id').defaultRandom().primaryKey(),
  flightNumber: varchar('flight_number', { length: 16 }).notNull().unique(),
  origin: varchar('origin', { length: 3 }).notNull(), // e.g., 'THR'
  destination: varchar('destination', { length: 3 }).notNull(), // e.g., 'IST'
  departureTime: timestamp('departure_time', { withTimezone: true }).notNull(),
  basePrice: numeric('base_price', { precision: 10, scale: 2 }).notNull(),
});

// One row per physical seat. Availability is derived from these rows rather
// than kept in a separate counter that could drift out of sync.
export const seats = flightsSchema.table(
  'seats',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    flightId: uuid('flight_id')
      .notNull()
      .references(() => flights.id, { onDelete: 'cascade' }),
    seatNumber: varchar('seat_number', { length: 3 }).notNull(), // e.g., '12A'
    bookingId: uuid('booking_id'), // Logical reference to bookings.bookings; NULL = free
  },
  (table) => [
    unique('seats_flight_id_seat_number_unique').on(
      table.flightId,
      table.seatNumber,
    ),
    // Cancellation and "my bookings" look seats up by booking
    index('seats_booking_id_idx').on(table.bookingId),
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
