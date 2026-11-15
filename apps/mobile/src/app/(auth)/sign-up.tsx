import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { authClient } from '@/lib/auth';
import { Button, Field, Notice, T } from '@/components/ui';

/**
 * Creates an account. Like the website, the person then confirms their email address from the
 * link we send (it opens the website), and signs in here.
 */
export default function SignUp() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const submit = async () => {
    setError('');
    if (!name.trim() || !email.trim()) return setError('Enter your name and email address.');
    if (password.length < 12) return setError('Use a password of at least 12 characters.');
    setBusy(true);
    const res = await authClient.signUp.email({ name: name.trim(), email: email.trim(), password });
    setBusy(false);
    if (res.error) {
      const msg = res.error.message ?? '';
      return setError(
        /exist/i.test(msg)
          ? 'An account already uses that email address. Sign in instead.'
          : /pwned|breach|compromised/i.test(msg)
            ? 'That password has appeared in a data breach. Choose a different one.'
            : msg || 'We could not create your account. Please try again.',
      );
    }
    setSent(true);
  };

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 24, gap: 14, flexGrow: 1, justifyContent: 'center' }}>
          {sent ? (
            <View style={{ gap: 14 }}>
              <T variant="title">Check your email</T>
              <T>
                We sent a link to {email.trim()}. Open it to confirm your address, then come back and
                sign in.
              </T>
              <Button title="Back to sign in" onPress={() => router.replace('/sign-in')} />
            </View>
          ) : (
            <>
              <T variant="title">Create your account</T>
              <Field label="Full name" value={name} onChangeText={setName} autoComplete="name" textContentType="name" />
              <Field
                label="Email"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
                textContentType="emailAddress"
              />
              <Field
                label="Password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoComplete="new-password"
                textContentType="newPassword"
                onSubmitEditing={() => void submit()}
              />
              <T variant="small">At least 12 characters.</T>
              {error ? <Notice tone="error">{error}</Notice> : null}
              <Button title="Create account" loading={busy} onPress={() => void submit()} />
              <Button title="I already have an account" variant="ghost" onPress={() => router.replace('/sign-in')} />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
