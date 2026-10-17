import React from 'react';
import { Screen } from '../../../App';
import { useLocalSearchParams } from 'expo-router';
export default function Page() {
  const { courseId } = useLocalSearchParams<{ courseId?: string }>();
  return <Screen route={{ name: 'live', courseId }} />;
}
