import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { Screen } from '../../App';
export default function Page() {
  const { id, path } = useLocalSearchParams<{ id: string; path: string }>();
  return <Screen route={{ name: 'android-source', id, path }} />;
}
