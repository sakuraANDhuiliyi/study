import { ForumFeed } from '../../pages/AlgorithmForum';
export function AlgorithmDiscussion({ problemId }: { problemId: string }) {
  return <ForumFeed key={problemId} problemId={problemId} compact />;
}
