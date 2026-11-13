import { useState } from 'react';
import { ActivityIndicator, Linking, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { WebView, type WebViewNavigation } from 'react-native-webview';
import { API_URL } from '@/lib/config';
import { signingTokenFrom } from '@/lib/format';
import { colors } from '@/lib/theme';
import { Button, Empty, T } from '@/components/ui';

/**
 * The signing experience for a recipient. It is the same signing page the website serves (same
 * consent, evidence and certificate), shown inside the app. Opened by a signing link in an email
 * (universal link) or pasted by hand. Only Signature Tender's own signing pages load here; any
 * other link opens in the phone's browser.
 */
export default function SignScreen() {
  const { token: raw } = useLocalSearchParams<{ token: string }>();
  const token = signingTokenFrom(raw ?? '');
  const [failed, setFailed] = useState(false);
  const [key, setKey] = useState(0);
  if (!token)
    return (
      <View style={{ flex: 1, padding: 24, justifyContent: 'center' }}>
        <Empty title="This signing link is not valid">Open the link from your email again.</Empty>
      </View>
    );
  const allowed = (url: string) => {
    if (!url.startsWith(`${API_URL}/`)) return false;
    const path = url.slice(API_URL.length);
    return /^\/(sign|api\/sign|claim|verify|retrieve|_next|branding|api\/requests)(\/|\?|$)/.test(path);
  };
  const onRequest = (req: WebViewNavigation) => {
    if (req.url === 'about:blank' || allowed(req.url)) return true;
    void Linking.openURL(req.url);
    return false;
  };
  if (failed)
    return (
      <View style={{ flex: 1, padding: 24, justifyContent: 'center', gap: 16 }}>
        <T variant="title">We could not open this document</T>
        <T>Check your connection and try again.</T>
        <Button
          title="Try again"
          onPress={() => {
            setFailed(false);
            setKey((k) => k + 1);
          }}
        />
      </View>
    );
  return (
    <WebView
      key={key}
      source={{ uri: `${API_URL}/sign/${token}` }}
      originWhitelist={['https://*']}
      onShouldStartLoadWithRequest={onRequest}
      onError={() => setFailed(true)}
      startInLoadingState
      renderLoading={() => (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ivory }}>
          <ActivityIndicator size="large" color={colors.navy} />
        </View>
      )}
      allowsBackForwardNavigationGestures
      setSupportMultipleWindows={false}
      style={{ backgroundColor: colors.ivory }}
    />
  );
}
