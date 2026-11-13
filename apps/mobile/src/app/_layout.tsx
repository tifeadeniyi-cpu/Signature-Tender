import { useEffect } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts, DMSerifDisplay_400Regular } from '@expo-google-fonts/dm-serif-display';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import { SessionProvider, useSession } from '@/lib/session';
import { colors, fonts } from '@/lib/theme';
import { Button, T } from '@/components/ui';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded] = useFonts({
    DMSerifDisplay_400Regular,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  if (!loaded) return null;
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="dark" />
        <Routes />
      </SessionProvider>
    </SafeAreaProvider>
  );
}

/** Signed-in people get the app; everyone else gets sign-in. Signing links work for both. */
function Routes() {
  const { state, reload } = useSession();
  useEffect(() => {
    if (state.status !== 'loading') void SplashScreen.hideAsync();
  }, [state.status]);
  if (state.status === 'loading') return null;
  if (state.status === 'error')
    return (
      <View style={{ flex: 1, backgroundColor: colors.ivory, justifyContent: 'center', padding: 24, gap: 16 }}>
        <T variant="title">We could not load your account</T>
        <T>{state.message}</T>
        <Button title="Try again" onPress={() => void reload()} />
      </View>
    );
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.ivory },
        headerTintColor: colors.navy,
        headerTitleStyle: { fontFamily: fonts.semibold },
        headerStyle: { backgroundColor: colors.ivory },
        headerShadowVisible: false,
      }}
    >
      <Stack.Protected guard={state.status === 'ready'}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={state.status === 'signed_out'}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Screen name="sign/[token]" options={{ headerShown: true, title: 'Sign document' }} />
    </Stack>
  );
}
