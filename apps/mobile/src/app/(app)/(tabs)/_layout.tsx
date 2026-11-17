import { Tabs } from 'expo-router';
import { FileText, House, PenLine, UserRound } from 'lucide-react-native';
import { colors, fonts } from '@/lib/theme';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.navy,
        tabBarInactiveTintColor: '#64748B',
        tabBarLabelStyle: { fontFamily: fonts.semibold, fontSize: 11 },
        tabBarStyle: { backgroundColor: colors.white, borderTopColor: colors.border },
        sceneStyle: { backgroundColor: colors.ivory },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: ({ color }) => <House color={color} size={22} /> }} />
      <Tabs.Screen
        name="documents"
        options={{ title: 'Documents', tabBarIcon: ({ color }) => <FileText color={color} size={22} /> }}
      />
      <Tabs.Screen name="sign" options={{ title: 'Sign', tabBarIcon: ({ color }) => <PenLine color={color} size={22} /> }} />
      <Tabs.Screen
        name="account"
        options={{ title: 'Account', tabBarIcon: ({ color }) => <UserRound color={color} size={22} /> }}
      />
    </Tabs>
  );
}
