import { useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Link } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { SafeAreaView } from 'react-native-safe-area-context';
import { authClient } from '@/lib/auth';
import { API_URL } from '@/lib/config';
import { useSession } from '@/lib/session';
import { colors, fonts } from '@/lib/theme';
import { Button, Field, Notice, T } from '@/components/ui';

/** Email and password sign-in, with the two-step code when the account has one. */
export default function SignIn() {
  const { reload } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'password' | 'code'>('password');
  const [backup, setBackup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const signIn = async () => {
    setError('');
    if (!email.trim() || !password) return setError('Enter your email address and password.');
    setBusy(true);
    const res = await authClient.signIn.email({ email: email.trim(), password });
    setBusy(false);
    if (res.error) {
      const status = (res.error as { status?: number }).status;
      return setError(
        status === 403
          ? 'Verify your email address first. We sent you a link when you signed up.'
          : status === 429
            ? 'Too many attempts. Wait a minute and try again.'
            : 'That email and password do not match an account.',
      );
    }
    if ((res.data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) return setStep('code');
    await reload();
  };

  const verify = async () => {
    setError('');
    if (!code.trim()) return setError(backup ? 'Enter a backup code.' : 'Enter the 6-digit code.');
    setBusy(true);
    const res = backup
      ? await authClient.twoFactor.verifyBackupCode({ code: code.trim() })
      : await authClient.twoFactor.verifyTotp({ code: code.trim() });
    setBusy(false);
    if (res.error) return setError('That code did not work. Check it and try again.');
    await reload();
  };

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
          <View style={s.brand}>
            <Image
              source={require('../../../assets/icon.png')}
              style={s.logo}
              accessibilityIgnoresInvertColors
              accessible={false}
            />
            <T variant="display">Signature Tender</T>
            <T>Send, sign and track agreements from your phone.</T>
          </View>

          {step === 'password' ? (
            <View style={s.form}>
              <T variant="title">Sign in</T>
              <Field
                label="Email"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                textContentType="username"
                returnKeyType="next"
              />
              <Field
                label="Password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoComplete="current-password"
                textContentType="password"
                returnKeyType="go"
                onSubmitEditing={() => void signIn()}
              />
              {error ? <Notice tone="error">{error}</Notice> : null}
              <Button title="Sign in" loading={busy} onPress={() => void signIn()} />
              <Pressable
                accessibilityRole="link"
                onPress={() => void WebBrowser.openBrowserAsync(`${API_URL}/forgot-password`)}
              >
                <T variant="label" style={s.link}>
                  Forgot password?
                </T>
              </Pressable>
              <View style={s.divider} />
              <T style={{ textAlign: 'center' }}>New to Signature Tender?</T>
              <Link href="/sign-up" asChild>
                <Button title="Create an account" variant="secondary" />
              </Link>
              <Link href="/sign-link" asChild>
                <Button title="I have a document to sign" variant="ghost" />
              </Link>
            </View>
          ) : (
            <View style={s.form}>
              <T variant="title">Two-step verification</T>
              <T>
                {backup
                  ? 'Enter one of the backup codes you saved when you turned on two-step verification.'
                  : 'Enter the 6-digit code from your authenticator app.'}
              </T>
              <Field
                label={backup ? 'Backup code' : 'Code'}
                value={code}
                onChangeText={setCode}
                autoCapitalize="none"
                keyboardType={backup ? 'default' : 'number-pad'}
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
                onSubmitEditing={() => void verify()}
              />
              {error ? <Notice tone="error">{error}</Notice> : null}
              <Button title="Verify" loading={busy} onPress={() => void verify()} />
              <Pressable accessibilityRole="button" onPress={() => setBackup((b) => !b)}>
                <T variant="label" style={s.link}>
                  {backup ? 'Use my authenticator app' : 'Use a backup code instead'}
                </T>
              </Pressable>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  page: { padding: 24, gap: 28, flexGrow: 1, justifyContent: 'center' },
  brand: { alignItems: 'center', gap: 8 },
  logo: { width: 76, height: 76, borderRadius: 18, marginBottom: 6 },
  form: { gap: 14 },
  link: { textAlign: 'center', color: colors.navy, textDecorationLine: 'underline', fontFamily: fonts.semibold },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 4 },
});
