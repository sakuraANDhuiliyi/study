import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { Screen } from '../../../App';
export default function Page() {
  const { courseId } = useLocalSearchParams<{ courseId?: string }>();
  return <Screen route={{ name: 'announcements', courseId }} />;
}
