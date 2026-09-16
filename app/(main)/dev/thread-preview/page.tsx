import { notFound } from 'next/navigation';
import { ThreadPreview } from './preview-client';

// THE DEV HARNESS for THE ONE THREAD COMPONENT (Phase 2a). It exists to prove the kit can express
// all three thread kinds with data alone — and to be the browser-verification surface for the
// mockups. It is DEV-ONLY BY CONSTRUCTION: it never renders in a production build.
export default function ThreadPreviewPage() {
  if (process.env.NODE_ENV !== 'development') notFound();
  return <ThreadPreview />;
}
