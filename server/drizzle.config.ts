import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/core/database/schema.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url:
      process.env.DATABASE_URL ||
      'postgresql://root:secret@localhost:5432/ticket_system',
  },
  schemaFilter: ['auth', 'flights', 'bookings'],
});
