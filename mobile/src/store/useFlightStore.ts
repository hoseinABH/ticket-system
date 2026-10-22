import { create } from 'zustand';
import { FareQuoteResponse, Flight } from '../services/flightService';

interface FlightState {
  origin: string;
  destination: string;
  seatCount: number;
  selectedFlight: Flight | null;
  activeQuote: FareQuoteResponse | null;
  setOrigin: (origin: string) => void;
  setDestination: (destination: string) => void;
  setSeatCount: (seats: number) => void;
  setSelectedFlight: (flight: Flight | null) => void;
  setActiveQuote: (quote: FareQuoteResponse | null) => void;
  swapAirports: () => void;
}

export const useFlightStore = create<FlightState>((set, get) => ({
  origin: 'THR',
  destination: 'IST',
  seatCount: 1,
  selectedFlight: null,
  activeQuote: null,

  setOrigin: (origin: string) => set({ origin }),
  setDestination: (destination: string) => set({ destination }),
  setSeatCount: (seatCount: number) => set({ seatCount }),
  setSelectedFlight: (selectedFlight: Flight | null) => set({ selectedFlight }),
  setActiveQuote: (activeQuote: FareQuoteResponse | null) => set({ activeQuote }),

  swapAirports: () => {
    const { origin, destination } = get();
    set({ origin: destination, destination: origin });
  },
}));
