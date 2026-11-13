import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { SignLinkForm } from '@/components/sign-link';
import { Button, T } from '@/components/ui';

export default function SignLink() {
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 24, gap: 16 }}>
        <T variant="title">Sign a document</T>
        <SignLinkForm />
        <Button title="Back to sign in" variant="ghost" onPress={() => router.back()} />
      </ScrollView>
    </SafeAreaView>
  );
}
