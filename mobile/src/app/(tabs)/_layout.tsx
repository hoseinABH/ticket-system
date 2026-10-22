import React from 'react';
import { Tabs } from 'expo-router';
import { Platform, View } from 'react-native';
import { Plane, Ticket, User } from 'lucide-react-native';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#22D3EE',
        tabBarInactiveTintColor: '#64748B',
        tabBarStyle: {
          backgroundColor: '#0B1120',
          borderTopColor: 'rgba(255, 255, 255, 0.08)',
          borderTopWidth: 1,
          height: Platform.OS === 'ios' ? 88 : 64,
          paddingTop: 8,
          paddingBottom: Platform.OS === 'ios' ? 28 : 10,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
          marginTop: 2,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Flights',
          tabBarIcon: ({ color, size, focused }) => (
            <View className={focused ? 'opacity-100 scale-105' : 'opacity-80'}>
              <Plane size={size} color={color} strokeWidth={focused ? 2.5 : 2} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="bookings"
        options={{
          title: 'My Passes',
          tabBarIcon: ({ color, size, focused }) => (
            <View className={focused ? 'opacity-100 scale-105' : 'opacity-80'}>
              <Ticket size={size} color={color} strokeWidth={focused ? 2.5 : 2} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Account',
          tabBarIcon: ({ color, size, focused }) => (
            <View className={focused ? 'opacity-100 scale-105' : 'opacity-80'}>
              <User size={size} color={color} strokeWidth={focused ? 2.5 : 2} />
            </View>
          ),
        }}
      />
    </Tabs>
  );
}
