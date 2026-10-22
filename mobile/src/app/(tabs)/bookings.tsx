import React from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Ticket, LogIn, PlaneTakeoff } from 'lucide-react-native';
import { BoardingPassCard } from '../../components/BoardingPassCard';
import { flightService } from '../../services/flightService';
import { useAuthStore } from '../../store/useAuthStore';

export default function BookingsTab() {
  const router = useRouter();
  const { token } = useAuthStore();

  const {
    data: bookings = [],
    isLoading,
    isRefetching,
    refetch,
    error,
  } = useQuery({
    queryKey: ['my-bookings'],
    queryFn: flightService.getMyBookings,
    enabled: !!token,
  });

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
        {/* Header */}
        <View className="flex-row items-center justify-between pb-5">
          <View>
            <Text className="text-xs font-bold uppercase tracking-widest text-cyan-400">
              Passes & Itineraries
            </Text>
            <Text className="text-2xl font-black text-white tracking-tight mt-0.5">
              My Boarding Passes
            </Text>
          </View>
          <View className="w-10 h-10 rounded-full bg-navy-800 border border-slate-700/60 items-center justify-center">
            <Ticket size={18} color="#22D3EE" />
          </View>
        </View>

        {/* Not Logged In State */}
        {!token && (
          <View className="mt-8 p-8 rounded-3xl bg-navy-850 border border-slate-800 items-center text-center">
            <View className="w-16 h-16 rounded-full bg-cyan-500/10 border border-cyan-500/20 items-center justify-center mb-4">
              <LogIn size={28} color="#22D3EE" />
            </View>
            <Text className="text-lg font-black text-white text-center">
              Sign In to View Passes
            </Text>
            <Text className="text-xs text-slate-400 text-center mt-1.5 leading-relaxed max-w-[260px]">
              Access your digital boarding passes, flight status, and itinerary details.
            </Text>
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => router.push('/auth-modal')}
              className="mt-6 px-7 py-3.5 rounded-2xl bg-cyan-500 flex-row items-center space-x-2 shadow-lg shadow-cyan-500/30"
            >
              <Text className="text-xs font-black text-navy-950 uppercase tracking-wider">
                Sign In / Register
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Loading State */}
        {token && isLoading && (
          <View className="py-20 items-center justify-center">
            <ActivityIndicator size="large" color="#22D3EE" />
            <Text className="text-xs text-slate-400 font-medium mt-3">
              Retrieving your confirmed bookings...
            </Text>
          </View>
        )}

        {/* Empty State */}
        {token && !isLoading && bookings.length === 0 && (
          <View className="mt-8 p-8 rounded-3xl bg-navy-850/60 border border-slate-800/80 items-center text-center">
            <View className="w-16 h-16 rounded-full bg-slate-800 items-center justify-center mb-4">
              <PlaneTakeoff size={28} color="#64748B" />
            </View>
            <Text className="text-base font-bold text-slate-200 text-center">
              No Boarding Passes Yet
            </Text>
            <Text className="text-xs text-slate-400 text-center mt-1 max-w-[240px]">
              You don't have any booked flights. Search available flights to get started!
            </Text>
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => router.push('/')}
              className="mt-5 px-6 py-3 rounded-xl bg-slate-800 border border-slate-700/80"
            >
              <Text className="text-xs font-bold text-cyan-400">
                Explore Flights
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Bookings List */}
        {token &&
          !isLoading &&
          bookings.map((booking) => (
            <BoardingPassCard key={booking.id} booking={booking} />
          ))}

        <View className="h-10" />
      </ScrollView>
    </SafeAreaView>
  );
}
