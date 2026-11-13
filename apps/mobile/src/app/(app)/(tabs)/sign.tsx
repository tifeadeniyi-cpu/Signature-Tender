import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SignLinkForm } from '@/components/sign-link';
import { T } from '@/components/ui';

export default function SignTab() {
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }} keyboardShouldPersistTaps="handled">
        <T variant="display">Sign</T>
        <SignLinkForm />
      </ScrollView>
    </SafeAreaView>
  );
}
