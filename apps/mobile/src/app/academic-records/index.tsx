import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { Screen } from '../../../App';
export default function Page() {
  const { moduleId } = useLocalSearchParams<{ moduleId?: string }>();
  return <Screen route={{ name: 'academic-records', moduleId }} />;
}
