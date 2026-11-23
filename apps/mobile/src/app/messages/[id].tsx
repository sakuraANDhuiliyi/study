import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { Screen } from '../../../App';
export default function Page() {
  const { id, title } = useLocalSearchParams<{ id: string; title?: string }>();
  return <Screen route={{ name: 'conversation', id, title }} />;
}
