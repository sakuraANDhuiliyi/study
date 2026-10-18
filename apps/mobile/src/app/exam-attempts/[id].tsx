import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { Screen } from '../../../App';
export default function Page() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Screen route={{ name: 'examAttempt', id }} />;
}
