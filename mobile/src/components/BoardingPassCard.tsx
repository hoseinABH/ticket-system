import React from 'react';
import { View, Text } from 'react-native';
import { Plane, Calendar, Users, CheckCircle2 } from 'lucide-react-native';
import { Booking } from '../services/flightService';

interface BoardingPassCardProps {
  booking: Booking;
}

export const BoardingPassCard: React.FC<BoardingPassCardProps> = ({ booking }) => {
  const dateFormatted = new Date(booking.createdAt).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <View className="mb-5 rounded-3xl bg-navy-850 border border-slate-700/60 overflow-hidden shadow-xl shadow-black/50">
      {/* Top Banner */}
      <View className="bg-gradient-to-r from-navy-800 to-navy-700 p-4 border-b border-slate-700/50 flex-row items-center justify-between">
        <View className="flex-row items-center space-x-2">
          <View className="w-7 h-7 rounded-full bg-cyan-500/20 items-center justify-center border border-cyan-400/40">
            <Plane size={14} color="#22D3EE" />
          </View>
          <Text className="text-sm font-black text-white tracking-wider">
            {booking.flightNumber}
          </Text>
        </View>

        <View className="flex-row items-center space-x-1.5 px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-400/30">
          <CheckCircle2 size={12} color="#34D399" />
          <Text className="text-[11px] font-bold text-emerald-400 tracking-wide">
            {booking.status}
          </Text>
        </View>
      </View>

      {/* Main Ticket Body */}
      <View className="p-5">
        <View className="flex-row items-center justify-between">
          <View>
            <Text className="text-[10px] text-slate-400 uppercase tracking-widest font-semibold">
              Departure
            </Text>
            <Text className="text-2xl font-black text-white tracking-wider mt-0.5">
              THR
            </Text>
            <Text className="text-xs text-slate-400">Tehran</Text>
          </View>

          <View className="items-center px-4">
            <Plane size={20} color="#22D3EE" />
            <Text className="text-[10px] text-cyan-400 font-semibold mt-1">
              Direct
            </Text>
          </View>

          <View className="items-end">
            <Text className="text-[10px] text-slate-400 uppercase tracking-widest font-semibold">
              Arrival
            </Text>
            <Text className="text-2xl font-black text-white tracking-wider mt-0.5">
              IST
            </Text>
            <Text className="text-xs text-slate-400">Istanbul</Text>
          </View>
        </View>

        {/* Info Grid */}
        <View className="mt-5 pt-4 border-t border-slate-800/80 flex-row items-center justify-between">
          <View>
            <Text className="text-[10px] text-slate-400 uppercase font-semibold">
              Passengers
            </Text>
            <View className="flex-row items-center space-x-1 mt-1">
              <Users size={13} color="#94A3B8" />
              <Text className="text-sm font-bold text-slate-100">
                {booking.seatCount} {booking.seatCount === 1 ? 'Seat' : 'Seats'}
              </Text>
            </View>
          </View>

          <View>
            <Text className="text-[10px] text-slate-400 uppercase font-semibold">
              Booked Date
            </Text>
            <View className="flex-row items-center space-x-1 mt-1">
              <Calendar size={13} color="#94A3B8" />
              <Text className="text-sm font-bold text-slate-100">
                {dateFormatted}
              </Text>
            </View>
          </View>

          <View className="items-end">
            <Text className="text-[10px] text-slate-400 uppercase font-semibold">
              Paid Total
            </Text>
            <Text className="text-base font-black text-amber-400 mt-1">
              ${parseFloat(booking.totalPrice).toFixed(2)}
            </Text>
          </View>
        </View>
      </View>

      {/* Perforation Line with Side Notches */}
      <View className="relative flex-row items-center my-1">
        <View className="w-5 h-5 -ml-2.5 rounded-full bg-navy-950 border border-slate-700/60" />
        <View className="flex-1 border-b border-dashed border-slate-700/80 mx-2" />
        <View className="w-5 h-5 -mr-2.5 rounded-full bg-navy-950 border border-slate-700/60" />
      </View>

      {/* Bottom Stub: Barcode Visual & Reference */}
      <View className="p-4 bg-navy-900/60 items-center">
        {/* Simulated Barcode */}
        <View className="flex-row items-center justify-center space-x-1 h-9 opacity-70">
          <View className="w-1 h-full bg-slate-300" />
          <View className="w-2 h-full bg-slate-300" />
          <View className="w-0.5 h-full bg-slate-300" />
          <View className="w-1.5 h-full bg-slate-300" />
          <View className="w-3 h-full bg-slate-300" />
          <View className="w-1 h-full bg-slate-300" />
          <View className="w-0.5 h-full bg-slate-300" />
          <View className="w-2 h-full bg-slate-300" />
          <View className="w-1 h-full bg-slate-300" />
          <View className="w-3 h-full bg-slate-300" />
          <View className="w-0.5 h-full bg-slate-300" />
          <View className="w-2 h-full bg-slate-300" />
          <View className="w-1.5 h-full bg-slate-300" />
          <View className="w-0.5 h-full bg-slate-300" />
          <View className="w-2.5 h-full bg-slate-300" />
        </View>
        <Text className="text-[10px] text-slate-500 font-mono mt-1.5 uppercase tracking-wider">
          Ref: {booking.id.slice(0, 13)}
        </Text>
      </View>
    </View>
  );
};
