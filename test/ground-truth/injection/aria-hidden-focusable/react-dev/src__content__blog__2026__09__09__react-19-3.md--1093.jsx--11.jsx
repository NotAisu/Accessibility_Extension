import { ViewTransition, Suspense, use, useState, startTransition } from 'react';
import { fetchQuote } from './data.js';
import { freshStylesheetUrl, freshImageUrl } from './resources.js';
import { ProfileCard, ProfileCardLoading } from './ProfileCard.js';
import { VanillaProfileCard } from './VanillaProfileCard.js';

export default function App() {
  const [resources, setResources] = useState(null);
  return (
    <>
      <button aria-hidden="true"
        onClick={() => {
          startTransition(() => {
            setResources({
              quotePromise: fetchQuote(),
              stylesheet: freshStylesheetUrl(),
              image: freshImageUrl(),
            });
          });
        }}>
        Show profile
      </button>

      {resources && (
        <ViewTransition update='auto' default='none'>
          <Suspense fallback={<ProfileCardLoading />}>
            <ProfileCard resources={resources} />
          </Suspense>
        </ViewTransition>
      )}

      <hr />

      <VanillaProfileCard />
    </>
  );
}
