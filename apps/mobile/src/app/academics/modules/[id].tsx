import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { Screen } from '../../../../App';
export default function Page() {
  const { id, recordId } = useLocalSearchParams<{ id: string; recordId?: string }>();
  return <Screen route={{ name: 'academic-module', id, recordId }} />;
}
