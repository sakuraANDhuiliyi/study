import React from 'react';
import { Screen } from '../../App';
import { useLocalSearchParams } from 'expo-router';
export default function Page() {
  const { problemId } = useLocalSearchParams<{ problemId?: string }>();
  return <Screen route={{ name: 'algorithm-forum', problemId }} />;
}
