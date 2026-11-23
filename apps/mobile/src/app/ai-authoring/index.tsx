import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { Screen } from '../../../App';
export default function Page() {
  const { courseId, tab } = useLocalSearchParams<{ courseId?: string; tab?: string }>();
  return <Screen route={{ name: 'ai-authoring', courseId, tab: tab === 'history' ? 'history' : 'new' }} />;
}
