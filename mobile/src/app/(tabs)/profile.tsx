import React from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  User,
  ShieldCheck,
  Server,
  LogOut,
  LogIn,
  KeyRound,
  ExternalLink,
} from 'lucide-react-native';
import { useAuthStore } from '../../store/useAuthStore';
import { API_BASE_URL } from '../../services/api';

export default function ProfileTab() {
  const router = useRouter();
  const { user, token, logout } = useAuthStore();

  const handleLogout = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: () => logout(),
      },
    ]);
  };

  return (
    <SafeAreaView className="flex-1 bg-navy-950">
      <ScrollView className="flex-1 px-4 pt-3" showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View className="pb-6">
          <Text className="text-xs font-bold uppercase tracking-widest text-cyan-400">
            Account & Preferences
          </Text>
          <Text className="text-2xl font-black text-white tracking-tight mt-0.5">
            Passenger Profile
          </Text>
        </View>

        {/* User Card */}
        {token && user ? (
          <View className="rounded-3xl bg-navy-850 border border-slate-800 p-5 mb-5 shadow-lg shadow-black/50">
            <View className="flex-row items-center space-x-3.5">
              <View className="w-14 h-14 rounded-2xl bg-cyan-500/15 border border-cyan-400/30 items-center justify-center">
                <User size={26} color="#22D3EE" />
              </View>
              <View className="flex-1">
                <Text className="text-base font-black text-white">
                  {user.email}
                </Text>
                <View className="flex-row items-center space-x-1.5 mt-1">
                  <ShieldCheck size={13} color="#34D399" />
                  <Text className="text-xs font-semibold text-emerald-400">
                    Verified Passenger
                  </Text>
                </View>
              </View>
            </View>

            <TouchableOpacity
              activeOpacity={0.8}
              onPress={handleLogout}
              className="mt-5 py-3 rounded-xl bg-rose-500/10 border border-rose-500/20 flex-row items-center justify-center space-x-2"
            >
              <LogOut size={16} color="#F43F5E" />
              <Text className="text-xs font-bold text-rose-400">
                Sign Out
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View className="rounded-3xl bg-navy-850 border border-slate-800 p-6 mb-5 items-center">
            <View className="w-14 h-14 rounded-2xl bg-slate-800 items-center justify-center mb-3">
              <User size={26} color="#94A3B8" />
            </View>
            <Text className="text-base font-bold text-white text-center">
              Guest Passenger
            </Text>
            <Text className="text-xs text-slate-400 text-center mt-1">
              Sign in to manage flights, quotes, and digital boarding passes.
            </Text>
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => router.push('/auth-modal')}
              className="mt-4 px-6 py-3 rounded-xl bg-cyan-500 flex-row items-center space-x-2"
            >
              <LogIn size={16} color="#070B14" strokeWidth={2.5} />
              <Text className="text-xs font-black text-navy-950 uppercase tracking-wider">
                Sign In / Register
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* System & Architecture Info */}
        <View className="rounded-3xl bg-navy-850/80 border border-slate-800/80 p-5 mb-5 space-y-4">
          <Text className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
            System & Infrastructure
          </Text>

          {/* Backend Connection URL */}
          <View className="flex-row items-center justify-between pb-3 border-b border-slate-800/70">
            <View className="flex-row items-center space-x-2.5">
              <Server size={16} color="#22D3EE" />
              <Text className="text-xs font-semibold text-slate-200">
                Backend API
              </Text>
            </View>
            <Text className="text-xs font-mono text-cyan-400">
              {API_BASE_URL}
            </Text>
          </View>

          {/* Ephemeral Pricing */}
          <View className="flex-row items-center justify-between pb-3 border-b border-slate-800/70">
            <View className="flex-row items-center space-x-2.5">
              <KeyRound size={16} color="#FBBF24" />
              <Text className="text-xs font-semibold text-slate-200">
                Redis Fare Lock
              </Text>
            </View>
            <Text className="text-xs font-bold text-amber-400">
              15 Minutes TTL
            </Text>
          </View>

          {/* Database */}
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center space-x-2.5">
              <ShieldCheck size={16} color="#34D399" />
              <Text className="text-xs font-semibold text-slate-200">
                Persistence
              </Text>
            </View>
            <Text className="text-xs font-bold text-slate-300">
              PostgreSQL + Drizzle
            </Text>
          </View>
        </View>

        {/* Quick App Info */}
        <View className="items-center py-4">
          <Text className="text-[11px] text-slate-500 font-medium">
            Midnight Airline Flight System v1.0.0
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
