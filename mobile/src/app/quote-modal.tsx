import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  X,
  Clock,
  Plane,
  ShieldCheck,
  CheckCircle2,
  Users,
  CreditCard,
} from 'lucide-react-native';
import { useFlightStore } from '../store/useFlightStore';
import { flightService } from '../services/flightService';

export default function QuoteModal() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { activeQuote, selectedFlight, setActiveQuote } = useFlightStore();
  const [timeLeft, setTimeLeft] = useState<number>(900); // 15 mins default
  const [isSuccess, setIsSuccess] = useState(false);

  // Real-time countdown for Redis TTL
  useEffect(() => {
    if (!activeQuote) return;

    const calculateRemaining = () => {
      const remainingSeconds = Math.max(
        0,
        Math.floor((activeQuote.quote.expiresAt - Date.now()) / 1000)
      );
      setTimeLeft(remainingSeconds);
      if (remainingSeconds <= 0) {
        Alert.alert(
          'Fare Quote Expired',
          'Your 15-minute locked price in Redis has expired. Please select the flight again.',
          [{ text: 'OK', onPress: () => router.back() }]
        );
      }
    };

    calculateRemaining();
    const interval = setInterval(calculateRemaining, 1000);
    return () => clearInterval(interval);
  }, [activeQuote, router]);

  // Checkout mutation
  const checkoutMutation = useMutation({
    mutationFn: () =>
      flightService.checkoutBooking(activeQuote!.quoteToken),
    onSuccess: () => {
      setIsSuccess(true);
      queryClient.invalidateQueries({ queryKey: ['my-bookings'] });
      queryClient.invalidateQueries({ queryKey: ['flights'] });
      setTimeout(() => {
        setActiveQuote(null);
        router.dismiss();
        router.push('/(tabs)/bookings');
      }, 1400);
    },
    onError: (err: any) => {
      Alert.alert(
        'Checkout Failed',
        err.response?.data?.message || 'Could not complete booking'
      );
    },
  });

  const formatCountdown = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  if (!activeQuote) {
    return (
      <SafeAreaView className="flex-1 bg-navy-950 items-center justify-center p-6">
        <Text className="text-sm text-slate-400">No active fare quote.</Text>
        <TouchableOpacity
          onPress={() => router.back()}
          className="mt-4 px-5 py-2.5 rounded-xl bg-slate-800"
        >
          <Text className="text-xs font-bold text-white">Go Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const { quote } = activeQuote;

  return (
    <SafeAreaView className="flex-1 bg-navy-950">
      <View className="flex-1 px-5 pt-3">
        {/* Modal Top Bar */}
        <View className="flex-row items-center justify-between pb-4 border-b border-slate-800/80">
          <View className="flex-row items-center gap-x-2">
            <View className="w-8 h-8 rounded-full bg-cyan-500/15 border border-cyan-400/30 items-center justify-center">
              <Plane size={16} color="#22D3EE" />
            </View>
            <Text className="text-base font-black text-white">
              Fare Lock Guarantee
            </Text>
          </View>

          <TouchableOpacity
            onPress={() => router.back()}
            className="w-8 h-8 rounded-full bg-slate-800 items-center justify-center"
          >
            <X size={16} color="#94A3B8" />
          </TouchableOpacity>
        </View>

        {/* Live Redis Lock Banner */}
        <View className="mt-4 rounded-2xl bg-amber-500/10 border border-amber-500/25 p-3.5 flex-row items-center justify-between">
          <View className="flex-row items-center gap-x-2.5">
            <Clock size={18} color="#FBBF24" />
            <View>
              <Text className="text-xs font-bold text-amber-300">
                Price Locked in Redis
              </Text>
              <Text className="text-[11px] text-amber-200/70">
                Guaranteed seat price holds for:
              </Text>
            </View>
          </View>

          <View className="px-3 py-1.5 rounded-xl bg-amber-500/20 border border-amber-500/40">
            <Text className="text-sm font-black font-mono text-amber-400">
              {formatCountdown(timeLeft)}
            </Text>
          </View>
        </View>

        {/* Flight Summary Card */}
        <View className="mt-5 rounded-3xl bg-navy-850 border border-slate-800 p-5">
          <View className="flex-row items-center justify-between pb-3 border-b border-slate-800">
            <View>
              <Text className="text-xs font-bold text-cyan-400">
                {quote.flightNumber}
              </Text>
              <Text className="text-sm font-black text-white mt-0.5">
                {selectedFlight?.origin || 'THR'} → {selectedFlight?.destination || 'IST'}
              </Text>
            </View>
            <View className="flex-row items-center gap-x-1 px-2.5 py-1 rounded-full bg-slate-800">
              <Users size={12} color="#94A3B8" />
              <Text className="text-xs font-semibold text-slate-200">
                {quote.seatCount} {quote.seatCount === 1 ? 'Passenger' : 'Passengers'}
              </Text>
            </View>
          </View>

          {/* Pricing breakdown */}
          <View className="mt-4 gap-y-2.5">
            <View className="flex-row items-center justify-between">
              <Text className="text-xs text-slate-400">Base Fare per Seat</Text>
              <Text className="text-xs font-semibold text-slate-200">
                ${(parseFloat(quote.totalPrice) / quote.seatCount).toFixed(2)}
              </Text>
            </View>

            <View className="flex-row items-center justify-between">
              <Text className="text-xs text-slate-400">Seat Quantity</Text>
              <Text className="text-xs font-semibold text-slate-200">
                × {quote.seatCount}
              </Text>
            </View>

            <View className="flex-row items-center justify-between">
              <Text className="text-xs text-slate-400">Taxes & Airport Surcharges</Text>
              <Text className="text-xs font-semibold text-emerald-400">
                Included ($0.00)
              </Text>
            </View>

            <View className="pt-3 border-t border-slate-800 flex-row items-center justify-between">
              <Text className="text-sm font-bold text-white">Total Guaranteed</Text>
              <Text className="text-2xl font-black text-amber-400">
                ${parseFloat(quote.totalPrice).toFixed(2)}
              </Text>
            </View>
          </View>
        </View>

        {/* Security badge */}
        <View className="mt-4 flex-row items-center gap-x-2 px-2">
          <ShieldCheck size={16} color="#34D399" />
          <Text className="text-xs text-slate-400">
            Atomic Redis single-use quote token protects against replay attacks.
          </Text>
        </View>

        {/* Spacer */}
        <View className="flex-1" />

        {/* Success or Action Button */}
        {isSuccess ? (
          <View className="mb-6 p-4 rounded-2xl bg-emerald-500/20 border border-emerald-400/40 flex-row items-center justify-center gap-x-2">
            <CheckCircle2 size={20} color="#34D399" />
            <Text className="text-sm font-black text-emerald-400">
              Booking Confirmed! Generating Pass...
            </Text>
          </View>
        ) : (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => checkoutMutation.mutate()}
            disabled={checkoutMutation.isPending || timeLeft <= 0}
            className={`mb-6 w-full py-4 rounded-2xl flex-row items-center justify-center gap-x-2 shadow-xl ${
              checkoutMutation.isPending
                ? 'bg-slate-700'
                : 'bg-cyan-500 shadow-cyan-500/30'
            }`}
          >
            {checkoutMutation.isPending ? (
              <ActivityIndicator color="#070B14" />
            ) : (
              <>
                <CreditCard size={18} color="#070B14" strokeWidth={2.5} />
                <Text className="text-sm font-black text-navy-950 uppercase tracking-wider">
                  Confirm & Book · ${parseFloat(quote.totalPrice).toFixed(2)}
                </Text>
              </>
            )}
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}
