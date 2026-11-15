import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { signingTokenFrom } from '@/lib/format';
import { Button, Field, Notice, T } from './ui';

/**
 * Opens a signing request someone sent. Links in the email open the app directly once it is
 * installed; this is for pasting a link by hand. Only Signature Tender signing links are accepted.
 */
export function SignLinkForm() {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const open = (text: string) => {
    const token = signingTokenFrom(text);
    if (!token) return setError('Paste the signing link from your email. It starts with signaturetender.com/sign/.');
    setError('');
    router.push({ pathname: '/sign/[token]', params: { token } });
  };
  return (
    <View style={{ gap: 14 }}>
      <T>
        Got an email asking you to sign? Tap the button in the email, or paste its link here. You do not
        need an account to sign.
      </T>
      <Field
        label="Signing link"
        value={value}
        onChangeText={setValue}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        placeholder="https://signaturetender.com/sign/…"
        onSubmitEditing={() => open(value)}
      />
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Button title="Open document" onPress={() => open(value)} />
      <Button
        title="Paste from clipboard"
        variant="secondary"
        onPress={async () => {
          const text = await Clipboard.getStringAsync();
          setValue(text);
          open(text);
        }}
      />
    </View>
  );
}
