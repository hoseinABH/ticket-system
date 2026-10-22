import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { X, Lock, Mail, Plane } from 'lucide-react-native';
import { useAuthStore } from '../store/useAuthStore';

export default function AuthModal() {
  const router = useRouter();
  const { login, register } = useAuthStore();
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Required Fields', 'Please enter both email and password.');
      return;
    }

    setLoading(true);
    try {
      if (isRegister) {
        await register(email.trim(), password);
        Alert.alert('Welcome!', 'Your account has been created and logged in.');
      } else {
        await login(email.trim(), password);
      }
      router.back();
    } catch (err: any) {
      Alert.alert(
        isRegister ? 'Registration Failed' : 'Login Failed',
        err.response?.data?.message || err.message || 'Check credentials'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-navy-950">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1 px-5 pt-3 justify-between"
      >
        <View>
          {/* Top Close Bar */}
          <View className="flex-row items-center justify-between pb-4 border-b border-slate-800">
            <View className="flex-row items-center gap-x-2">
              <View className="w-8 h-8 rounded-full bg-cyan-500/15 items-center justify-center border border-cyan-400/30">
                <Plane size={16} color="#22D3EE" />
              </View>
              <Text className="text-base font-black text-white">
                {isRegister ? 'Passenger Registration' : 'Passenger Sign In'}
              </Text>
            </View>

            <TouchableOpacity
              onPress={() => router.back()}
              className="w-8 h-8 rounded-full bg-slate-800 items-center justify-center"
            >
              <X size={16} color="#94A3B8" />
            </TouchableOpacity>
          </View>

          {/* Mode Switcher Tabs */}
          <View className="flex-row p-1 rounded-2xl bg-navy-900 border border-slate-800 my-6">
            <TouchableOpacity
              onPress={() => setIsRegister(false)}
              className={`flex-1 py-2.5 rounded-xl items-center justify-center ${
                !isRegister ? 'bg-cyan-500 shadow-sm' : ''
              }`}
            >
              <Text
                className={`text-xs font-bold ${
                  !isRegister ? 'text-navy-950' : 'text-slate-400'
                }`}
              >
                Sign In
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setIsRegister(true)}
              className={`flex-1 py-2.5 rounded-xl items-center justify-center ${
                isRegister ? 'bg-cyan-500 shadow-sm' : ''
              }`}
            >
              <Text
                className={`text-xs font-bold ${
                  isRegister ? 'text-navy-950' : 'text-slate-400'
                }`}
              >
                Create Account
              </Text>
            </TouchableOpacity>
          </View>

          {/* Form Inputs */}
          <View className="gap-y-4">
            {/* Email */}
            <View>
              <Text className="text-xs font-semibold text-slate-300 mb-1.5">
                Email Address
              </Text>
              <View className="flex-row items-center gap-x-2 px-3.5 py-3 rounded-2xl bg-navy-900 border border-slate-800">
                <Mail size={16} color="#94A3B8" />
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="passenger@airline.com"
                  placeholderTextColor="#64748B"
                  autoCapitalize="none"
                  keyboardType="email-address"
                  className="flex-1 text-sm text-white font-medium"
                />
              </View>
            </View>

            {/* Password */}
            <View>
              <Text className="text-xs font-semibold text-slate-300 mb-1.5">
                Password
              </Text>
              <View className="flex-row items-center gap-x-2 px-3.5 py-3 rounded-2xl bg-navy-900 border border-slate-800">
                <Lock size={16} color="#94A3B8" />
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder="••••••••"
                  placeholderTextColor="#64748B"
                  secureTextEntry
                  className="flex-1 text-sm text-white font-medium"
                />
              </View>
            </View>
          </View>
        </View>

        {/* Action Button */}
        <View className="pb-6">
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={handleSubmit}
            disabled={loading}
            className="w-full py-4 rounded-2xl bg-cyan-500 items-center justify-center shadow-lg shadow-cyan-500/30"
          >
            {loading ? (
              <ActivityIndicator color="#070B14" />
            ) : (
              <Text className="text-sm font-black text-navy-950 uppercase tracking-wider">
                {isRegister ? 'Register & Continue' : 'Sign In'}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
