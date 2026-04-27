import React, { useMemo } from 'react';
import { StatusBar, View, Text } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import SplashScreen from './src/screens/SplashScreen';
import UploadScreen from './src/screens/UploadScreen';
import ConfirmScreen from './src/screens/ConfirmScreen';
import HomeScreen from './src/screens/HomeScreen';
import JobFeedScreen from './src/screens/JobFeedScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import BrowserScreen from './src/screens/BrowserScreen';

import Icon from './src/components/Icon';
import { theme } from './src/theme/tokens';
import { isOnboarded } from './src/profile/store';

const RootStack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: theme.colors.bg,
    card: theme.colors.bg,
    text: theme.colors.ink,
    border: theme.colors.border,
    primary: theme.colors.ink,
  },
};

function TabIcon({ name, focused }) {
  return (
    <View
      style={{
        width: 46,
        height: 28,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: focused ? theme.colors.surface2 : 'transparent',
      }}
    >
      <Icon
        name={name}
        size={20}
        color={focused ? theme.colors.ink : theme.colors.muted}
        strokeWidth={focused ? 2 : 1.6}
      />
    </View>
  );
}

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarShowLabel: true,
        tabBarStyle: {
          height: 72,
          paddingTop: 8,
          paddingBottom: 12,
          backgroundColor: theme.colors.bg,
          borderTopColor: theme.colors.border,
          borderTopWidth: 1,
          elevation: 0,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontFamily: theme.font.sans,
          fontWeight: '600',
          marginTop: 2,
        },
        tabBarActiveTintColor: theme.colors.ink,
        tabBarInactiveTintColor: theme.colors.muted,
        tabBarIcon: ({ focused }) => {
          const map = {
            Home: 'home',
            Discover: 'briefcase',
            Profiles: 'user',
            Settings: 'settings',
          };
          return <TabIcon name={map[route.name]} focused={focused} />;
        },
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} options={{ title: 'Home' }} />
      <Tab.Screen name="Discover" component={JobFeedScreen} options={{ title: 'Discover' }} />
      <Tab.Screen name="Profiles" component={ProfileScreen} options={{ title: 'Profile' }} />
      <Tab.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
    </Tab.Navigator>
  );
}

export default function App() {
  const initialRoute = useMemo(() => (isOnboarded() ? 'Main' : 'Splash'), []);
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" backgroundColor={theme.colors.bg} />
      <NavigationContainer theme={navTheme}>
        <RootStack.Navigator
          initialRouteName={initialRoute}
          screenOptions={{ headerShown: false, animation: 'fade' }}
        >
          <RootStack.Screen name="Splash" component={SplashScreen} />
          <RootStack.Screen name="Upload" component={UploadScreen} />
          <RootStack.Screen name="Confirm" component={ConfirmScreen} />
          <RootStack.Screen name="Main" component={MainTabs} />
          <RootStack.Screen
            name="Browser"
            component={BrowserScreen}
            options={{ animation: 'slide_from_right' }}
          />
        </RootStack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
