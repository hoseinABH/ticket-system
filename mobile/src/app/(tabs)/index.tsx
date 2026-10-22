import React from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Plane, AlertCircle } from 'lucide-react-native';
import { SearchFlightBox } from '../../components/SearchFlightBox';
import { FlightCard } from '../../components/FlightCard';
import { flightService, Flight } from '../../services/flightService';
import { useFlightStore } from '../../store/useFlightStore';
import { useAuthStore } from '../../store/useAuthStore';

export default function FlightsTab() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { origin, destination, seatCount, setSelectedFlight, setActiveQuote } =
    useFlightStore();
  const { token } = useAuthStore();

  // Search flights query
  const {
    data: flights = [],
    isLoading,
    isRefetching,
    refetch,
    error,
  } = useQuery({
    queryKey: ['flights', origin, destination],
    queryFn: () => flightService.searchFlights(origin, destination),
  });

  // Seed flights mutation
  const seedMutation = useMutation({
    mutationFn: flightService.seedFlights,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['flights'] });
      Alert.alert(
        'Flights Seeded',
        `Successfully loaded ${data.length} flights into PostgreSQL!`
      );
    },
    onError: (err: any) => {
      Alert.alert(
        'Seeding Failed',
        err.response?.data?.message || err.message || 'Check database connection'
      );
    },
  });

  // Fare quote mutation (Locks price in Redis for 15 minutes)
  const quoteMutation = useMutation({
    mutationFn: (flight: Flight) =>
      flightService.createFareQuote(flight.id, seatCount),
    onSuccess: (data, flight) => {
      setSelectedFlight(flight);
      setActiveQuote(data);
      router.push('/quote-modal');
    },
    onError: (err: any) => {
      Alert.alert(
        'Quote Error',
        err.response?.data?.message || 'Could not lock fare. Please retry.'
      );
    },
  });

  const handleSelectFlight = (flight: Flight) => {
    if (!token) {
      Alert.alert(
        'Sign In Required',
        'Please sign in to lock your fare quote and book this flight.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Sign In', onPress: () => router.push('/auth-modal') },
        ]
      );
      return;
    }
    quoteMutation.mutate(flight);
  };

  return (
    <SafeAreaView className="flex-1 bg-navy-950">
      <ScrollView
        className="flex-1 px-4 pt-3"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => {
              void refetch();
            }}
            tintColor="#22D3EE"
          />
        }
      >
        {/* Top Header */}
        <View className="flex-row items-center justify-between pb-4">
          <View>
            <Text className="text-xs font-bold uppercase tracking-widest text-cyan-400">
              Midnight Airways
            </Text>
            <Text className="text-2xl font-black text-white tracking-tight mt-0.5">
              Book Your Flight
            </Text>
          </View>

          <View className="w-10 h-10 rounded-full bg-navy-800 border border-slate-700/60 items-center justify-center">
            <Plane size={18} color="#22D3EE" />
          </View>
        </View>

        {/* Search Flight Box */}
        <SearchFlightBox
          onSearch={() => refetch()}
          onSeed={() => seedMutation.mutate()}
          isSeeding={seedMutation.isPending}
        />

        {/* Available Flights Section */}
        <View className="mt-7 mb-10">
          <View className="flex-row items-center justify-between mb-4">
            <Text className="text-base font-black text-white tracking-wide">
              Available Departures
            </Text>
            <Text className="text-xs font-semibold text-slate-400">
              {flights.length} {flights.length === 1 ? 'Flight' : 'Flights'} Found
            </Text>
          </View>

          {/* Loading Indicator */}
          {(isLoading || quoteMutation.isPending) && (
            <View className="py-12 items-center justify-center">
              <ActivityIndicator size="large" color="#22D3EE" />
              <Text className="text-xs text-slate-400 font-medium mt-3">
                {quoteMutation.isPending
                  ? 'Locking 15-minute fare quote in Redis...'
                  : 'Searching available routes...'}
              </Text>
            </View>
          )}

          {/* Error State */}
          {error && !isLoading && (
            <View className="rounded-2xl bg-rose-500/10 border border-rose-500/20 p-4 flex-row items-center space-x-3 mb-4">
              <AlertCircle size={20} color="#F43F5E" />
              <View className="flex-1">
                <Text className="text-xs font-bold text-rose-300">
                  Connection Error
                </Text>
                <Text className="text-[11px] text-rose-200/80 mt-0.5">
                  Make sure backend is running on port 3000.
                </Text>
              </View>
            </View>
          )}

          {/* Empty State */}
          {!isLoading && flights.length === 0 && !error && (
            <View className="py-10 items-center justify-center rounded-2xl bg-navy-850/50 border border-slate-800/60 p-6">
              <Plane size={32} color="#64748B" />
              <Text className="text-sm font-bold text-slate-300 mt-3 text-center">
                No flights between {origin} and {destination}
              </Text>
              <Text className="text-xs text-slate-500 mt-1 text-center">
                Tap "Seed Sample Test Flights" above to populate routes.
              </Text>
            </View>
          )}

          {/* Flights List */}
          {!isLoading &&
            flights.map((flight) => (
              <FlightCard
                key={flight.id}
                flight={flight}
                onSelect={handleSelectFlight}
              />
            ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
