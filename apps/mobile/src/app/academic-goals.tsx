import React from 'react';
import { Screen } from '../../App';
import { useLocalSearchParams } from 'expo-router';
export default function Page() {
  const { moduleId, status } = useLocalSearchParams<{ moduleId?: string; status?: string }>();
  return <Screen route={{ name: 'academic-goals', moduleId, status }} />;
}
