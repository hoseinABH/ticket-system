import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Plane, Users, ArrowRight } from 'lucide-react-native';
import { Flight } from '../services/flightService';

interface FlightCardProps {
  flight: Flight;
  onSelect: (flight: Flight) => void;
}

export const FlightCard: React.FC<FlightCardProps> = ({ flight, onSelect }) => {
  const departureDate = new Date(flight.departureTime);
  const timeFormatted = departureDate.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  const dateFormatted = departureDate.toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  const isLowSeats = flight.availableSeats <= 15;

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={() => onSelect(flight)}
      className="mb-4 rounded-2xl bg-navy-850 border border-slate-800/80 p-5 shadow-lg shadow-black/40"
    >
      {/* Top Header: Airline & Urgency Badge */}
      <div className="flex-row items-center justify-between pb-3 border-b border-slate-800/60">
        <View className="flex-row items-center space-x-2">
          <View className="w-8 h-8 rounded-lg bg-cyan-500/10 items-center justify-center border border-cyan-500/20">
            <Plane size={16} color="#22D3EE" />
          </View>
          <View>
            <Text className="text-sm font-bold text-slate-100 tracking-wider">
              {flight.flightNumber}
            </Text>
            <Text className="text-xs text-slate-400">Scheduled Flight</Text>
          </View>
        </View>

        {isLowSeats ? (
          <View className="px-2.5 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 flex-row items-center space-x-1">
            <Users size={12} color="#FBBF24" />
            <Text className="text-[11px] font-semibold text-amber-400">
              Only {flight.availableSeats} left
            </Text>
          </View>
        ) : (
          <View className="px-2.5 py-1 rounded-full bg-slate-800 border border-slate-700/60 flex-row items-center space-x-1">
            <Users size={12} color="#94A3B8" />
            <Text className="text-[11px] font-medium text-slate-300">
              {flight.availableSeats} seats
            </Text>
          </View>
        )}
      </div>

      {/* Origin, Trajectory, Destination */}
      <View className="flex-row items-center justify-between py-4">
        {/* Origin */}
        <View className="items-start">
          <Text className="text-2xl font-black text-white tracking-wider">
            {flight.origin}
          </Text>
          <Text className="text-xs text-slate-400 mt-0.5">{timeFormatted}</Text>
        </View>

        {/* Flight Path Graphic */}
        <View className="flex-1 px-4 items-center">
          <Text className="text-[10px] text-cyan-400 font-medium mb-1">
            Non-stop · Direct
          </Text>
          <View className="flex-row items-center w-full justify-center">
            <View className="w-2 h-2 rounded-full bg-cyan-400" />
            <View className="flex-1 h-[2px] bg-gradient-to-r from-cyan-500 via-cyan-400 to-cyan-500 opacity-60 mx-1" />
            <Plane size={14} color="#22D3EE" className="rotate-90" />
            <View className="flex-1 h-[2px] bg-gradient-to-r from-cyan-500 via-cyan-400 to-cyan-500 opacity-60 mx-1" />
            <View className="w-2 h-2 rounded-full border border-cyan-400 bg-navy-950" />
          </View>
          <Text className="text-[10px] text-slate-500 mt-1">{dateFormatted}</Text>
        </View>

        {/* Destination */}
        <View className="items-end">
          <Text className="text-2xl font-black text-white tracking-wider">
            {flight.destination}
          </Text>
          <Text className="text-xs text-slate-400 mt-0.5">+3h 15m Est</Text>
        </View>
      </View>

      {/* Footer: Price & CTA */}
      <View className="pt-3 border-t border-slate-800/60 flex-row items-center justify-between">
        <View>
          <Text className="text-[10px] text-slate-400 uppercase tracking-widest font-medium">
            From
          </Text>
          <View className="flex-row items-baseline space-x-1">
            <Text className="text-xl font-black text-amber-400">
              ${parseFloat(flight.basePrice).toFixed(0)}
            </Text>
            <Text className="text-xs text-slate-400">/ person</Text>
          </View>
        </View>

        <View className="flex-row items-center space-x-1.5 px-4 py-2.5 rounded-xl bg-cyan-500">
          <Text className="text-xs font-bold text-navy-950">Select</Text>
          <ArrowRight size={14} color="#070B14" strokeWidth={2.5} />
        </View>
      </View>
    </TouchableOpacity>
  );
};
