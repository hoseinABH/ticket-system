import { api } from './api';

export interface Flight {
  id: string;
  flightNumber: string;
  origin: string;
  destination: string;
  departureTime: string;
  availableSeats: number;
  basePrice: string;
}

export interface FareQuotePayload {
  flightId: string;
  flightNumber: string;
  seatCount: number;
  totalPrice: string;
  expiresAt: number;
}

export interface FareQuoteResponse {
  quoteToken: string;
  quote: FareQuotePayload;
}

export interface Booking {
  id: string;
  userId: string;
  flightId: string;
  flightNumber: string;
  seatCount: number;
  totalPrice: string;
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED';
  createdAt: string;
}

export const flightService = {
  // Seed sample flights if database is fresh
  seedFlights: async (): Promise<Flight[]> => {
    const res = await api.post<Flight[]>('/flights/seed');
    return res.data;
  },

  // Search flights by origin and destination
  searchFlights: async (origin: string, destination: string): Promise<Flight[]> => {
    const res = await api.get<Flight[]>('/flights/search', {
      params: { origin, destination },
    });
    return res.data;
  },

  // Lock in price for 15 minutes using Redis
  createFareQuote: async (flightId: string, seatCount: number): Promise<FareQuoteResponse> => {
    const res = await api.post<FareQuoteResponse>('/flights/quote', {
      flightId,
      seatCount,
    });
    return res.data;
  },

  // Finalize booking using the ephemeral quoteToken
  checkoutBooking: async (quoteToken: string): Promise<Booking> => {
    const res = await api.post<Booking>('/bookings/checkout', { quoteToken });
    return res.data;
  },

  // Get user's booked flights
  getMyBookings: async (): Promise<Booking[]> => {
    const res = await api.get<Booking[]>('/bookings/my-bookings');
    return res.data;
  },
};
