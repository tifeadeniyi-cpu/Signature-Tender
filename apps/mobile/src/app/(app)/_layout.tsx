import { ScrollView } from 'react-native';
import { Stack } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { SafeAreaView } from 'react-native-safe-area-context';
import { API_URL } from '@/lib/config';
import { useMe, useSession } from '@/lib/session';
import { colors, fonts } from '@/lib/theme';
import { Button, T } from '@/components/ui';

export default function AppLayout() {
  const me = useMe();
  const { reload, signOut } = useSession();
  // Workspaces are created on the website during onboarding; the app needs one to show documents.
  if (!me.workspace)
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.ivory }}>
        <ScrollView contentContainerStyle={{ padding: 24, gap: 16, flexGrow: 1, justifyContent: 'center' }}>
          <T variant="title">Finish setting up</T>
          <T>
            Create your workspace on the Signature Tender website to start sending documents. It takes
            a minute. Then come back here.
          </T>
          <Button title="Create my workspace" variant="gold" onPress={() => void WebBrowser.openBrowserAsync(`${API_URL}/onboarding`)} />
          <Button title="I've done it" variant="secondary" onPress={() => void reload()} />
          <Button title="Sign out" variant="ghost" onPress={() => void signOut()} />
        </ScrollView>
      </SafeAreaView>
    );
  return (
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: colors.ivory },
        headerStyle: { backgroundColor: colors.ivory },
        headerTintColor: colors.navy,
        headerTitleStyle: { fontFamily: fonts.semibold },
        headerShadowVisible: false,
        headerBackButtonDisplayMode: 'minimal',
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="document/[id]" options={{ title: 'Document' }} />
    </Stack>
  );
}
