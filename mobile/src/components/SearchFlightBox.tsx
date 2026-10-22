import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { ArrowRightLeft, Users, Search, Sparkles } from 'lucide-react-native';
import { useFlightStore } from '../store/useFlightStore';

interface SearchFlightBoxProps {
  onSearch: () => void;
  onSeed: () => void;
  isSeeding?: boolean;
}

export const SearchFlightBox: React.FC<SearchFlightBoxProps> = ({
  onSearch,
  onSeed,
  isSeeding,
}) => {
  const { origin, destination, seatCount, setSeatCount, swapAirports } =
    useFlightStore();

  return (
    <View className="rounded-3xl bg-navy-850/90 border border-slate-800 p-5 shadow-2xl shadow-black/80">
      {/* Airport Origin & Destination with Swap */}
      <View className="relative">
        <View className="space-y-3">
          {/* Origin */}
          <View className="rounded-2xl bg-navy-900 border border-slate-800 p-3.5 pl-4">
            <Text className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
              From
            </Text>
            <View className="flex-row items-center justify-between mt-1">
              <Text className="text-xl font-black text-white">{origin}</Text>
              <Text className="text-xs text-slate-400 font-medium">
                {origin === 'THR' ? 'Tehran Intl (IKA)' : 'Departure City'}
              </Text>
            </View>
          </View>

          {/* Destination */}
          <View className="rounded-2xl bg-navy-900 border border-slate-800 p-3.5 pl-4">
            <Text className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
              To
            </Text>
            <View className="flex-row items-center justify-between mt-1">
              <Text className="text-xl font-black text-white">{destination}</Text>
              <Text className="text-xs text-slate-400 font-medium">
                {destination === 'IST' ? 'Istanbul Airport' : 'Arrival City'}
              </Text>
            </View>
          </View>
        </View>

        {/* Swap Button in center */}
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={swapAirports}
          className="absolute right-6 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-cyan-500 items-center justify-center shadow-md shadow-cyan-500/40 border-2 border-navy-850"
        >
          <ArrowRightLeft size={16} color="#070B14" strokeWidth={2.5} />
        </TouchableOpacity>
      </View>

      {/* Passengers & Seat Counter */}
      <View className="mt-4 pt-3 border-t border-slate-800/80 flex-row items-center justify-between">
        <View className="flex-row items-center space-x-2">
          <View className="w-8 h-8 rounded-lg bg-slate-800 items-center justify-center">
            <Users size={16} color="#94A3B8" />
          </View>
          <View>
            <Text className="text-xs font-bold text-slate-200">Passengers</Text>
            <Text className="text-[11px] text-slate-400">Seats to quote</Text>
          </View>
        </View>

        {/* Counter Buttons */}
        <View className="flex-row items-center space-x-2 bg-navy-900 rounded-xl p-1 border border-slate-800">
          <TouchableOpacity
            disabled={seatCount <= 1}
            onPress={() => setSeatCount(Math.max(1, seatCount - 1))}
            className={`w-7 h-7 rounded-lg items-center justify-center ${
              seatCount <= 1 ? 'opacity-30' : 'bg-slate-800'
            }`}
          >
            <Text className="text-sm font-black text-white">-</Text>
          </TouchableOpacity>

          <Text className="w-6 text-center text-sm font-bold text-cyan-400">
            {seatCount}
          </Text>

          <TouchableOpacity
            disabled={seatCount >= 9}
            onPress={() => setSeatCount(Math.min(9, seatCount + 1))}
            className="w-7 h-7 rounded-lg bg-slate-800 items-center justify-center"
          >
            <Text className="text-sm font-black text-white">+</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Action Buttons: Search & Seed */}
      <View className="mt-4 space-y-2.5">
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={onSearch}
          className="w-full py-3.5 rounded-2xl bg-cyan-500 flex-row items-center justify-center space-x-2 shadow-lg shadow-cyan-500/25"
        >
          <Search size={18} color="#070B14" strokeWidth={2.5} />
          <Text className="text-sm font-black text-navy-950 uppercase tracking-wider">
            Search Flights
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.8}
          onPress={onSeed}
          disabled={isSeeding}
          className="w-full py-2.5 rounded-xl bg-slate-800/80 border border-slate-700/60 flex-row items-center justify-center space-x-2"
        >
          <Sparkles size={14} color="#FBBF24" />
          <Text className="text-xs font-semibold text-slate-300">
            {isSeeding ? 'Seeding flights...' : 'Seed Sample Test Flights'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};
