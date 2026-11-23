import React from 'react';
import { Screen } from '../../App';
import { useLocalSearchParams } from 'expo-router';
export default function Page() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return <Screen route={{ name: 'standalone-note', id }} />;
}
