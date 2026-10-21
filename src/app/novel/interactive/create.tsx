import { CreateNovelScreen } from '@/app/novel/create';

/** Roleplay-first path, kept separate from author-led novel creation. */
export default function CreateInteractiveStoryScreen() {
  return <CreateNovelScreen creationMode="interactive" guidedCreation={false} />;
}
