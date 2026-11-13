import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Constants from 'expo-constants';
import * as WebBrowser from 'expo-web-browser';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Check, ChevronRight } from 'lucide-react-native';
import { API_URL } from '@/lib/config';
import { useMe, useSession } from '@/lib/session';
import { colors } from '@/lib/theme';
import { Button, Card, T } from '@/components/ui';

const open = (path: string) => void WebBrowser.openBrowserAsync(`${API_URL}${path}`);

export default function Account() {
  const me = useMe();
  const { switchWorkspace, signOut } = useSession();
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={s.page}>
        <T variant="display">Account</T>
        <Card style={{ gap: 2 }}>
          <T variant="heading">{me.user.name}</T>
          <T variant="small">{me.user.email}</T>
        </Card>

        <View style={{ gap: 8 }}>
          <T variant="heading">Workspace</T>
          <Card style={{ padding: 0 }}>
            {me.workspaces.map((w, i) => {
              const on = w.id === me.workspace?.id;
              return (
                <Pressable
                  key={w.id}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  onPress={() => !on && void switchWorkspace(w.id)}
                  style={[s.row, i > 0 && s.rowBorder]}
                >
                  <View style={{ flex: 1 }}>
                    <T variant="label">{w.name}</T>
                    <T variant="small">{w.role}</T>
                  </View>
                  {on ? <Check size={20} color={colors.success} /> : null}
                </Pressable>
              );
            })}
          </Card>
        </View>

        <View style={{ gap: 8 }}>
          <T variant="heading">On the website</T>
          <Card style={{ padding: 0 }}>
            {(
              [
                ['Profile and security', '/app/settings/profile'],
                ['Billing and credits', '/app/billing'],
                ['Templates', '/app/templates'],
                ['Signature Studio', '/signature-studio'],
                ['Electronic signature disclosure', '/legal/esign-disclosure'],
                ['Privacy policy', '/legal/privacy'],
                ['Terms of service', '/legal/terms'],
              ] as const
            ).map(([label, path], i) => (
              <Pressable key={path} accessibilityRole="link" onPress={() => open(path)} style={[s.row, i > 0 && s.rowBorder]}>
                <T variant="label" style={{ flex: 1 }}>
                  {label}
                </T>
                <ChevronRight size={18} color={colors.text} />
              </Pressable>
            ))}
          </Card>
        </View>

        <Button
          title="Sign out"
          variant="danger"
          onPress={() =>
            Alert.alert('Sign out?', 'You will need your password to sign back in.', [
              { text: 'Stay signed in', style: 'cancel' },
              { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
            ])
          }
        />
        <T variant="small" style={{ textAlign: 'center' }}>
          Signature Tender {Constants.expoConfig?.version}
        </T>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  page: { padding: 20, gap: 18, paddingBottom: 48 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, minHeight: 54, paddingVertical: 10 },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
});
